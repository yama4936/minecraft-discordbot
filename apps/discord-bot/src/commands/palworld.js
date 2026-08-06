const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const {
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} = require('discord.js');
const { palworldApi } = require('../config');

const execFileAsync = promisify(execFile);
const COMPOSE_FILE = '/mnt/data/.palworld/compose.yaml';
const CONTAINER = 'palworld-server';
const SERVER_INI = '/pal/Package/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini';
const BOT_CONFIG = process.env.PALWORLD_BOT_CONFIG || '/etc/palworld/bot.json';

async function docker(args, timeout = 30_000) {
	const { stdout, stderr } = await execFileAsync('docker', args, {
		encoding: 'utf8',
		timeout,
		maxBuffer: 1024 * 1024,
	});
	return `${stdout}${stderr}`.trim();
}

async function lastBackupLog() {
	try {
		const { stdout } = await execFileAsync('journalctl', [
			'-t', 'palworld-backup',
			'-n', '1',
			'--no-pager',
			'-o', 'cat',
		], {
			encoding: 'utf8',
			timeout: 10_000,
			maxBuffer: 64 * 1024,
		});
		return stdout.trim() || '実行履歴がありません';
	} catch {
		return '取得できませんでした';
	}
}

function formatJst(date) {
	return new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	}).format(date);
}

function formatBackupLog(log) {
	const match = log.match(
		/ok source=(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}) short=(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/,
	);
	if (!match) return log;

	const [
		,
		sourceYear,
		sourceMonth,
		sourceDay,
		sourceHour,
		sourceMinute,
		sourceSecond,
		runYear,
		runMonth,
		runDay,
		runHour,
		runMinute,
	] = match;
	const sourceUtc = new Date(Date.UTC(
		Number(sourceYear),
		Number(sourceMonth) - 1,
		Number(sourceDay),
		Number(sourceHour),
		Number(sourceMinute),
		Number(sourceSecond),
	));
	const runJst = `${runYear}/${runMonth}/${runDay} ${runHour}:${runMinute}`;

	return [
		'✅ 正常',
		`最終実行: ${runJst} JST`,
		`対象セーブ: ${formatJst(sourceUtc)} JST`,
	].join('\n');
}

function isAdministrator(interaction) {
	return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

async function apiRequest(endpoint, options = {}) {
	if (!palworldApi?.baseUrl || !palworldApi?.password) {
		throw new Error('Palworld REST APIが設定されていません。');
	}

	const authorization = Buffer.from(
		`${palworldApi.username || 'admin'}:${palworldApi.password}`,
	).toString('base64');
	const response = await fetch(`${palworldApi.baseUrl}${endpoint}`, {
		method: options.method || 'GET',
		headers: {
			Authorization: `Basic ${authorization}`,
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(`Palworld API応答エラー（${response.status}）`);
	}

	const text = await response.text();
	return text ? JSON.parse(text) : {};
}

async function updateServerPassword(newPassword) {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'palworld-password-'));
	const tempIni = path.join(tempDir, 'PalWorldSettings.ini');

	try {
		await docker(['cp', `${CONTAINER}:${SERVER_INI}`, tempIni]);
		const current = fs.readFileSync(tempIni, 'utf8');
		const updated = current.replace(
			/ServerPassword=(?:"[^"]*"|[^,)\r\n]*)/,
			`ServerPassword="${newPassword.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
		);
		if (updated === current) {
			throw new Error('ServerPassword設定が見つかりません。');
		}

		fs.writeFileSync(tempIni, updated, { mode: 0o600 });
		await docker(['cp', tempIni, `${CONTAINER}:${SERVER_INI}`]);
		await apiRequest('/save', { method: 'POST' });
		await docker(['compose', '-f', COMPOSE_FILE, 'restart'], 150_000);

		const config = JSON.parse(fs.readFileSync(BOT_CONFIG, 'utf8'));
		config.palworldJoin = { password: newPassword };
		const configTemp = `${BOT_CONFIG}.new`;
		fs.writeFileSync(configTemp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(configTemp, BOT_CONFIG);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

function parseDf(output) {
	const fields = output.trim().split(/\r?\n/).at(-1).trim().split(/\s+/);
	return {
		size: fields[1],
		used: fields[2],
		available: fields[3],
		percent: fields[4],
	};
}

function parseInspect(output) {
	const [startedAt, restartCount] = output.trim().split('|');
	const startedUnix = Math.floor(new Date(startedAt).getTime() / 1000);
	return {
		startedUnix: Number.isFinite(startedUnix) ? startedUnix : null,
		restartCount: Number(restartCount) || 0,
	};
}

function formatUptime(startedUnix) {
	if (!startedUnix) return '取得できませんでした';

	const totalMinutes = Math.max(0, Math.floor((Date.now() / 1000 - startedUnix) / 60));
	const days = Math.floor(totalMinutes / 1440);
	const hours = Math.floor((totalMinutes % 1440) / 60);
	const minutes = totalMinutes % 60;

	return [
		days > 0 ? `${days}日` : '',
		hours > 0 || days > 0 ? `${hours}時間` : '',
		`${minutes}分`,
	].filter(Boolean).join('');
}

function parseContainerStats(output) {
	const stats = JSON.parse(output);
	const cpuPercent = Number.parseFloat(stats.CPUPerc) || 0;
	const totalCores = os.cpus().length || 1;
	const usedCores = cpuPercent / 100;
	const hostPercent = (usedCores / totalCores) * 100;

	return {
		cpu: `マシン全体の約${hostPercent.toFixed(1)}%\n使用: ${usedCores.toFixed(2)} / ${totalCores}コア`,
		memory: `${stats.MemUsage}（${stats.MemPerc}）`,
		pids: stats.PIDs || '不明',
		network: stats.NetIO || '取得できませんでした',
		blockIo: stats.BlockIO || '取得できませんでした',
	};
}

function summarizeLogs(logs) {
	const version = logs.match(/Game version is ([^\s]+)/)?.[1] || '取得できませんでした';
	const listening = /Running Palworld dedicated server on :8211/.test(logs);
	const steamReady = /SteamAPI_Init\(\): Loaded local 'steamclient\.so' OK/.test(logs);

	const ignoredPatterns = [
		/xdg-user-dir: not found/,
		/\[S_API FAIL\]/,
		/Steam interface/,
		/IPC function call/,
		/x-sentry-error/i,
	];
	const seriousLines = logs.split(/\r?\n/)
		.filter(line => /error|fail|fatal|crash/i.test(line))
		.filter(line => !ignoredPatterns.some(pattern => pattern.test(line)));

	return {
		version,
		listening,
		steamReady,
		seriousErrorCount: seriousLines.length,
	};
}

function statusEmbed({ running, version, disk, runtime, resources, backupLog }) {
	const embed = new EmbedBuilder()
		.setColor(running ? 0x57f287 : 0xed4245)
		.setTitle(`${running ? '🟢' : '🔴'} Palworld サーバー`)
		.setDescription(running ? '正常に稼働しています。' : '現在停止しています。')
		.setTimestamp();

	if (!running) return embed;

	return embed.addFields(
		{
			name: '起動時刻',
			value: runtime.startedUnix ? `<t:${runtime.startedUnix}:F>\n（<t:${runtime.startedUnix}:R>）` : '取得できませんでした',
			inline: true,
		},
		{ name: '連続稼働時間', value: formatUptime(runtime.startedUnix), inline: true },
		{ name: 'ゲームバージョン', value: version || '取得できませんでした', inline: true },
		{ name: '再起動回数', value: `${runtime.restartCount}回`, inline: true },
		{ name: 'CPU使用量', value: resources.cpu, inline: true },
		{ name: 'メモリ使用量', value: resources.memory, inline: true },
		{ name: 'プロセス数', value: `${resources.pids}`, inline: true },
		{ name: '接続先', value: '`サーバーIP:8211`', inline: false },
		{
			name: 'ライブセーブ（SSD）',
			value: [
				'ボリューム: `palworld_ssd`',
				'コンテナ内: `/pal/Package/Pal/Saved`',
				'ホスト側: `/var/lib/docker/volumes/palworld_ssd/_data`',
				`使用 ${disk.used} / ${disk.size}（${disk.percent}）`,
				`空き ${disk.available}`,
			].join('\n'),
			inline: false,
		},
		{
			name: '世代バックアップ（HDD）',
			value: [
				'ボリューム: `palworld_hdd`',
				'保存先: `/.palworld/generation-backups`',
				'ホスト側: `/var/lib/docker/volumes/palworld_hdd/_data/.palworld/generation-backups`',
				'10分ごと・短期36・時間24・日次30・週次12世代',
				formatBackupLog(backupLog || '実行履歴がありません'),
			].join('\n'),
			inline: false,
		},
		{
			name: '累計通信量',
			value: `受信 / 送信: ${resources.network}`,
			inline: true,
		},
		{
			name: '累計ディスクI/O',
			value: `読込 / 書込: ${resources.blockIo}`,
			inline: true,
		},
	);
}

function resultEmbed(action, success) {
	const labels = {
		start: '起動',
		stop: '停止',
		restart: '再起動',
	};

	return new EmbedBuilder()
		.setColor(success ? 0x57f287 : 0xed4245)
		.setTitle(`${success ? '✅' : '❌'} Palworldサーバーの${labels[action]}`)
		.setDescription(success
			? `${labels[action]}操作が完了しました。`
			: `${labels[action]}操作に失敗しました。管理者はBotのtmuxログを確認してください。`)
		.setTimestamp();
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('palworld')
		.setDescription('Palworldサーバーを管理します。')
		.addSubcommand(command =>
			command.setName('status').setDescription('稼働状態と使用量を表示します。'))
		.addSubcommand(command =>
			command.setName('logs').setDescription('最新ログを表示します。'))
		.addSubcommand(command =>
			command.setName('start').setDescription('サーバーを起動します。'))
		.addSubcommand(command =>
			command.setName('stop').setDescription('サーバーを安全に停止します。'))
		.addSubcommand(command =>
			command.setName('restart').setDescription('サーバーを再起動します。'))
		.addSubcommand(command =>
			command.setName('players').setDescription('現在接続中のプレイヤーを表示します。'))
		.addSubcommand(command =>
			command.setName('join').setDescription('接続先とパスワードを本人だけに表示します。'))
		.addSubcommand(command =>
			command.setName('kick')
				.setDescription('指定プレイヤーを退出させます。')
				.addStringOption(option =>
					option.setName('userid')
						.setDescription('playersで表示されるユーザーID')
						.setRequired(true))
				.addStringOption(option =>
					option.setName('reason')
						.setDescription('退出理由')
						.setMaxLength(200)))
		.addSubcommand(command =>
			command.setName('ban')
				.setDescription('指定プレイヤーをBANします。')
				.addStringOption(option =>
					option.setName('userid')
						.setDescription('playersで表示されるユーザーID')
						.setRequired(true))
				.addStringOption(option =>
					option.setName('reason')
						.setDescription('BAN理由')
						.setMaxLength(200)))
		.addSubcommand(command =>
			command.setName('unban')
				.setDescription('指定プレイヤーのBANを解除します。')
				.addStringOption(option =>
					option.setName('userid')
						.setDescription('解除するユーザーID')
						.setRequired(true)))
		.addSubcommand(command =>
			command.setName('password')
				.setDescription('サーバー接続パスワードを変更します。')
				.addStringOption(option =>
					option.setName('new_password')
						.setDescription('新しい接続パスワード（8文字以上）')
						.setMinLength(8)
						.setMaxLength(64)
						.setRequired(true))),

	async execute(interaction) {
		const action = interaction.options.getSubcommand();
		const adminActions = ['start', 'stop', 'restart', 'kick', 'ban', 'unban', 'password'];
		const requiresAdmin = adminActions.includes(action);
		const privateReply = requiresAdmin || action === 'join';

		if (requiresAdmin && !isAdministrator(interaction)) {
			await interaction.reply({
				content: 'この操作にはDiscordの管理者権限が必要です。',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({
			flags: privateReply ? MessageFlags.Ephemeral : undefined,
		});

		try {
			if (action === 'status') {
				const rawStatus = await docker([
					'ps',
					'--filter', `name=^/${CONTAINER}$`,
					'--format', '{{.State}}',
				]);
				const running = Boolean(rawStatus);
				if (!running) {
					await interaction.editReply({ embeds: [statusEmbed({ running: false })] });
					return;
				}

				const usage = parseDf(await docker([
					'exec', CONTAINER, 'df', '-h',
					'/pal/Package/Pal/Saved',
				]));
				const [serverInfo, versionLog, backupLog] = await Promise.all([
					apiRequest('/info').catch(() => ({})),
					docker(['logs', '--tail', '300', CONTAINER]),
					lastBackupLog(),
				]);
				const summary = summarizeLogs(versionLog);
				const runtime = parseInspect(await docker([
					'inspect',
					'--format', '{{.State.StartedAt}}|{{.RestartCount}}',
					CONTAINER,
				]));
				const resources = parseContainerStats(await docker([
					'stats',
					'--no-stream',
					'--format', '{{json .}}',
					CONTAINER,
				]));

				await interaction.editReply({
					embeds: [statusEmbed({
						running: true,
						version: serverInfo.version || summary.version,
						disk: usage,
						runtime,
						resources,
						backupLog,
					})],
				});
				return;
			}

			if (action === 'logs') {
				const [logs, serverInfo, metrics, backupLog] = await Promise.all([
					docker(['logs', '--tail', '300', CONTAINER]),
					apiRequest('/info').catch(() => ({})),
					apiRequest('/metrics').catch(() => ({})),
					lastBackupLog(),
				]);
				const summary = summarizeLogs(logs);
				const version = serverInfo.version || summary.version;
				const apiHealthy = Boolean(serverInfo.version);
				const embed = new EmbedBuilder()
					.setColor(apiHealthy && summary.seriousErrorCount === 0 ? 0x57f287 : 0xfee75c)
					.setTitle('📋 Palworld 動作診断')
					.setDescription(apiHealthy
						? 'REST APIと直近ログを確認しました。サーバーは正常に応答しています。'
						: 'REST APIからサーバー情報を取得できませんでした。')
					.addFields(
						{ name: 'ゲームバージョン', value: version, inline: true },
						{
							name: 'サーバーFPS',
							value: Number.isFinite(Number(metrics.serverfps))
								? `${metrics.serverfps} FPS`
								: '取得できませんでした',
							inline: true,
						},
						{
							name: '接続人数',
							value: Number.isFinite(Number(metrics.currentplayernum))
								? `${metrics.currentplayernum}人`
								: '取得できませんでした',
							inline: true,
						},
						{ name: 'ライブセーブ', value: '✅ SSD', inline: true },
						{
							name: 'HDD世代バックアップ',
							value: `10分ごと\n${formatBackupLog(backupLog).slice(0, 240)}`,
							inline: false,
						},
						{
							name: '重大なエラー',
							value: summary.seriousErrorCount === 0
								? '✅ 見つかりませんでした'
								: `⚠️ ${summary.seriousErrorCount}件検出しました`,
							inline: false,
						},
						{
							name: '補足',
							value: '`S_API FAIL` と `xdg-user-dir` は動作に影響しないため表示から除外しています。',
						},
					)
					.setTimestamp();
				await interaction.editReply({ embeds: [embed] });
				return;
			}

			if (action === 'players') {
				const result = await apiRequest('/players');
				const players = Array.isArray(result.players) ? result.players : [];
				const embed = new EmbedBuilder()
					.setColor(0x5865f2)
					.setTitle(`👥 接続中のプレイヤー（${players.length}人）`)
					.setDescription(players.length === 0
						? '現在接続しているプレイヤーはいません。'
						: players.map((player, index) => [
							`**${index + 1}. ${player.name || '名前不明'}**`,
							`レベル: ${player.level ?? '不明'} / Ping: ${Math.round(player.ping ?? 0)}ms`,
							`ユーザーID: \`${player.userId || '不明'}\``,
						].join('\n')).join('\n\n'))
					.setTimestamp();
				await interaction.editReply({ embeds: [embed] });
				return;
			}

			if (action === 'join') {
				if (!interaction.inGuild()) {
					await interaction.editReply('このコマンドはDiscordサーバー内でのみ利用できます。');
					return;
				}

				const config = JSON.parse(fs.readFileSync(BOT_CONFIG, 'utf8'));
				const password = config.palworldJoin?.password;
				if (!password) {
					await interaction.editReply('接続パスワードがまだ設定されていません。');
					return;
				}

				const embed = new EmbedBuilder()
					.setColor(0x5865f2)
					.setTitle('🎮 Palworld 接続情報')
					.setDescription('この内容はあなたにだけ表示されています。')
					.addFields(
						{ name: '接続先', value: '`サーバーIP:8211`' },
						{ name: 'パスワード', value: `||${password}||` },
					)
					.setFooter({ text: 'パスワードをDiscord外へ共有しないでください。' })
					.setTimestamp();
				await interaction.editReply({ embeds: [embed] });
				return;
			}

			if (['kick', 'ban', 'unban'].includes(action)) {
				const userid = interaction.options.getString('userid', true);
				const reason = interaction.options.getString('reason')
					|| (action === 'kick' ? '管理者により退出されました。' : '管理者による操作です。');
				const body = action === 'unban' ? { userid } : { userid, message: reason };
				await apiRequest(`/${action}`, { method: 'POST', body });

				const labels = { kick: '退出', ban: 'BAN', unban: 'BAN解除' };
				const embed = new EmbedBuilder()
					.setColor(0x57f287)
					.setTitle(`✅ ${labels[action]}しました`)
					.setDescription(`対象ユーザー: \`${userid}\``)
					.setTimestamp();
				await interaction.editReply({ embeds: [embed] });
				return;
			}

			if (action === 'password') {
				const newPassword = interaction.options.getString('new_password', true);
				await updateServerPassword(newPassword);
				const embed = new EmbedBuilder()
					.setColor(0x57f287)
					.setTitle('✅ 接続パスワードを変更しました')
					.setDescription('新しいパスワードを反映するため、Palworldサーバーを再起動しました。')
					.setFooter({ text: 'パスワードは安全のため再表示しません。' })
					.setTimestamp();
				await interaction.editReply({ embeds: [embed] });
				return;
			}

			const composeArgs = ['compose', '-f', COMPOSE_FILE];
			if (action === 'start') composeArgs.push('up', '-d');
			if (action === 'stop') composeArgs.push('stop');
			if (action === 'restart') composeArgs.push('restart');

			await docker(composeArgs, 150_000);
			await interaction.editReply({ embeds: [resultEmbed(action, true)] });
		} catch (error) {
			console.error(`palworld ${action} failed:`, error);
			const embed = new EmbedBuilder()
				.setColor(0xed4245)
				.setTitle('❌ 操作に失敗しました')
				.setDescription(error.message.startsWith('Palworld API')
					? error.message
					: '管理者はBotのtmuxログを確認してください。')
				.setTimestamp();
			await interaction.editReply({
				embeds: [embed],
			});
		}
	},
};
