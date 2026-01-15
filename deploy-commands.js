const { REST, Routes } = require('discord.js');
const { clientId, token } = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
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
			commands.push(command.data.toJSON());
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

const rest = new REST().setToken(token);

(async () => {
	try {
		console.log(`${commands.length} 件のスラッシュコマンドを登録します`);

		const data = await rest.put(
			Routes.applicationCommands(clientId),
			{ body: commands },
		);

		console.log(`${data.length} 件のスラッシュコマンドを登録しました`);
	} catch (error) {
		console.error(error);
	}
})();
