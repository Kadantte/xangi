import type { ChildProcess } from 'child_process';

/**
 * チャンネルごとの実行中プロセスを管理
 */
class ProcessManager {
  private processes = new Map<string, ChildProcess>();

  /**
   * プロセスを登録
   */
  register(channelId: string, proc: ChildProcess): void {
    // 既存のプロセスがあれば先にkill
    this.stop(channelId);
    this.processes.set(channelId, proc);

    // プロセス終了時に自動削除
    proc.on('close', () => {
      if (this.processes.get(channelId) === proc) {
        this.processes.delete(channelId);
      }
    });
  }

  /**
   * プロセスを停止
   * @returns true if process was running and stopped
   */
  stop(channelId: string): boolean {
    const proc = this.processes.get(channelId);
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      this.processes.delete(channelId);
      return true;
    }
    return false;
  }

  /**
   * プロセスが実行中かどうか
   */
  isRunning(channelId: string): boolean {
    const proc = this.processes.get(channelId);
    return proc != null && !proc.killed;
  }

  /**
   * すべてのプロセスを停止
   */
  stopAll(): void {
    for (const [channelId] of this.processes) {
      this.stop(channelId);
    }
  }
}

// シングルトン
export const processManager = new ProcessManager();
