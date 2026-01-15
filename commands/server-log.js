// 必要なモジュールをインポート
const fs = require('node:fs'); // ファイルシステム操作用モジュール
const path = require('node:path'); // ファイルパス操作用モジュール
const { SlashCommandBuilder } = require('discord.js'); // Discord.js のスラッシュコマンド作成用
const { minecraftPath } = require('../config.json'); // 設定ファイルから Minecraft サーバーのパスを取得

// Discord メッセージの最大文字数
const MAX_REPLY_CHARS = 1800;
// 表示するログの行数
const LOG_LINES = 20;
module.exports = {
	// スラッシュコマンドのデータを定義
	data: new SlashCommandBuilder()
		.setName('server-log') // コマンド名
		.setDescription('latest.log の最新20行を表示します。'), // コマンドの説明
	
	// コマンドが実行されたときの処理
	async execute(interaction) {
		// config.json に minecraftPath が設定されていない場合のエラーメッセージ
		if (!minecraftPath) {
			await interaction.reply('config.json に minecraftPath が設定されていません。');
			return;
		}

		// latest.log ファイルのパスを生成
		const logPath = path.join(minecraftPath, 'logs', 'latest.log');
		let content;
		try {
			// latest.log ファイルの内容を読み込む
			content = fs.readFileSync(logPath, 'utf8');
		} catch (error) {
			// ファイル読み込みエラー時の処理
			console.error(error);
			await interaction.reply('latest.log の読み込みに失敗しました。');
			return;
		}

		// ログファイルの内容を行ごとに分割し、空行を除外
		const lines = content.split(/\r?\n/).filter(Boolean);
		// 最新の LOG_LINES 行を取得
		const tail = lines.slice(-LOG_LINES).join('\n');
		// Discord メッセージの最大文字数を超えないように調整
		const body = tail.length > MAX_REPLY_CHARS ? tail.slice(-MAX_REPLY_CHARS) : tail;

		// ログの内容をコードブロックとして返信
		await interaction.reply(`\u0060\u0060\u0060\n${body}\n\u0060\u0060\u0060`);
	},
};
