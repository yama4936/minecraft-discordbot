const fs = require('node:fs');
const path = require('node:path');

const configPath = process.env.PALWORLD_BOT_CONFIG
	|| path.join(process.cwd(), 'config.json');
const fileConfig = fs.existsSync(configPath)
	? JSON.parse(fs.readFileSync(configPath, 'utf8'))
	: {};

module.exports = {
	...fileConfig,
	token: process.env.DISCORD_TOKEN || fileConfig.token,
	clientId: process.env.DISCORD_CLIENT_ID || fileConfig.clientId,
	guildId: process.env.DISCORD_GUILD_ID || fileConfig.guildId,
	monitoring: {
		...fileConfig.monitoring,
		alertChannelId: process.env.DISCORD_ALERT_CHANNEL_ID
			|| fileConfig.monitoring?.alertChannelId,
	},
	palworldApi: {
		...fileConfig.palworldApi,
		baseUrl: process.env.PALWORLD_API_BASE_URL || fileConfig.palworldApi?.baseUrl,
		username: process.env.PALWORLD_API_USERNAME || fileConfig.palworldApi?.username,
		password: process.env.PALWORLD_API_PASSWORD || fileConfig.palworldApi?.password,
	},
};
