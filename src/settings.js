import { ActionRowBuilder, Routes } from 'discord.js';
import { getCensor, getConfig, saveConfig } from './db.js';
import { EPHEMERAL, STYLES, blobButton, embed, fmtMinutes, isOwner, parseEmojis, parseHex } from './util.js';

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_EMOJIS = 25;
const PRIVATE_HOST = /^(localhost|0\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[|.*\.(local|internal)$)/i;

// Turn an uploaded file or a URL into the data URI Discord wants. null = nothing given.
async function readImage(i) {
  const att = i.options.getAttachment('file');
  const raw = att?.url ?? i.options.getString('url')?.trim();
  if (!raw) return null;

  const url = new URL(raw); // throws on garbage
  if (url.protocol !== 'https:' || PRIVATE_HOST.test(url.hostname)) throw new Error('use a public https image link');

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`couldn't download that (${res.status})`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(type)) throw new Error('that isn\'t a png, jpg, gif or webp image');
  if (Number(res.headers.get('content-length')) > MAX_IMAGE) throw new Error('image is over 8 MB');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE) throw new Error('image is over 8 MB');
  return `data:${type};base64,${buf.toString('base64')}`;
}

// Per-server bot profile (nick / avatar / banner / bio)
const patchProfile = (i, body) => i.client.rest.patch(Routes.guildMember(i.guildId, '@me'), { body });

const reply = (i, content) => i.editReply({ content, embeds: [], components: [] });

export async function settings(i) {
  if (!isOwner(i)) return i.reply({ content: 'only the server owner can use `/settings` 🫧', flags: EPHEMERAL });
  await i.deferReply({ flags: EPHEMERAL });

  const sub = i.options.getSubcommand();
  const gid = i.guildId;
  const cfg = getConfig(gid);

  try {
    switch (sub) {
      case 'view': {
        const me = i.guild.members.me;
        const e = embed(gid)
          .setTitle('blob settings')
          .setThumbnail(me?.displayAvatarURL({ size: 128 }) ?? null)
          .addFields(
            { name: 'Nickname', value: me?.displayName ?? 'blob', inline: true },
            { name: 'Embed color', value: cfg.embed_color, inline: true },
            { name: 'Button', value: `${cfg.button_emoji ?? ''} ${cfg.button_label} (${cfg.button_style})`.trim(), inline: true },
            { name: 'Emojis', value: cfg.emojis.join(' ') || '*none*' },
            { name: 'Allowed channels', value: cfg.allowed_channels.map((c) => `<#${c}>`).join(' ') || '*everywhere*' },
            { name: 'Watching (setup)', value: cfg.watch_channels.map((c) => `<#${c}>`).join(' ') || '*none*' },
            { name: 'Ping after', value: fmtMinutes(cfg.inactivity_minutes), inline: true },
            { name: 'Admin role', value: cfg.admin_role_id ? `<@&${cfg.admin_role_id}>` : '*none*', inline: true },
            { name: 'Mod role (censor-exempt)', value: cfg.mod_role_id ? `<@&${cfg.mod_role_id}>` : '*none*', inline: true },
            { name: 'AI censor', value: `${getCensor(gid).length} blocked words`, inline: true },
          );
        return i.editReply({ embeds: [e] });
      }

      case 'profile': {
        const body = {};
        if (i.options.getBoolean('reset')) Object.assign(body, { nick: null, bio: null });
        const nick = i.options.getString('nickname'), bio = i.options.getString('bio');
        if (nick) body.nick = nick;
        if (bio) body.bio = bio;
        if (!Object.keys(body).length) return reply(i, 'give me a nickname, a bio, or reset:true 🫧');
        await patchProfile(i, body);
        return reply(i, 'profile updated 🫧');
      }

      case 'avatar':
      case 'banner': {
        if (i.options.getBoolean('reset')) {
          await patchProfile(i, { [sub]: null });
          return reply(i, `${sub} reset 🫧`);
        }
        const img = await readImage(i);
        if (!img) return reply(i, `attach a file or paste a url for the ${sub}, or use reset:true 🫧`);
        await patchProfile(i, { [sub]: img });
        return reply(i, `${sub} updated 🫧`);
      }

      case 'modrole': {
        const role = i.options.getRole('role');
        if (i.options.getBoolean('reset')) {
          await saveConfig(gid, { mod_role_id: null });
          return reply(i, 'mod role removed. Only you are exempt from the word filter now 🫧');
        }
        if (!role) return reply(i, 'pick a role, or use reset:true 🫧');
        if (role.id === i.guildId) return reply(i, '@everyone can\'t be the mod role 🫧');
        await saveConfig(gid, { mod_role_id: role.id });
        return reply(i, `${role} is now the mod role. Its members are exempt from the AI word filter 🫧`);
      }

      case 'color': {
        const hex = parseHex(i.options.getString('hex', true));
        if (!hex) return reply(i, 'that isn\'t a hex color. Try something like `#FF66AA` 🫧');
        await saveConfig(gid, { embed_color: hex });
        return i.editReply({ content: '', embeds: [embed(gid).setTitle('embed color updated').setDescription(`now ${hex}`)] });
      }

      case 'button': {
        const patch = {};
        if (i.options.getBoolean('reset')) Object.assign(patch, { button_label: 'blob', button_emoji: null, button_style: 'primary' });
        const text = i.options.getString('text')?.trim(), emoji = i.options.getString('emoji'), style = i.options.getString('style');
        if (text) patch.button_label = text;
        if (style && STYLES[style]) patch.button_style = style;
        if (emoji) {
          const [first] = parseEmojis(emoji);
          if (!first) return reply(i, 'i couldn\'t find an emoji in that 🫧');
          patch.button_emoji = first;
        }
        if (!Object.keys(patch).length) return reply(i, 'change something: text, emoji, style, or reset:true 🫧');
        const next = await saveConfig(gid, patch);
        return i.editReply({ content: 'button updated. Preview:', components: [new ActionRowBuilder().addComponents(blobButton(next))] });
      }

      case 'emojis': {
        const action = i.options.getString('action', true);
        const found = parseEmojis(i.options.getString('emoji') ?? '');
        if (action !== 'clear' && !found.length) return reply(i, 'give me at least one emoji 🫧');
        const list =
          action === 'add' ? [...new Set([...cfg.emojis, ...found])].slice(0, MAX_EMOJIS)
          : action === 'remove' ? cfg.emojis.filter((e) => !found.includes(e))
          : [];
        await saveConfig(gid, { emojis: list });
        return reply(i, `blob's emojis: ${list.join(' ') || '*none*'}`);
      }

      case 'channels': {
        const action = i.options.getString('action', true);
        const ch = i.options.getChannel('channel');
        if (action !== 'clear' && !ch) return reply(i, 'pick a channel 🫧');
        const list =
          action === 'add' ? [...new Set([...cfg.allowed_channels, ch.id])]
          : action === 'remove' ? cfg.allowed_channels.filter((c) => c !== ch.id)
          : [];
        await saveConfig(gid, { allowed_channels: list });
        return reply(i, list.length ? `blob can chat in: ${list.map((c) => `<#${c}>`).join(' ')}` : 'blob can chat in every channel 🫧');
      }
    }
  } catch (err) {
    console.warn(`/settings ${sub}:`, err.message);
    return reply(i, `couldn't do that: ${err.rawError?.message ?? err.message}`);
  }
}
