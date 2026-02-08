# 使い方ガイド

xangiの詳細な使い方ガイドです。

## 目次

- [基本操作](#基本操作)
- [セッション管理](#セッション管理)
- [スケジューラー](#スケジューラー)
- [Discordコマンド](#discordコマンド)
- [コマンドプレフィックス](#コマンドプレフィックス)
- [ランタイム設定](#ランタイム設定)
- [AIによる自律操作](#aiによる自律操作)

## 基本操作

### メンションで呼び出し
```
@xangi 質問内容
```

### 専用チャンネル
`AUTO_REPLY_CHANNELS` に設定したチャンネルではメンション不要で応答します。

## セッション管理

| コマンド | 説明 |
|----------|------|
| `/new`, `!new`, `new` | 新しいセッションを開始 |
| `/clear`, `!clear`, `clear` | セッション履歴をクリア |

## スケジューラー

定期実行やリマインダーを設定できます。AIが自然言語を解釈して `!schedule` コマンドを自動実行します。

### コマンド一覧

| コマンド | 説明 |
|----------|------|
| `/schedule` | スラッシュコマンドでスケジュール操作 |
| `!schedule <時間> <メッセージ>` | スケジュール追加 |
| `!schedule list` / `!schedule` | 一覧表示（全チャンネル） |
| `!schedule remove <番号>` | 削除（複数可: `remove 1 2 3`） |
| `!schedule toggle <番号>` | 有効/無効切り替え |

> 💡 `/schedule` スラッシュコマンドでも同様の操作ができます。

### 時間指定の書き方

#### 単発リマインダー
```
30分後 〇〇をリマインド
1時間後 会議の準備
15:30 今日の15時半に通知
```

#### 繰り返し（自然言語）
```
毎日 9:00 朝の挨拶
毎日 18:00 日報を書く
毎週月曜 10:00 週次レポート
毎週金曜 17:00 週末の予定確認
```

#### cron式
より細かい制御が必要な場合はcron式も使えます：

```
0 9 * * * 毎日9時
0 */2 * * * 2時間ごと
30 8 * * 1-5 平日8:30
0 0 1 * * 毎月1日
```

| フィールド | 値 | 説明 |
|------------|-----|------|
| 分 | 0-59 | |
| 時 | 0-23 | |
| 日 | 1-31 | |
| 月 | 1-12 | |
| 曜日 | 0-6 | 0=日曜, 1=月曜, ... |

### CLI（コマンドライン）

```bash
# スケジュール追加
npx tsx src/schedule-cli.ts add --channel <channelId> "毎日 9:00 おはよう"

# 一覧表示
npx tsx src/schedule-cli.ts list

# 削除（番号指定）
npx tsx src/schedule-cli.ts remove --channel <channelId> 1

# 複数削除
npx tsx src/schedule-cli.ts remove --channel <channelId> 1 2 3

# 有効/無効切り替え
npx tsx src/schedule-cli.ts toggle --channel <channelId> 1
```

### データ保存

スケジュールデータは `${DATA_DIR}/schedules.json` に保存されます。

- デフォルト: `/workspace/.xangi/schedules.json`
- 環境変数 `DATA_DIR` で変更可能

## Discordコマンド

AIがDiscord操作を実行するためのコマンドです。

| コマンド | 説明 |
|----------|------|
| `!discord send <#channel> メッセージ` | 指定チャンネルにメッセージ送信 |
| `!discord channels` | サーバーのチャンネル一覧表示 |
| `!discord search キーワード` | 現在のチャンネルでメッセージ検索 |

### 使用例

```
# 別チャンネルに投稿
!discord send <#1234567890> 作業完了しました！

# チャンネル一覧を確認
!discord channels

# メッセージを検索
!discord search PR
```

## コマンドプレフィックス

AIの実行権限を制御します。

| プレフィックス | 説明 |
|----------------|------|
| `!skip` | 許可確認をスキップして実行 |
| `!noskip` | 許可確認ありで実行（デフォルトスキップ時） |

### 使用例

```
@xangi !skip gh pr list
@xangi !noskip rm -rf /tmp/test
```

## ランタイム設定

`${WORKSPACE_PATH}/settings.json` にランタイム設定が保存されます。

```json
{
  "autoRestart": true
}
```

| 設定 | 説明 | デフォルト |
|------|------|-----------|
| `autoRestart` | AIエージェントによる再起動を許可 | `true` |

### 設定の確認・変更

| コマンド | 説明 |
|----------|------|
| `/settings` | 現在の設定を表示 |
| `/restart` | ボットを再起動 |

## AIによる自律操作

### 設定変更（ローカル実行時のみ）

AIは `.env` ファイルを編集して設定を変更できます：

```
「このチャンネルでも応答して」
→ AIが AUTO_REPLY_CHANNELS を編集 → 再起動
```

### システムコマンド

AIが出力する特殊コマンド：

| コマンド | 説明 |
|----------|------|
| `SYSTEM_COMMAND:restart` | ボットを再起動 |

### 再起動の仕組み

- **Docker**: `restart: always` により自動復帰
- **ローカル**: pm2等のプロセスマネージャが必要

```bash
# pm2での運用例
pm2 start "npm start" --name xangi
pm2 logs xangi
```
