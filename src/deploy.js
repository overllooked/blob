// Registers slash commands globally:  npm run deploy
import { REST, Routes } from 'discord.js';
import { commandData } from './commands.js';

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const app = await rest.get(Routes.currentApplication());
await rest.put(Routes.applicationCommands(app.id), { body: commandData });
console.log(`registered ${commandData.length} commands for ${app.name}`);
