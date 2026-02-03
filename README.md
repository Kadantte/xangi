# xangi

> **A**I **N**EON **G**ENESIS **I**NTELLIGENCE
>
> A multi-AI CLI wrapper for chat platforms.

複数のAI CLIを統合し、様々なチャットプラットフォームから利用できるアシスタント。

## Features

- 🤖 複数のAI CLIを統合（Claude Code / Codex CLI）
- 💬 様々なチャットプラットフォームに対応（Discord / Slack）
- 👤 シングルユーザー設計
- 🐳 Docker対応（コンテナ隔離環境）
- 📚 スキルシステム（スラッシュコマンド対応）
- 🐙 GitHub CLI（gh）対応

## シングルユーザー設計

このbotは**1人のユーザー**が使用する設計です。

## Quick Start（Docker）

### 1. 事前準備

```bash
# 環境変数設定
cp .env.example .env
# .env を編集（DISCORD_TOKEN, DISCORD_ALLOWED_USER は必須）
```

### 2. 起動

```bash
docker compose up -d --build
```

### 3. AI CLI認証（コンテナ内）

**Claude Code（デフォルト）:**
```bash
docker exec -it xangi claude
```

対話モードが起動すると自動的に認証フローが開始されます。
表示されたURLをブラウザで開いて認証してください。

認証情報は Docker volume (`xangi_claude-data`) に保存され、コンテナ再起動後も維持されます。

**Codex CLI（AGENT_BACKEND=codex の場合）:**
```bash
docker exec -it xangi codex login --device-auth
```

デバイスコード方式で認証します。表示されたコードをブラウザで入力してください。

**注意:** ChatGPTの設定で「Codex CLI」を有効にしておく必要があります。

認証情報は Docker volume (`xangi_codex-data`) に保存されます。

### 4. GitHub CLI認証（オプション）

```bash
docker exec -it xangi gh auth login
```

ブラウザ認証またはトークン入力で認証。ghコマンドが使えるようになります。

### 5. 動作確認

Discord/Slackでbotにメンションして話しかけてください。

## 使い方

### 基本
- `@xangi 質問内容` - メンションで反応
- 専用チャンネル設定時はメンション不要

### セッション管理
- `/new`, `!new`, `new` - 新しいセッションを開始
- `/clear`, `!clear`, `clear` - セッション履歴をクリア

### コマンドプレフィックス
- `!skip` - 許可確認をスキップして実行
- `!noskip` - 許可確認ありで実行（デフォルトスキップ時）

### 例
```
@xangi このリポジトリのissue一覧見せて
@xangi !skip gh pr list
```

## 環境変数

### Discord

| 変数 | 説明 |
|------|------|
| `DISCORD_TOKEN` | Discord Bot Token |
| `DISCORD_ALLOWED_USER` | 許可ユーザーID（1人のみ） |
| `AUTO_REPLY_CHANNELS` | メンションなしで応答するチャンネルID（カンマ区切り） |
| `DISCORD_STREAMING` | ストリーミング出力（デフォルト: `true`） |
| `DISCORD_SHOW_THINKING` | 思考過程を表示（デフォルト: `true`）※falseの場合は「考え中...」アニメーション |

### Slack

| 変数 | 説明 |
|------|------|
| `SLACK_BOT_TOKEN` | Slack Bot Token（xoxb-...） |
| `SLACK_APP_TOKEN` | Slack App Token（xapp-...）※Socket Mode用 |
| `SLACK_SIGNING_SECRET` | Slack Signing Secret |
| `SLACK_AUTO_REPLY_CHANNELS` | メンションなしで応答するチャンネルID（カンマ区切り） |
| `SLACK_ALLOWED_USER` | Slack用の許可ユーザーID |
| `SLACK_REPLY_IN_THREAD` | スレッド返信するか（デフォルト: `true`） |
| `SLACK_STREAMING` | ストリーミング出力（デフォルト: `true`） |
| `SLACK_SHOW_THINKING` | 思考過程を表示（デフォルト: `true`）※falseの場合は「考え中...」アニメーション |

### AIエージェント設定

| 変数 | 説明 |
|------|------|
| `AGENT_BACKEND` | 使用するAI CLI（`claude-code` / `codex`、デフォルト: `claude-code`） |
| `AGENT_MODEL` | 使用するモデル（バックエンド依存） |
| `WORKSPACE_PATH` | AI CLIの作業ディレクトリ（ホストのパス） |
| `SKIP_PERMISSIONS` | デフォルトで許可スキップ（`true`/`false`） |
| `TIMEOUT_MS` | タイムアウト（デフォルト: 300000 = 5分） |

**注意:** Discord または Slack のどちらか一方のTokenが必要です（両方設定すれば両方起動）。

## マウント設定

| ホスト | コンテナ | 説明 |
|--------|----------|------|
| `${WORKSPACE_PATH}` | `/workspace` | 作業ディレクトリ |
| `~/.gitconfig` | `/home/node/.gitconfig` | Git設定 |
| `xangi_claude-data` volume | `/home/node/.claude` | Claude認証 |
| `xangi_codex-data` volume | `/home/node/.codex` | Codex認証 |
| `xangi_gh-data` volume | `/home/node/.config/gh` | GitHub CLI認証 |

## ドキュメント

- [Discord セットアップ](docs/discord-setup.md)
- [Slack セットアップ](docs/slack-setup.md)

## License

MIT
