import { spawn } from 'child_process';
import { processManager } from './process-manager.js';
import type { RunOptions, RunResult, StreamCallbacks } from './agent-runner.js';
import { DEFAULT_TIMEOUT_MS } from './constants.js';

export interface CodexOptions {
  model?: string;
  timeoutMs?: number;
  workdir?: string;
  skipPermissions?: boolean;
}

/**
 * Codex CLI を実行するランナー
 */
export class CodexRunner {
  private model?: string;
  private timeoutMs: number;
  private workdir?: string;
  private skipPermissions: boolean;

  constructor(options?: CodexOptions) {
    this.model = options?.model;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS; // デフォルト5分
    this.workdir = options?.workdir;
    this.skipPermissions = options?.skipPermissions ?? false;
  }

  async run(prompt: string, options?: RunOptions): Promise<RunResult> {
    const args: string[] = ['exec', '--json'];

    const skip = options?.skipPermissions ?? this.skipPermissions;
    if (skip) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--sandbox', 'workspace-write');
    }

    // セッション継続
    if (options?.sessionId) {
      args.push('resume', options.sessionId);
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    if (this.workdir) {
      args.push('--cd', this.workdir);
    }

    args.push(prompt);

    const sessionInfo = options?.sessionId
      ? ` (session: ${options.sessionId.slice(0, 8)}...)`
      : ' (new)';
    console.log(`[codex] Executing in ${this.workdir || 'default dir'}${sessionInfo}`);

    const { stdout, sessionId } = await this.execute(args, options?.channelId);
    const result = this.extractResult(stdout);

    return {
      result,
      sessionId,
    };
  }

  private execute(
    args: string[],
    channelId?: string
  ): Promise<{ stdout: string; sessionId: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('codex', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.workdir,
      });

      // プロセスマネージャーに登録
      if (channelId) {
        processManager.register(channelId, proc);
      }

      let stdout = '';
      let stderr = '';
      let sessionId = '';

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // JSONLからセッションID（thread_id）を抽出
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            // Codexはthread_idをセッションIDとして使用
            if (json.thread_id) {
              sessionId = json.thread_id;
            } else if (json.session_id) {
              sessionId = json.session_id;
            }
          } catch {
            // JSONパースエラーは無視
          }
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error(`Codex CLI timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          reject(new Error(`Codex CLI exited with code ${code}: ${stderr}`));
          return;
        }

        resolve({ stdout, sessionId });
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Codex CLI: ${err.message}`));
      });
    });
  }

  private extractResult(output: string): string {
    const lines = output.trim().split('\n');
    let result = '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        // Codexの出力形式に応じて結果を抽出
        // item.completed の agent_message から text を取得
        if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
          result = json.item.text;
        } else if (json.type === 'message' && json.content) {
          result = json.content;
        } else if (json.result) {
          result = json.result;
        }
      } catch {
        // JSONパースエラーは無視
      }
    }

    return result || output;
  }

  /**
   * ストリーミング実行
   */
  async runStream(
    prompt: string,
    callbacks: StreamCallbacks,
    options?: RunOptions
  ): Promise<RunResult> {
    const args: string[] = ['exec', '--json'];

    const skip = options?.skipPermissions ?? this.skipPermissions;
    if (skip) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--sandbox', 'workspace-write');
    }

    if (options?.sessionId) {
      args.push('resume', options.sessionId);
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    if (this.workdir) {
      args.push('--cd', this.workdir);
    }

    args.push(prompt);

    const sessionInfo = options?.sessionId
      ? ` (session: ${options.sessionId.slice(0, 8)}...)`
      : ' (new)';
    console.log(`[codex] Streaming in ${this.workdir || 'default dir'}${sessionInfo}`);

    return this.executeStream(args, callbacks, options?.channelId);
  }

  private executeStream(
    args: string[],
    callbacks: StreamCallbacks,
    channelId?: string
  ): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn('codex', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.workdir,
      });

      // プロセスマネージャーに登録
      if (channelId) {
        processManager.register(channelId, proc);
      }

      let fullText = '';
      let sessionId = '';
      let buffer = '';

      proc.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);

            // Codexはthread_idをセッションIDとして使用
            if (json.thread_id) {
              sessionId = json.thread_id;
            } else if (json.session_id) {
              sessionId = json.session_id;
            }

            // ストリーミングテキストを抽出
            // item.completed の agent_message から text を取得
            if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
              const text = json.item.text;
              fullText = text;
              callbacks.onText?.(text, fullText);
            } else if (json.type === 'message_delta' && json.content) {
              fullText += json.content;
              callbacks.onText?.(json.content, fullText);
            } else if (json.type === 'message' && json.content) {
              fullText = json.content;
              callbacks.onText?.(json.content, fullText);
            }
          } catch {
            // JSONパースエラーは無視
          }
        }
      });

      proc.stderr.on('data', (data) => {
        console.error('[codex] stderr:', data.toString());
      });

      const timeout = setTimeout(() => {
        proc.kill();
        const error = new Error(`Codex CLI timed out after ${this.timeoutMs}ms`);
        callbacks.onError?.(error);
        reject(error);
      }, this.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeout);

        // 残りのバッファを処理
        if (buffer.trim()) {
          try {
            const json = JSON.parse(buffer);
            if (json.session_id) {
              sessionId = json.session_id;
            }
            if (json.type === 'message' && json.content) {
              fullText = json.content;
            } else if (json.result) {
              fullText = json.result;
            }
          } catch {
            // JSONパースエラーは無視
          }
        }

        if (code !== 0) {
          const error = new Error(`Codex CLI exited with code ${code}`);
          callbacks.onError?.(error);
          reject(error);
          return;
        }

        const result: RunResult = { result: fullText, sessionId };
        callbacks.onComplete?.(result);
        resolve(result);
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        const error = new Error(`Failed to spawn Codex CLI: ${err.message}`);
        callbacks.onError?.(error);
        reject(error);
      });
    });
  }
}
