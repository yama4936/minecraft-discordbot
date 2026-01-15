const { execFileSync } = require('node:child_process');
const { SlashCommandBuilder } = require('discord.js');
const { screenSession } = require('../config.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('whitelist-add')
		.setDescription('ホワイトリストにプレイヤーを追加します。')
		.addStringOption(option =>
			option.setName('player')
				.setDescription('Minecraftのプレイヤー名')
				.setRequired(true)),
	async execute(interaction) {
		const player = interaction.options.getString('player', true);
		if (!screenSession) {
			await interaction.reply('config.json に screenSession が設定されていません。');
			return;
		}

		try {
			execFileSync('screen', ['-S', screenSession, '-X', 'stuff', `whitelist add ${player}\n`]);
			await interaction.reply(`${player} をホワイトリストに追加しました。`);
		} catch (error) {
			console.error(error);
			await interaction.reply('whitelist 追加コマンドの送信に失敗しました。');
		}
	},
};
