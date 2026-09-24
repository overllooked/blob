import { ActionRowBuilder } from 'discord.js';
import { allConfigs, getConfig } from './db.js';
import { blobButton, fmtMinutes, pickEmoji } from './util.js';

// channelId -> { last: ms of last human message, pinged: already pinged for this silence }
const state = new Map();

// Called for every human message. Only tracks channels a server is actually watching.
export function touch(guildId, channelId) {
  if (!getConfig(guildId).watch_channels.includes(channelId)) return;
  state.set(channelId, { last: Date.now(), pinged: false });
}

// Called when /setup changes the watch list so stale timers are re-derived from channel history.
export const forget = (ids) => ids.forEach((id) => state.delete(id));

// After a restart, work out where we left off from the channel's recent messages.
async function seed(client, channelId) {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  const msgs = ch?.isTextBased() && !ch.isDMBased() ? await ch.messages.fetch({ limit: 10 }).catch(() => null) : null;
  if (!msgs) return { last: Date.now(), pinged: true }; // unreachable: stay quiet until someone talks
  const human = msgs.find((m) => !m.author.bot);
  return { last: human?.createdTimestamp ?? Date.now(), pinged: msgs.first()?.author.id === client.user.id };
}

let running = false;
export async function tick(client) {
  if (running) return;
  running = true;
  try {
    for (const cfg of allConfigs()) {
      const limit = cfg.inactivity_minutes * 60_000;
      for (const id of cfg.watch_channels) {
        let s = state.get(id);
        if (!s) state.set(id, (s = await seed(client, id)));
        if (s.pinged || Date.now() - s.last < limit) continue;

        s.pinged = true; // ping once per silence, not every interval
        const ch = await client.channels.fetch(id).catch(() => null);
        // Watch channels are configured explicitly in /setup, so they're exempt from the /settings channel allow-list.
        await ch
          ?.send({
            content: `@everyone ${pickEmoji(cfg)} it's been quiet for ${fmtMinutes(cfg.inactivity_minutes)}. blob is lonely`,
            components: [new ActionRowBuilder().addComponents(blobButton(cfg))],
            allowedMentions: { parse: ['everyone'] },
          })
          .catch((e) => console.warn(`ping failed in ${id}: ${e.message}`));
      }
    }
  } finally {
    running = false;
  }
}
