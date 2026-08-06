const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('test')
		.setDescription('Pong!と返信。'),
	async execute(interaction) {
		await interaction.reply('テスト成功');
	},
};