import type { AgentBackend, AgentConfig } from './config.js';
import { ClaudeCodeRunner } from './claude-code.js';
import { CodexRunner } from './codex-cli.js';
import { PersistentRunner } from './persistent-runner.js';

export interface RunOptions {
  skipPermissions?: boolean;
  sessionId?: string;
  channelId?: string; // プロセス管理用
}

export interface RunResult {
  result: string;
  sessionId: string;
}

export interface StreamCallbacks {
  onText?: (text: string, fullText: string) => void;
  onComplete?: (result: RunResult) => void;
  onError?: (error: Error) => void;
}

/**
 * AIエージェントランナーの統一インターフェース
 */
export interface AgentRunner {
  run(prompt: string, options?: RunOptions): Promise<RunResult>;
  runStream(prompt: string, callbacks: StreamCallbacks, options?: RunOptions): Promise<RunResult>;
}

/**
 * 設定に基づいてAgentRunnerを作成
 */
export function createAgentRunner(backend: AgentBackend, config: AgentConfig): AgentRunner {
  switch (backend) {
    case 'claude-code':
      // persistent モードなら PersistentRunner を使用
      if (config.persistent) {
        console.log('[agent-runner] Using PersistentRunner (high-speed mode)');
        return new PersistentRunner(config);
      }
      return new ClaudeCodeRunner(config);
    case 'codex':
      return new CodexRunner(config);
    default:
      throw new Error(`Unknown agent backend: ${backend}`);
  }
}

/**
 * バックエンド名を表示用に変換
 */
export function getBackendDisplayName(backend: AgentBackend): string {
  switch (backend) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    default:
      return backend;
  }
}
