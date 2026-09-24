import { ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getConfig } from './db.js';

export const EPHEMERAL = MessageFlags.Ephemeral;

export const isOwner = (i) => i.guild.ownerId === i.user.id;

export const embed = (guildId) => new EmbedBuilder().setColor(getConfig(guildId).embed_color);

// Empty allow-list = blob can chat anywhere.
export function canChat(cfg, channelId, parentId) {
  if (!cfg.allowed_channels.length) return true;
  return cfg.allowed_channels.includes(channelId) || Boolean(parentId && cfg.allowed_channels.includes(parentId));
}

// Owner, real Discord perm, or the blob admin role (set in /setup).
export function canMod(i, perm = PermissionFlagsBits.Administrator) {
  if (isOwner(i)) return true;
  if (i.memberPermissions?.has(perm)) return true;
  const { admin_role_id } = getConfig(i.guildId);
  return Boolean(admin_role_id && i.member?.roles?.cache?.has(admin_role_id));
}

export const STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

// blob's public button, styled by /settings button
export function blobButton(cfg) {
  const b = new ButtonBuilder()
    .setCustomId('blobbtn')
    .setLabel(cfg.button_label)
    .setStyle(STYLES[cfg.button_style] ?? ButtonStyle.Primary);
  if (cfg.button_emoji) b.setEmoji(cfg.button_emoji);
  return b;
}

export const parseHex = (s) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
};

// unicode emoji or custom <:name:id> / <a:name:id>
const EMOJI_RE = /<a?:\w{2,32}:\d{17,20}>|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu;
export const parseEmojis = (s) => [...new Set(s.match(EMOJI_RE) ?? [])];

export const pickEmoji = (cfg, fallback = '🫧') =>
  cfg.emojis.length ? cfg.emojis[Math.floor(Math.random() * cfg.emojis.length)] : fallback;

export function fmtMinutes(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  const hs = `${h}h`;
  return r ? `${hs} ${r}m` : hs;
}

export const chunk = (s, n = 2000) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) ?? [];
