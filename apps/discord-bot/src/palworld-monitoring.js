const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CONTAINER = 'palworld-server';
const INTERVAL_MS = 60_000;
const ALERT_COOLDOWN_MS = 30 * 60_000;
const DISCORD_EVENT_DIR = '/mnt/data/.palworld/.discord-events';

function runDocker(args) {
	return execFileSync('docker', args, {
		encoding: 'utf8',
		timeout: 15_000,
	}).trim();
}

function getContainerState() {
	try {
		const output = runDocker(['inspect', '--format', '{{.State.Status}}', CONTAINER]);
		return output || 'unknown';
	} catch {
		return 'missing';
	}
}

function parseDiskUsage(output) {
	const lines = output.trim().split(/\r?\n/);
	const fields = lines.at(-1).trim().split(/\s+/);
	return Number((fields[4] || '').replace('%', ''));
}

function getDiskUsage(path) {
	const output = runDocker(['exec', CONTAINER, 'df', '-P', path]);
	return parseDiskUsage(output);
}

function startPalworldMonitoring(client, alertChannelId) {
	let previousState;
	const lastAlertAt = new Map();
	let checking = false;

	const sendAlert = async (key, message, force = false) => {
		const now = Date.now();
		if (!force && now - (lastAlertAt.get(key) || 0) < ALERT_COOLDOWN_MS) return;

		const channel = await client.channels.fetch(alertChannelId);
		if (!channel || !channel.isTextBased()) {
			throw new Error('Palworld監視チャンネルを取得できません。');
		}

		await channel.send(message);
		lastAlertAt.set(key, now);
	};

	const sendQueuedEvents = async () => {
		if (!fs.existsSync(DISCORD_EVENT_DIR)) return;

		const eventFiles = fs.readdirSync(DISCORD_EVENT_DIR)
			.filter(file => file.endsWith('.txt'))
			.sort();

		for (const eventFile of eventFiles) {
			const eventPath = path.join(DISCORD_EVENT_DIR, eventFile);
			const message = fs.readFileSync(eventPath, 'utf8').trim();
			if (!message) {
				fs.unlinkSync(eventPath);
				continue;
			}

			await sendAlert(`queued:${eventFile}`, message, true);
			fs.unlinkSync(eventPath);
		}
	};

	const check = async () => {
		if (checking) return;
		checking = true;

		try {
			await sendQueuedEvents();
			const state = getContainerState();
			if (previousState !== undefined && state !== previousState) {
				await sendAlert(
					`state:${state}`,
					state === 'running'
						? [
							'## ✅ Palworldサーバー復旧',
							'サーバーが再び接続可能になりました。',
							'接続ポート: `8211/UDP`',
						].join('\n')
						: [
							'## 🚨 Palworldサーバー停止',
							`現在の状態: **${state}**`,
							'管理者は `/palworld status` で確認してください。',
						].join('\n'),
					true,
				);
			}
			previousState = state;

			if (state !== 'running') {
				await sendAlert('not-running', [
					'## 🚨 Palworldサーバー異常',
					`サーバーが稼働していません（状態: **${state}**）。`,
					'管理者は `/palworld start` または `/palworld restart` を実行してください。',
				].join('\n'));
				return;
			}

			const hddUsage = getDiskUsage('/pal/Package/Pal/Saved');
			if (hddUsage >= 90) {
				await sendAlert('hdd', [
					'## ⚠️ Palworld保存先HDDの容量警告',
					`HDD使用率が **${hddUsage}%** に達しました。`,
					'セーブデータやバックアップの整理を検討してください。',
				].join('\n'));
			}
		} catch (error) {
			console.error('Palworld監視に失敗しました:', error);
			await sendAlert('monitor-error', `⚠️ Palworld監視処理でエラーが発生しました: ${error.message}`);
		} finally {
			checking = false;
		}
	};

	check();
	setInterval(check, INTERVAL_MS);
	console.log('Palworld監視を開始しました。');
}

module.exports = { startPalworldMonitoring };
