const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder } = require('discord.js');
const { minecraftPath } = require('../config.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('whitelist-check')
		.setDescription('ホワイトリストに登録されているユーザを一覧表示します。'),
	async execute(interaction) {
		if (!minecraftPath) {
			await interaction.reply('config.json に minecraftPath が設定されていません。');
			return;
		}

		const whitelistPath = path.join(minecraftPath, 'whitelist.json');
		let whitelist;
		try {
			whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
		} catch (error) {
			console.error(error);
			await interaction.reply('whitelist.json の読み込みに失敗しました。');
			return;
		}

		const names = whitelist
			.map(entry => entry.name)
			.filter(Boolean);

		if (names.length === 0) {
			await interaction.reply('ホワイトリストは空です。');
			return;
		}

		const list = names.join('\n');
		const body = list.length > 1800 ? `${list.slice(-1800)}` : list;
		await interaction.reply(`\`\`\`\n${body}\n\`\`\``);
	},
};
