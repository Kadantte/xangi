import { describe, it, expect } from 'vitest';

/**
 * annotateChannelMentions のテスト用に関数を再実装
 * （元の関数は startDiscord 内のローカル関数のため）
 */
function annotateChannelMentions(text: string): string {
  return text.replace(/<#(\d+)>/g, (match, id) => `${match} [チャンネルID: ${id}]`);
}

/**
 * コードブロック判定のテスト用
 */
function isInCodeBlock(lines: string[], targetIndex: number): boolean {
  let inCodeBlock = false;
  for (let i = 0; i <= targetIndex; i++) {
    if (lines[i].trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
  }
  return inCodeBlock;
}

/**
 * !discord コマンドをテキストから抽出（コードブロック外のみ）
 */
function extractDiscordCommands(text: string): string[] {
  const lines = text.split('\n');
  const commands: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith('!discord ')) {
      commands.push(trimmed);
    }
  }

  return commands;
}

describe('Discord Commands', () => {
  describe('annotateChannelMentions', () => {
    it('should add channel ID annotation', () => {
      const input = '<#1234567890> に投稿して';
      const result = annotateChannelMentions(input);
      expect(result).toBe('<#1234567890> [チャンネルID: 1234567890] に投稿して');
    });

    it('should handle multiple channel mentions', () => {
      const input = '<#111> と <#222> に送って';
      const result = annotateChannelMentions(input);
      expect(result).toBe('<#111> [チャンネルID: 111] と <#222> [チャンネルID: 222] に送って');
    });

    it('should not modify text without channel mentions', () => {
      const input = '普通のテキスト';
      const result = annotateChannelMentions(input);
      expect(result).toBe('普通のテキスト');
    });

    it('should handle empty string', () => {
      const result = annotateChannelMentions('');
      expect(result).toBe('');
    });
  });

  describe('isInCodeBlock', () => {
    it('should detect code block', () => {
      const lines = ['text', '```', 'code', '```', 'text'];
      expect(isInCodeBlock(lines, 0)).toBe(false);
      expect(isInCodeBlock(lines, 2)).toBe(true);
      expect(isInCodeBlock(lines, 4)).toBe(false);
    });

    it('should handle nested code blocks', () => {
      const lines = ['```', 'code1', '```', 'text', '```', 'code2', '```'];
      expect(isInCodeBlock(lines, 1)).toBe(true);
      expect(isInCodeBlock(lines, 3)).toBe(false);
      expect(isInCodeBlock(lines, 5)).toBe(true);
    });
  });

  describe('extractDiscordCommands', () => {
    it('should extract discord commands', () => {
      const text = `!discord send <#123> hello
!discord channels`;
      const commands = extractDiscordCommands(text);
      expect(commands).toEqual([
        '!discord send <#123> hello',
        '!discord channels',
      ]);
    });

    it('should skip commands inside code blocks', () => {
      const text = `コマンド例:
\`\`\`
!discord send <#123> hello
\`\`\`
実際のコマンド:
!discord channels`;
      const commands = extractDiscordCommands(text);
      expect(commands).toEqual(['!discord channels']);
    });

    it('should handle multiple code blocks', () => {
      const text = `\`\`\`
!discord send <#111> skip1
\`\`\`
!discord send <#222> include
\`\`\`
!discord send <#333> skip2
\`\`\``;
      const commands = extractDiscordCommands(text);
      expect(commands).toEqual(['!discord send <#222> include']);
    });

    it('should return empty array when no commands', () => {
      const text = '普通のテキスト\n改行あり';
      const commands = extractDiscordCommands(text);
      expect(commands).toEqual([]);
    });

    it('should handle inline code (not block)', () => {
      const text = '`!discord send` はコマンドです\n!discord channels';
      const commands = extractDiscordCommands(text);
      // インラインコードは無視されないが、行頭でないのでマッチしない
      expect(commands).toEqual(['!discord channels']);
    });
  });
});
