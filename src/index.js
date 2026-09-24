import { Client, Events, GatewayIntentBits, Options, Partials } from 'discord.js';
import { askBlob } from './ai.js';
import * as actions from './actions.js';
import { aicensor, scan } from './censor.js';
import { getConfig, isLocked, loadAll } from './db.js';
import { onSetup, setup } from './setup.js';
import { settings } from './settings.js';
import { EPHEMERAL, canChat, chunk } from './util.js';
import { tick, touch } from './watcher.js';

for (const k of ['DISCORD_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'GROQ_API_KEY']) {
  if (!process.env[k]) {
    console.error(`missing ${k} in .env (see .env.example)`);
    process.exit(1);
  }
}

// Keep memory tiny: blob never needs cached messages, reactions, presences, etc.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: toggle on in the dev portal (needed for /bloblock)
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message], // Channel: receive DMs. Message: see edits to uncached messages (censor)
  makeCache: Options.cacheWithLimits({
    MessageManager: 0,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    ThreadMemberManager: 0,
    VoiceStateManager: 0,
    StageInstanceManager: 0,
    GuildScheduledEventManager: 0,
  }),
});

const commands = { setup, settings, aicensor, ...actions };
const ALWAYS_OPEN = new Set(['setup', 'settings', 'blob']); // not gated by the /settings channel allow-list

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) {
      const run = commands[i.commandName];
      if (!run || !i.inGuild()) return;
      if (!ALWAYS_OPEN.has(i.commandName) && !canChat(getConfig(i.guildId), i.channelId, i.channel?.parentId))
        return i.reply({ content: "blob isn't allowed to chat in this channel 🫧", flags: EPHEMERAL });
      return await run(i);
    }
    if (i.customId?.startsWith('setup:')) return await onSetup(i);
    if (i.isButton() && i.customId === 'blobbtn') return await i.reply({ content: 'blob 🫧', flags: EPHEMERAL });
  } catch (err) {
    console.error(`interaction error (${i.commandName ?? i.customId}):`, err);
    const msg = { content: 'blob tripped over something 😵 try again', flags: EPHEMERAL };
    await (i.deferred || i.replied ? i.followUp(msg) : i.reply(msg)).catch(() => {});
  }
});

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;

  // DMs -> blob AI
  if (!msg.inGuild()) {
    if (!msg.content.trim()) return;
    try {
      await msg.channel.sendTyping();
      const reply = await askBlob(msg.author.id, msg.content);
      for (const part of chunk(reply)) await msg.channel.send({ content: part, allowedMentions: { parse: [] } });
    } catch (err) {
      console.warn('dm chat failed:', err.message);
      await msg.channel.send('blob got confused 😵 try again in a sec').catch(() => {});
    }
    return;
  }

  touch(msg.guildId, msg.channelId);

  if (isLocked(msg.guildId, msg.author.id) && canChat(getConfig(msg.guildId), msg.channelId, msg.channel.parentId)) {
    return actions.blobify(msg).catch((err) => console.warn(`bloblock failed in ${msg.channelId}: ${err.message}`));
  }

  await scan(msg).catch((err) => console.warn(`censor scan failed in ${msg.channelId}: ${err.message}`));
});

// Editing a clean message into a blocked one is the oldest trick in the book, so scan edits too.
client.on(Events.MessageUpdate, async (_old, msg) => {
  if (msg.partial || !msg.inGuild() || msg.author.bot) return; // partial = embed-only update, no content to check
  await scan(msg).catch((err) => console.warn(`censor scan (edit) failed in ${msg.channelId}: ${err.message}`));
});

client.once(Events.ClientReady, (c) => {
  console.log(`blob is online as ${c.user.tag} in ${c.guilds.cache.size} servers 🫧`);
  setTimeout(() => tick(c).catch(console.error), 5_000);
  setInterval(() => tick(c).catch(console.error), 60_000);
});

await loadAll();
await client.login(process.env.DISCORD_TOKEN);
