import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Message,
  AutocompleteInteraction,
} from 'discord.js';
import { loadConfig } from './config.js';
import { createAgentRunner, getBackendDisplayName, type AgentRunner } from './agent-runner.js';
import { processManager } from './process-manager.js';
import { loadSkills, formatSkillList, type Skill } from './skills.js';
import { startSlackBot } from './slack.js';

// セッション管理（チャンネルID → セッションID）
const sessions = new Map<string, string>();

async function main() {
  const config = loadConfig();

  // 許可リストの必須チェック（各プラットフォームで1人のみ許可）
  const discordAllowed = config.discord.allowedUsers || [];
  const slackAllowed = config.slack.allowedUsers || [];

  if (config.discord.enabled && discordAllowed.length === 0) {
    console.error('[kbot] Error: ALLOWED_USER must be set for Discord');
    process.exit(1);
  }
  if (config.slack.enabled && slackAllowed.length === 0) {
    console.error('[kbot] Error: SLACK_ALLOWED_USER or ALLOWED_USER must be set for Slack');
    process.exit(1);
  }
  if (discordAllowed.length > 1 || slackAllowed.length > 1) {
    console.error('[kbot] Error: Only one user per platform is allowed');
    console.error('[kbot] 利用規約遵守のため、複数ユーザーの設定は禁止です');
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // エージェントランナーを作成
  const agentRunner = createAgentRunner(config.agent.backend, config.agent.config);
  const backendName = getBackendDisplayName(config.agent.backend);
  console.log(`[xangi] Using ${backendName} as agent backend`);

  // スキルを読み込み
  const workdir = config.agent.config.workdir || process.cwd();
  let skills: Skill[] = loadSkills(workdir);
  console.log(`[kbot] Loaded ${skills.length} skills from ${workdir}`);

  // スラッシュコマンド定義
  const commands: ReturnType<SlashCommandBuilder['toJSON']>[] = [
    new SlashCommandBuilder().setName('new').setDescription('新しいセッションを開始する').toJSON(),
    new SlashCommandBuilder().setName('stop').setDescription('実行中のタスクを停止する').toJSON(),
    new SlashCommandBuilder()
      .setName('skills')
      .setDescription('利用可能なスキル一覧を表示')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('skill')
      .setDescription('スキルを実行する')
      .addStringOption((option) =>
        option.setName('name').setDescription('スキル名').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) => option.setName('args').setDescription('引数').setRequired(false))
      .toJSON(),
  ];

  // 各スキルを個別のスラッシュコマンドとして追加
  for (const skill of skills) {
    // Discordコマンド名は小文字英数字とハイフンのみ（最大32文字）
    const cmdName = skill.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);

    if (cmdName) {
      commands.push(
        new SlashCommandBuilder()
          .setName(cmdName)
          .setDescription(skill.description.slice(0, 100) || `${skill.name}スキルを実行`)
          .addStringOption((option) =>
            option.setName('args').setDescription('引数（任意）').setRequired(false)
          )
          .toJSON()
      );
    }
  }

  // スラッシュコマンド登録
  client.once(Events.ClientReady, async (c) => {
    console.log(`[kbot] Ready! Logged in as ${c.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    try {
      // ギルドコマンドとして登録（即時反映）
      const guilds = c.guilds.cache;
      console.log(`[kbot] Found ${guilds.size} guilds`);

      for (const [guildId, guild] of guilds) {
        await rest.put(Routes.applicationGuildCommands(c.user.id, guildId), {
          body: commands,
        });
        console.log(`[kbot] ${commands.length} slash commands registered for: ${guild.name}`);
      }

      // グローバルコマンドをクリア（重複防止）
      await rest.put(Routes.applicationCommands(c.user.id), { body: [] });
      console.log('[kbot] Cleared global commands');
    } catch (error) {
      console.error('[kbot] Failed to register slash commands:', error);
    }
  });

  // スラッシュコマンド処理
  client.on(Events.InteractionCreate, async (interaction) => {
    // オートコンプリート処理
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction, skills);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // 許可リストチェック
    if (!config.discord.allowedUsers?.includes(interaction.user.id)) {
      await interaction.reply({ content: '許可されていないユーザーです', ephemeral: true });
      return;
    }

    const channelId = interaction.channelId;

    if (interaction.commandName === 'new') {
      sessions.delete(channelId);
      await interaction.reply('🆕 新しいセッションを開始しました');
      return;
    }

    if (interaction.commandName === 'stop') {
      const stopped = processManager.stop(channelId);
      if (stopped) {
        await interaction.reply('🛑 タスクを停止しました');
      } else {
        await interaction.reply({ content: '実行中のタスクはありません', ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === 'skills') {
      // スキルを再読み込み
      skills = loadSkills(workdir);
      await interaction.reply(formatSkillList(skills));
      return;
    }

    if (interaction.commandName === 'skill') {
      await handleSkill(interaction, agentRunner, config, channelId);
      return;
    }

    // 個別スキルコマンドの処理
    const matchedSkill = skills.find((s) => {
      const cmdName = s.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
      return cmdName === interaction.commandName;
    });

    if (matchedSkill) {
      await handleSkillCommand(interaction, agentRunner, config, channelId, matchedSkill.name);
      return;
    }
  });

  // メッセージ処理
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const isMentioned = message.mentions.has(client.user!);
    const isDM = !message.guild;
    const isAutoReplyChannel =
      config.discord.autoReplyChannels?.includes(message.channel.id) ?? false;

    if (!isMentioned && !isDM && !isAutoReplyChannel) return;

    if (!config.discord.allowedUsers?.includes(message.author.id)) {
      console.log(`[kbot] Unauthorized user: ${message.author.id} (${message.author.tag})`);
      return;
    }

    let prompt = message.content
      .replace(/<@[!&]?\d+>|<#\d+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!prompt) return;

    const channelId = message.channel.id;

    // スキップ設定
    const defaultSkip = config.agent.config.skipPermissions ?? false;
    let skipPermissions = defaultSkip;

    if (prompt.startsWith('!skip')) {
      skipPermissions = true;
      prompt = prompt.replace(/^!skip\s*/, '').trim();
    } else if (prompt.startsWith('!noskip')) {
      skipPermissions = false;
      prompt = prompt.replace(/^!noskip\s*/, '').trim();
    }

    await processPrompt(message, agentRunner, prompt, skipPermissions, channelId, config);
  });

  // Discordボットを起動
  if (config.discord.enabled) {
    await client.login(config.discord.token);
    console.log('[kbot] Discord bot started');
  }

  // Slackボットを起動
  if (config.slack.enabled) {
    await startSlackBot({
      config,
      agentRunner,
      skills,
      reloadSkills: () => {
        skills = loadSkills(workdir);
        return skills;
      },
    });
    console.log('[kbot] Slack bot started');
  }

  if (!config.discord.enabled && !config.slack.enabled) {
    console.error(
      '[kbot] No chat platform enabled. Set DISCORD_TOKEN or SLACK_BOT_TOKEN/SLACK_APP_TOKEN'
    );
    process.exit(1);
  }
}

async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  skills: Skill[]
): Promise<void> {
  const focusedValue = interaction.options.getFocused().toLowerCase();

  const filtered = skills
    .filter(
      (skill) =>
        skill.name.toLowerCase().includes(focusedValue) ||
        skill.description.toLowerCase().includes(focusedValue)
    )
    .slice(0, 25) // Discord制限: 最大25件
    .map((skill) => ({
      name: `${skill.name} - ${skill.description.slice(0, 50)}`,
      value: skill.name,
    }));

  await interaction.respond(filtered);
}

async function handleSkill(
  interaction: ChatInputCommandInteraction,
  agentRunner: AgentRunner,
  config: ReturnType<typeof loadConfig>,
  channelId: string
) {
  const skillName = interaction.options.getString('name', true);
  const args = interaction.options.getString('args') || '';
  const skipPermissions = config.agent.config.skipPermissions ?? false;

  await interaction.deferReply();

  try {
    const prompt = `スキル「${skillName}」を実行してください。${args ? `引数: ${args}` : ''}`;
    const sessionId = sessions.get(channelId);
    const { result, sessionId: newSessionId } = await agentRunner.run(prompt, {
      skipPermissions,
      sessionId,
      channelId,
    });

    sessions.set(channelId, newSessionId);
    await interaction.editReply(result.slice(0, 2000));
  } catch (error) {
    console.error('[kbot] Error:', error);
    await interaction.editReply('エラーが発生しました');
  }
}

async function handleSkillCommand(
  interaction: ChatInputCommandInteraction,
  agentRunner: AgentRunner,
  config: ReturnType<typeof loadConfig>,
  channelId: string,
  skillName: string
) {
  const args = interaction.options.getString('args') || '';
  const skipPermissions = config.agent.config.skipPermissions ?? false;

  await interaction.deferReply();

  try {
    const prompt = `スキル「${skillName}」を実行してください。${args ? `引数: ${args}` : ''}`;
    const sessionId = sessions.get(channelId);
    const { result, sessionId: newSessionId } = await agentRunner.run(prompt, {
      skipPermissions,
      sessionId,
      channelId,
    });

    sessions.set(channelId, newSessionId);
    await interaction.editReply(result.slice(0, 2000));
  } catch (error) {
    console.error('[kbot] Error:', error);
    await interaction.editReply('エラーが発生しました');
  }
}

// ストリーミング更新の間隔（ミリ秒）
const STREAM_UPDATE_INTERVAL_MS = 1000;

async function processPrompt(
  message: Message,
  agentRunner: AgentRunner,
  prompt: string,
  skipPermissions: boolean,
  channelId: string,
  config: ReturnType<typeof loadConfig>
) {
  try {
    console.log(`[kbot] Processing message in channel ${channelId}`);
    await message.react('👀').catch(() => {});

    const sessionId = sessions.get(channelId);
    const useStreaming = config.discord.streaming ?? true;
    const showThinking = config.discord.showThinking ?? true;

    // 最初のメッセージを送信
    const replyMessage = await message.reply('🤔 考え中.');

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
              replyMessage
                .edit(fullText.slice(0, 2000) + ' ▌')
                .catch((err) => {
                  console.error('[kbot] Failed to edit message:', err.message);
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
      let dotCount = 1;
      const thinkingInterval = setInterval(() => {
        dotCount = (dotCount % 3) + 1;
        const dots = '.'.repeat(dotCount);
        replyMessage.edit(`🤔 考え中${dots}`).catch(() => {});
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
    console.log(
      `[kbot] Response length: ${result.length}, session: ${newSessionId.slice(0, 8)}...`
    );

    // 最終結果を更新
    await replyMessage.edit(result.slice(0, 2000));
  } catch (error) {
    console.error('[kbot] Error:', error);
    await message.reply('エラーが発生しました');
  }
}

main().catch(console.error);
