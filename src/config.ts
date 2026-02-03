export type AgentBackend = 'claude-code' | 'codex';

export interface AgentConfig {
  model?: string;
  timeoutMs?: number;
  workdir?: string;
  skipPermissions?: boolean;
}

export interface Config {
  discord: {
    enabled: boolean;
    token: string;
    allowedUsers?: string[];
    autoReplyChannels?: string[];
    streaming?: boolean;
    showThinking?: boolean;
  };
  slack: {
    enabled: boolean;
    botToken?: string;
    appToken?: string;
    signingSecret?: string;
    allowedUsers?: string[];
    autoReplyChannels?: string[];
    replyInThread?: boolean;
    streaming?: boolean;
    showThinking?: boolean;
  };
  agent: {
    backend: AgentBackend;
    config: AgentConfig;
  };
  // 後方互換性のため残す
  claudeCode: AgentConfig;
}

export function loadConfig(): Config {
  const discordToken = process.env.DISCORD_TOKEN;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackAppToken = process.env.SLACK_APP_TOKEN;

  // 少なくともどちらかが有効である必要がある
  if (!discordToken && !slackBotToken) {
    throw new Error('DISCORD_TOKEN or SLACK_BOT_TOKEN environment variable is required');
  }

  const discordAllowedUser = process.env.DISCORD_ALLOWED_USER;
  const slackAllowedUser = process.env.SLACK_ALLOWED_USER;
  const discordAllowedUsers = discordAllowedUser ? [discordAllowedUser] : [];
  const slackAllowedUsers = slackAllowedUser ? [slackAllowedUser] : [];

  const backend = (process.env.AGENT_BACKEND || 'claude-code') as AgentBackend;
  if (backend !== 'claude-code' && backend !== 'codex') {
    throw new Error(`Invalid AGENT_BACKEND: ${backend}. Must be 'claude-code' or 'codex'`);
  }

  const agentConfig: AgentConfig = {
    model: process.env.AGENT_MODEL || undefined,
    timeoutMs: process.env.TIMEOUT_MS ? parseInt(process.env.TIMEOUT_MS, 10) : 300000,
    workdir: process.env.WORKSPACE_PATH || undefined,
    skipPermissions: process.env.SKIP_PERMISSIONS === 'true',
  };

  return {
    discord: {
      enabled: !!discordToken,
      token: discordToken || '',
      allowedUsers: discordAllowedUsers,
      autoReplyChannels:
        process.env.AUTO_REPLY_CHANNELS?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) || [],
      streaming: process.env.DISCORD_STREAMING !== 'false',
      showThinking: process.env.DISCORD_SHOW_THINKING !== 'false',
    },
    slack: {
      enabled: !!slackBotToken && !!slackAppToken,
      botToken: slackBotToken,
      appToken: slackAppToken,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      allowedUsers: slackAllowedUsers,
      autoReplyChannels:
        process.env.SLACK_AUTO_REPLY_CHANNELS?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) || [],
      replyInThread: process.env.SLACK_REPLY_IN_THREAD !== 'false',
      streaming: process.env.SLACK_STREAMING !== 'false',
      showThinking: process.env.SLACK_SHOW_THINKING !== 'false',
    },
    agent: {
      backend,
      config: agentConfig,
    },
    // 後方互換性のため残す
    claudeCode: agentConfig,
  };
}
