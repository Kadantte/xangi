import { App, LogLevel } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { Config } from './config.js';
import type { AgentRunner } from './agent-runner.js';
import { processManager } from './process-manager.js';
import type { Skill } from './skills.js';
import { formatSkillList } from './skills.js';

// ストリーミング更新の間隔（ミリ秒）
const STREAM_UPDATE_INTERVAL_MS = 1000;

// セッション管理（チャンネルID → セッションID）
const sessions = new Map<string, string>();

export interface SlackChannelOptions {
  config: Config;
  agentRunner: AgentRunner;
  skills: Skill[];
  reloadSkills: () => Skill[];
}

export async function startSlackBot(options: SlackChannelOptions): Promise<void> {
  const { config, agentRunner, reloadSkills } = options;
  let { skills } = options;

  if (!config.slack.botToken || !config.slack.appToken) {
    throw new Error('Slack tokens not configured');
  }

  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  // メンション時の処理
  app.event('app_mention', async ({ event, say, client }) => {
    const userId = event.user;
    if (!userId) return;

    // 許可リストチェック
    if (!config.slack.allowedUsers?.includes(userId)) {
      console.log(`[slack] Unauthorized user: ${userId}`);
      return;
    }

    const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!text) return;

    const channelId = event.channel;
    const threadTs = config.slack.replyInThread ? event.thread_ts || event.ts : undefined;

    // セッションクリアコマンド
    if (['!new', 'new', '/new', '!clear', 'clear', '/clear'].includes(text)) {
      sessions.delete(channelId);
      await say({
        text: '🆕 新しいセッションを開始しました',
        ...(threadTs && { thread_ts: threadTs }),
      });
      return;
    }

    // 停止コマンド
    if (['!stop', 'stop', '/stop'].includes(text)) {
      const stopped = processManager.stop(channelId);
      await say({
        text: stopped ? '🛑 タスクを停止しました' : '実行中のタスクはありません',
        ...(threadTs && { thread_ts: threadTs }),
      });
      return;
    }

    // 👀 リアクション追加
    await client.reactions
      .add({
        channel: channelId,
        timestamp: event.ts,
        name: 'eyes',
      })
      .catch((err) => {
        console.error('[slack] Failed to add reaction:', err.message || err);
      });

    await processMessage(channelId, threadTs, text, client, agentRunner, config);
  });

  // DMの処理 + autoReplyChannels
  app.event('message', async ({ event, say, client }) => {
    // botのメッセージは無視
    if ('bot_id' in event || !('user' in event)) return;

    const messageEvent = event as {
      user: string;
      text?: string;
      channel: string;
      ts: string;
      channel_type?: string;
    };

    console.log(
      `[slack] Message event: channel=${messageEvent.channel}, type=${messageEvent.channel_type}, autoReplyChannels=${config.slack.autoReplyChannels?.join(',')}`
    );

    // DM または autoReplyChannels のみ処理
    const isDM = messageEvent.channel_type === 'im';
    const isAutoReplyChannel = config.slack.autoReplyChannels?.includes(messageEvent.channel);
    if (!isDM && !isAutoReplyChannel) {
      console.log(`[slack] Skipping: isDM=${isDM}, isAutoReplyChannel=${isAutoReplyChannel}`);
      return;
    }

    // 許可リストチェック
    if (!config.slack.allowedUsers?.includes(messageEvent.user)) {
      console.log(`[slack] Unauthorized user: ${messageEvent.user}`);
      return;
    }

    const text = messageEvent.text || '';
    if (!text) return;

    const channelId = messageEvent.channel;
    const threadTs = config.slack.replyInThread ? messageEvent.ts : undefined;

    // セッションクリアコマンド
    if (['!new', 'new', '/new', '!clear', 'clear', '/clear'].includes(text)) {
      sessions.delete(channelId);
      await say({
        text: '🆕 新しいセッションを開始しました',
        ...(threadTs && { thread_ts: threadTs }),
      });
      return;
    }

    // 停止コマンド
    if (['!stop', 'stop', '/stop'].includes(text)) {
      const stopped = processManager.stop(channelId);
      await say({
        text: stopped ? '🛑 タスクを停止しました' : '実行中のタスクはありません',
        ...(threadTs && { thread_ts: threadTs }),
      });
      return;
    }

    // 👀 リアクション追加
    await client.reactions
      .add({
        channel: channelId,
        timestamp: messageEvent.ts,
        name: 'eyes',
      })
      .catch((err) => {
        console.error('[slack] Failed to add reaction:', err.message || err);
      });

    await processMessage(channelId, threadTs, text, client, agentRunner, config);
  });

  // /new コマンド
  app.command('/new', async ({ command, ack, respond }) => {
    await ack();

    if (!config.slack.allowedUsers?.includes(command.user_id)) {
      await respond({ text: '許可されていないユーザーです', response_type: 'ephemeral' });
      return;
    }

    sessions.delete(command.channel_id);
    await respond({ text: '🆕 新しいセッションを開始しました' });
  });

  // /skills コマンド
  app.command('/skills', async ({ command, ack, respond }) => {
    await ack();

    if (!config.slack.allowedUsers?.includes(command.user_id)) {
      await respond({ text: '許可されていないユーザーです', response_type: 'ephemeral' });
      return;
    }

    skills = reloadSkills();
    await respond({ text: formatSkillList(skills) });
  });

  // /skill コマンド
  app.command('/skill', async ({ command, ack, respond }) => {
    await ack();

    if (!config.slack.allowedUsers?.includes(command.user_id)) {
      await respond({ text: '許可されていないユーザーです', response_type: 'ephemeral' });
      return;
    }

    const args = command.text.trim().split(/\s+/);
    const skillName = args[0];
    const skillArgs = args.slice(1).join(' ');

    if (!skillName) {
      await respond({ text: '使い方: `/skill <スキル名> [引数]`' });
      return;
    }

    const channelId = command.channel_id;
    const skipPermissions = config.agent.config.skipPermissions ?? false;

    try {
      const prompt = `スキル「${skillName}」を実行してください。${skillArgs ? `引数: ${skillArgs}` : ''}`;
      const sessionId = sessions.get(channelId);
      const { result, sessionId: newSessionId } = await agentRunner.run(prompt, {
        skipPermissions,
        sessionId,
        channelId,
      });

      sessions.set(channelId, newSessionId);
      await respond({ text: result.slice(0, 3000) });
    } catch (error) {
      console.error('[slack] Error:', error);
      await respond({ text: 'エラーが発生しました' });
    }
  });

  await app.start();
  console.log('[slack] ⚡️ Slack bot is running!');
}

async function processMessage(
  channelId: string,
  threadTs: string | undefined,
  text: string,
  client: WebClient,
  agentRunner: AgentRunner,
  config: Config
): Promise<void> {
  const skipPermissions = config.agent.config.skipPermissions ?? false;
  let prompt = text;

  // スキップ設定
  if (prompt.startsWith('!skip')) {
    prompt = prompt.replace(/^!skip\s*/, '').trim();
  } else if (prompt.startsWith('!noskip')) {
    prompt = prompt.replace(/^!noskip\s*/, '').trim();
  }

  try {
    console.log(`[slack] Processing message in channel ${channelId}`);

    const sessionId = sessions.get(channelId);
    const useStreaming = config.slack.streaming ?? true;
    const showThinking = config.slack.showThinking ?? true;

    // 最初のメッセージを送信
    const initialResponse = await client.chat.postMessage({
      channel: channelId,
      text: '🤔 考え中.',
      ...(threadTs && { thread_ts: threadTs }),
    });

    const messageTs = initialResponse.ts;
    if (!messageTs) {
      throw new Error('Failed to get message timestamp');
    }

    let result: string;
    let newSessionId: string;

    if (useStreaming && showThinking) {
      // ストリーミング + 思考表示モード
      let lastUpdateTime = 0;
      let pendingUpdate = false;

      const streamResult = await agentRunner.runStream(
        prompt,
        {
          onText: (_chunk, fullText) => {
            const now = Date.now();
            if (now - lastUpdateTime >= STREAM_UPDATE_INTERVAL_MS && !pendingUpdate) {
              pendingUpdate = true;
              lastUpdateTime = now;
              client.chat
                .update({
                  channel: channelId,
                  ts: messageTs,
                  text: fullText.slice(0, 3000) + ' ▌',
                })
                .catch((err) => {
                  console.error('[slack] Failed to update message:', err.message);
                })
                .finally(() => {
                  pendingUpdate = false;
                });
            }
          },
        },
        { skipPermissions, sessionId, channelId }
      );
      result = streamResult.result;
      newSessionId = streamResult.sessionId;
    } else {
      // 非ストリーミング or 思考非表示モード
      // 考え中アニメーション
      let dotCount = 1;
      const thinkingInterval = setInterval(() => {
        dotCount = (dotCount % 3) + 1;
        const dots = '.'.repeat(dotCount);
        client.chat
          .update({
            channel: channelId,
            ts: messageTs,
            text: `🤔 考え中${dots}`,
          })
          .catch(() => {});
      }, 1000);

      try {
        const runResult = await agentRunner.run(prompt, { skipPermissions, sessionId, channelId });
        result = runResult.result;
        newSessionId = runResult.sessionId;
      } finally {
        clearInterval(thinkingInterval);
      }
    }

    sessions.set(channelId, newSessionId);
    console.log(`[slack] Final result length: ${result.length}`);

    // 最終結果を更新
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: result.slice(0, 3000),
    });
  } catch (error) {
    console.error('[slack] Error:', error);
    await client.chat.postMessage({
      channel: channelId,
      text: 'エラーが発生しました',
      ...(threadTs && { thread_ts: threadTs }),
    });
  }
}
