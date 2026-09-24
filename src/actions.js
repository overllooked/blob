import { PermissionFlagsBits as P, ChannelType } from 'discord.js';
import { getConfig, isLocked, lock, unlock } from './db.js';
import { EPHEMERAL, canMod, embed, isOwner, pickEmoji } from './util.js';

const AYAYA = 'AYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAYAY';

const deny = (i) => i.reply({ content: 'you can\'t use that one 🫧', flags: EPHEMERAL });
const no = (i, msg) => i.reply({ content: `${msg} 🫧`, flags: EPHEMERAL });

export async function ping(i) {
  const t = Date.now();
  await i.reply('blob...');
  await i.editReply(`blob! 🫧 roundtrip ${Date.now() - t}ms · websocket ${Math.round(i.client.ws.ping)}ms`);
}

// /blob -> DM the user; AI replies happen in index.js (messageCreate in DMs)
export async function blob(i) {
  try {
    await i.user.send("hey, it's blob 🫧 send me anything and i'll help!");
    return i.reply({ content: 'sent you a DM 🫧', flags: EPHEMERAL });
  } catch {
    return no(i, "i can't DM you. Turn on DMs from server members and try again");
  }
}

async function removeMember(i, verb, perm, past) {
  if (!canMod(i, perm)) return deny(i);
  const user = i.options.getUser('user', true);
  const reason = i.options.getString('reason') ?? 'No reason given';

  if (user.id === i.user.id || user.id === i.client.user.id) return no(i, `i won't ${verb} that one`);

  const target = await i.guild.members.fetch(user.id).catch(() => null);
  if (verb === 'kick' && !target) return no(i, "that user isn't in this server");
  if (target) {
    if (!(verb === 'ban' ? target.bannable : target.kickable)) return no(i, `i can't ${verb} them. Their role is above (or equal to) blob's`);
    if (!isOwner(i) && i.member.roles.highest.comparePositionTo(target.roles.highest) <= 0)
      return no(i, `you can't ${verb} someone with an equal or higher role`);
  }

  await i.deferReply();
  const why = `${i.user.username}: ${reason}`;
  await (verb === 'ban' ? i.guild.members.ban(user, { reason: why }) : target.kick(why));
  const e = embed(i.guildId)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 128 }) })
    .setTitle(`${past} ${pickEmoji(getConfig(i.guildId), '🫧')}`)
    .setDescription(`**Reason:** ${reason}`)
    .setFooter({ text: `by ${i.user.username}` });
  return i.editReply({ embeds: [e] });
}

export const ban = (i) => removeMember(i, 'ban', P.BanMembers, 'Banned');
export const kick = (i) => removeMember(i, 'kick', P.KickMembers, 'Kicked');

export async function bloblock(i) {
  if (!canMod(i, P.ManageMessages)) return deny(i);
  const user = i.options.getUser('user', true);
  if (user.bot) return no(i, "bots can't be blob locked");
  if (user.id === i.guild.ownerId && !isOwner(i)) return no(i, "you can't blob lock the owner");
  await lock(i.guildId, user.id);
  return i.reply({ embeds: [embed(i.guildId).setDescription(`${user} is now blob locked 🫧`)] });
}

export async function unbloblock(i) {
  if (!canMod(i, P.ManageMessages)) return deny(i);
  const user = i.options.getUser('user', true);
  if (!isLocked(i.guildId, user.id)) return no(i, `${user.username} isn't blob locked`);
  await unlock(i.guildId, user.id);
  return i.reply({ embeds: [embed(i.guildId).setDescription(`${user} is free 🫧`)] });
}

// One AYAYA in every text channel blob can post in. Needs Administrator / owner / blob admin role.
export async function ayaya(i) {
  if (!canMod(i, P.Administrator)) return deny(i);
  await i.deferReply({ flags: EPHEMERAL });
  const me = i.guild.members.me;
  const channels = (await i.guild.channels.fetch()).filter(
    (c) =>
      c &&
      (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
      c.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages]),
  );
  const results = await Promise.allSettled(channels.map((c) => c.send({ content: AYAYA, allowedMentions: { parse: [] } })));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  return i.editReply(`AYAYA'd ${ok}/${channels.size} channels 🫧`);
}

// A blob locked user talked: delete it, repost as "blob blob blob" in an embed.
export async function blobify(msg) {
  const words = Math.min(Math.max(msg.content.split(/\s+/).filter(Boolean).length, 1), 300);
  await msg.delete(); // if blob can't delete (missing perms) this throws and we leave the message alone
  const e = embed(msg.guildId)
    .setAuthor({ name: msg.author.username, iconURL: msg.author.displayAvatarURL({ size: 128 }) })
    .setDescription(Array(words).fill('blob').join(' '));
  await msg.channel.send({ embeds: [e], allowedMentions: { parse: [] } });
}
