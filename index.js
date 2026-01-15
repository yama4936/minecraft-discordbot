const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { token } = require('./config.json');

// Only the intent needed for slash commands in guilds.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

client.on('ready', () => {
	console.log(`${client.user.tag}でログインしました。`);
});

const commandsRoot = path.join(__dirname, 'commands');
const commandEntries = fs.readdirSync(commandsRoot);

for (const entry of commandEntries) {
	const entryPath = path.join(commandsRoot, entry);
	const stats = fs.statSync(entryPath);
	const commandFiles = stats.isDirectory()
		? fs.readdirSync(entryPath).filter(file => file.endsWith('.js')).map(file => path.join(entryPath, file))
		: entryPath.endsWith('.js') ? [entryPath] : [];

	for (const filePath of commandFiles) {
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`${interaction.commandName} に一致するコマンドが見つかりませんでした。`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'このコマンドの実行中にエラーが発生しました！', flags: MessageFlags.Ephemeral });
		} else {
			await interaction.reply({ content: 'このコマンドの実行中にエラーが発生しました！', flags: MessageFlags.Ephemeral });
		}
	}
});

client.login(token);
