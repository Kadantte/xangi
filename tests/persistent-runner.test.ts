import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PersistentRunner } from '../src/persistent-runner.js';

// Child process をモック
vi.mock('child_process', () => {
  const EventEmitter = require('events');

  class MockProcess extends EventEmitter {
    stdin = {
      write: vi.fn(),
      end: vi.fn(),
    };
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    killed = false;

    kill() {
      this.killed = true;
      this.emit('close', 0);
    }
  }

  let mockProcess: MockProcess;

  return {
    spawn: vi.fn(() => {
      mockProcess = new MockProcess();
      // 少し遅延してから init メッセージを送信
      setTimeout(() => {
        mockProcess.stdout.emit(
          'data',
          JSON.stringify({
            type: 'system',
            subtype: 'init',
            session_id: 'test-session-123',
          }) + '\n'
        );
      }, 10);
      return mockProcess;
    }),
    getMockProcess: () => mockProcess,
  };
});

describe('PersistentRunner', () => {
  let runner: PersistentRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new PersistentRunner({
      workdir: '/test/workdir',
      skipPermissions: true,
    });
  });

  afterEach(async () => {
    // shutdown で発生する Promise rejection を無視
    try {
      runner.shutdown();
    } catch {
      // ignore
    }
    // 未処理の Promise を待つ
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('should create a runner instance', () => {
    expect(runner).toBeInstanceOf(PersistentRunner);
    expect(runner.isAlive()).toBe(false); // まだプロセス起動前
  });

  it('should start process on first request', async () => {
    const { spawn, getMockProcess } = await import('child_process');

    // リクエストを送信（レスポンスは手動でシミュレート）
    const runPromise = runner.run('test prompt');

    // プロセスが起動したか確認
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', '--input-format', 'stream-json']),
      expect.any(Object)
    );

    // レスポンスをシミュレート
    const mockProcess = getMockProcess();
    mockProcess.stdout.emit(
      'data',
      JSON.stringify({
        type: 'result',
        result: 'test response',
        session_id: 'test-session-123',
        is_error: false,
      }) + '\n'
    );

    const result = await runPromise;
    expect(result.result).toBe('test response');
    expect(result.sessionId).toBe('test-session-123');
  });

  it('should queue multiple requests', async () => {
    const { getMockProcess } = await import('child_process');

    // 複数のリクエストを送信
    const promise1 = runner.run('prompt 1');
    const promise2 = runner.run('prompt 2');

    expect(runner.getQueueLength()).toBeGreaterThanOrEqual(1);

    // 最初のレスポンス
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mockProcess = getMockProcess();
    mockProcess.stdout.emit(
      'data',
      JSON.stringify({
        type: 'result',
        result: 'response 1',
        session_id: 'test-session-123',
        is_error: false,
      }) + '\n'
    );

    const result1 = await promise1;
    expect(result1.result).toBe('response 1');

    // 2番目のレスポンス
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockProcess.stdout.emit(
      'data',
      JSON.stringify({
        type: 'result',
        result: 'response 2',
        session_id: 'test-session-123',
        is_error: false,
      }) + '\n'
    );

    const result2 = await promise2;
    expect(result2.result).toBe('response 2');
  });

  it('should call streaming callbacks', async () => {
    const { getMockProcess } = await import('child_process');

    const onText = vi.fn();
    const onComplete = vi.fn();

    const promise = runner.runStream('test prompt', { onText, onComplete });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const mockProcess = getMockProcess();

    // テキストストリーム
    mockProcess.stdout.emit(
      'data',
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello ' }],
        },
      }) + '\n'
    );

    mockProcess.stdout.emit(
      'data',
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'World!' }],
        },
      }) + '\n'
    );

    // 結果
    mockProcess.stdout.emit(
      'data',
      JSON.stringify({
        type: 'result',
        result: 'Hello World!',
        session_id: 'test-session-123',
        is_error: false,
      }) + '\n'
    );

    await promise;

    expect(onText).toHaveBeenCalledWith('Hello ', 'Hello ');
    expect(onText).toHaveBeenCalledWith('World!', 'Hello World!');
    expect(onComplete).toHaveBeenCalled();
  });

  it('should handle errors', async () => {
    const { getMockProcess } = await import('child_process');

    const onError = vi.fn();
    const promise = runner.runStream('test prompt', { onError });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const mockProcess = getMockProcess();

    // エラーレスポンス
    mockProcess.stdout.emit(
      'data',
      JSON.stringify({
        type: 'result',
        result: 'Something went wrong',
        session_id: 'test-session-123',
        is_error: true,
      }) + '\n'
    );

    await expect(promise).rejects.toThrow('Something went wrong');
    expect(onError).toHaveBeenCalled();
  });

  it('should shutdown properly', async () => {
    // プロセスを起動
    const promise = runner.run('test').catch(() => {
      // shutdown によるエラーは無視
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    runner.shutdown();
    expect(runner.isAlive()).toBe(false);

    // Promise が終了するのを待つ
    await promise;
  });

  it('should report session ID', async () => {
    const { getMockProcess } = await import('child_process');

    const promise = runner.run('test');

    await new Promise((resolve) => setTimeout(resolve, 50));
    const mockProcess = getMockProcess();

    mockProcess.stdout.emit(
      'data',
      JSON.stringify({
        type: 'result',
        result: 'ok',
        session_id: 'my-session-id',
        is_error: false,
      }) + '\n'
    );

    await promise;
    expect(runner.getSessionId()).toBe('my-session-id');

    // テスト終了前に明示的に shutdown してエラーを catch
    try {
      runner.shutdown();
    } catch {
      // ignore
    }
  });
});
