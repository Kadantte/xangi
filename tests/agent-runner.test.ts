import { describe, it, expect } from 'vitest';
import { createAgentRunner, getBackendDisplayName } from '../src/agent-runner.js';

describe('agent-runner', () => {
  describe('createAgentRunner', () => {
    it('should create ClaudeCodeRunner for claude-code backend', () => {
      const runner = createAgentRunner('claude-code', {});
      expect(runner).toBeDefined();
      expect(runner.run).toBeDefined();
      expect(runner.runStream).toBeDefined();
    });

    it('should create CodexRunner for codex backend', () => {
      const runner = createAgentRunner('codex', {});
      expect(runner).toBeDefined();
      expect(runner.run).toBeDefined();
      expect(runner.runStream).toBeDefined();
    });

    it('should throw error for unknown backend', () => {
      expect(() => createAgentRunner('unknown' as any, {})).toThrow('Unknown agent backend');
    });
  });

  describe('getBackendDisplayName', () => {
    it('should return "Claude Code" for claude-code', () => {
      expect(getBackendDisplayName('claude-code')).toBe('Claude Code');
    });

    it('should return "Codex" for codex', () => {
      expect(getBackendDisplayName('codex')).toBe('Codex');
    });
  });
});
