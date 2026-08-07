# 本番切替手順

## 切替対象

- 待機デプロイ: `dpl_2suoHGybhEeYsuLojYqesDVexnwf`
- 待機URL: `https://palworld-server-guide-arp0gdmmk-yama4936s-projects.vercel.app`
- 現行デプロイ: `dpl_Afe1km8R9DgxAKGwnaHD7u74pd7x`
- 公開URL: `https://new-chat-mu-three.vercel.app`
- `lsemi` モノレポ: `/home/lsemi/palworld-server`

待機デプロイには履歴と最新スナップショットを投入済みです。systemd unitは登録済みですが、無効・停止状態です。

ユーザーsystemdをSSH切断後も常駐させるため、`loginctl enable-linger lsemi` を事前に実行します。

## 切替

ローカルのモノレポで待機デプロイを昇格します。

```sh
vercel promote dpl_2suoHGybhEeYsuLojYqesDVexnwf --yes
curl -fsS https://new-chat-mu-three.vercel.app/api/health
```

続いて `lsemi` で旧tmuxプロセスを止め、準備済みのユーザーsystemdへ切り替えます。

```sh
sed -i 's#^PALWORLD_API_URL=.*#PALWORLD_API_URL=https://new-chat-mu-three.vercel.app/api#' ~/.config/palworld/palworld.env
crontab ~/.config/palworld/crontab.after-cutover
tmux kill-session -t palworld-stats
tmux kill-session -t discord-admin
systemctl --user enable --now palworld-collector.service palworld-discord-bot.service
systemctl --user --no-pager --full status palworld-collector.service palworld-discord-bot.service
```

統計APIとサービスログを確認します。

```sh
curl -fsS https://new-chat-mu-three.vercel.app/api/stats | jq '{latest, players: (.players | length)}'
journalctl --user -u palworld-collector.service -u palworld-discord-bot.service --since '-10 minutes' --no-pager
```

安定確認後、`VERCEL_AUTOMATION_BYPASS_SECRET` と旧Upstash環境変数・資源、`LEGACY_INGEST_TOKEN` を削除します。

## ロールバック

```sh
systemctl --user disable --now palworld-collector.service palworld-discord-bot.service
crontab ~/.config/palworld/crontab.before-cutover
tmux new-session -d -s discord-admin /mnt/data/minecraft/minecraft-discordbot/start-bot.sh
tmux new-session -d -s palworld-stats /mnt/data/minecraft/minecraft-discordbot/start-palworld-stats.sh
```

ローカルから現行Vercelデプロイへ戻します。

```sh
vercel rollback dpl_Afe1km8R9DgxAKGwnaHD7u74pd7x --yes
```
