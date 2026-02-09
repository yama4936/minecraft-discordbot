const { SlashCommandBuilder } = require('discord.js');
const config = require('../config.json');
const { mergeMonitoringConfig, getSystemStats, formatStats, checkThresholds } = require('../monitoring');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('system-status')
		.setDescription('現在のCPU/メモリ/IO/ディスクの値を表示します。'),
	async execute(interaction) {
		const monitorConfig = mergeMonitoringConfig(config.monitoring);

		try {
			const stats = getSystemStats(monitorConfig);
			const reasons = checkThresholds(stats, monitorConfig.thresholds);
			const header = reasons.length > 0
				? `警告: ${reasons.join(' / ')}`
				: '現在の値です。';

			const message = [
				header,
				'```',
				formatStats(stats),
				'```',
			].join('\n');

			await interaction.reply(message);
		} catch (error) {
			console.error('system-status command failed:', error);
			await interaction.reply({ content: '取得に失敗しました。', ephemeral: true });
		}
	},
};
