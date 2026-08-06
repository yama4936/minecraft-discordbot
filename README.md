# Palworld Server

Palworld専用サーバーの接続ガイド、統計API、Discord Bot、統計Collectorを管理するモノレポです。

## 構成

- `apps/web`: Next.jsによる接続ガイド・統計画面・Hono API
- `apps/discord-bot`: Discordの確認・管理コマンドと監視通知
- `apps/collector`: `lsemi` 上で稼働する統計Collector
- `packages/contracts`: APIペイロード、公開レスポンス、HMAC署名
- `packages/database`: PostgreSQLスキーマ、Drizzleマイグレーション、データアクセス層
- `infrastructure`: systemdとVercelの運用設定

## ローカル開発

Node.jsのActive LTSとpnpmを使用します。

```sh
cp .env.example .env.local
pnpm install
pnpm check
pnpm test
pnpm build
```

Webのみ起動する場合:

```sh
pnpm --filter @palworld/web dev
```

## データベース

Neon PostgreSQLを前提にしています。スキーマ変更はSQLマイグレーションとしてGit管理します。

```sh
pnpm db:generate
pnpm db:migrate
```

## Collector認証

新APIでは、本文を含む次の値をHMAC-SHA256で署名します。

```text
timestamp.eventId.requestBody
```

移行期間中のみ `LEGACY_INGEST_TOKEN` によるBearer認証を利用できます。移行完了後はVercel環境変数から削除します。

## デプロイ

VercelプロジェクトのRoot Directoryを `apps/web` に設定し、このGitリポジトリへ接続します。`DATABASE_URL` と署名鍵はVercelのEnvironment Variablesで管理し、Gitには保存しません。

`lsemi` のBotとCollectorは `infrastructure/systemd` のユーザーunitを使用します。環境変数は `~/.config/palworld/palworld.env` に保存し、既存プロセスと並行確認してから切り替えてください。
