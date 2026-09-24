import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, ModalBuilder,
  PermissionFlagsBits, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getConfig, saveConfig } from './db.js';
import { EPHEMERAL, embed, fmtMinutes, isOwner } from './util.js';
import { forget } from './watcher.js';

const PAGES = 3;
const PRESETS = [15, 30, 60, 180, 360, 720, 1440];
const MIN = 5, MAX = 10080;

function checkPerms(guild) {
  const me = guild.members.me;
  const hasRole = me.roles.highest.id !== guild.id;
  const isAdmin = me.permissions.has(PermissionFlagsBits.Administrator);
  const isTop = hasRole && me.roles.highest.id === guild.roles.highest.id;
  const roleName = hasRole ? `**${me.roles.highest.name}**` : "blob's role";

  const lines = [
    `${isAdmin ? '✅' : '❌'} Administrator permission`,
    `${isTop ? '✅' : '❌'} Role at the top of the role list`,
  ];
  if (!hasRole) {
    lines.push('', "blob has no role of his own. Re-invite him with the **Administrator** permission, or create a role for him and assign it.");
  } else if (!isAdmin || !isTop) {
    lines.push('', 'To fix it: **Server Settings → Roles**');
    if (!isAdmin) lines.push(`• Open ${roleName} → **Permissions** → turn on **Administrator** → Save`);
    if (!isTop) lines.push(`• Drag ${roleName} to the very **top** of the list → Save`);
    lines.push('Then run `/setup` again to re-check.');
  } else {
    lines.push('', 'blob is good to go 🫧');
  }
  return lines;
}

const nav = (page, extra = []) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setup:page:${page - 1}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    ...extra,
    page < PAGES - 1
      ? new ButtonBuilder().setCustomId(`setup:page:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Primary)
      : new ButtonBuilder().setCustomId('setup:done').setLabel('Done').setStyle(ButtonStyle.Success),
  );

export function renderSetup(guild, page = 0) {
  const cfg = getConfig(guild.id);
  const e = embed(guild.id);
  const rows = [];

  if (page === 0) {
    e.setTitle('blob setup · 1/3 · permissions').setDescription(
      [
        ...checkPerms(guild),
        '',
        '**Blob admin role** (optional, owner only): members with it can use `/ban`, `/kick`, `/bloblock`, `/unbloblock` and `/ayaya`.',
      ].join('\n'),
    );
    const roles = new RoleSelectMenuBuilder()
      .setCustomId('setup:role')
      .setPlaceholder('Pick the blob admin role')
      .setMinValues(0)
      .setMaxValues(1);
    if (cfg.admin_role_id && guild.roles.cache.has(cfg.admin_role_id)) roles.setDefaultRoles(cfg.admin_role_id);
    rows.push(new ActionRowBuilder().addComponents(roles));
  }

  if (page === 1) {
    e.setTitle('blob setup · 2/3 · channels to watch').setDescription(
      'Pick up to **20** channels. If one goes quiet, blob pings @everyone there.\nDeselect everything to turn watching off.',
    );
    const watched = cfg.watch_channels.filter((id) => guild.channels.cache.has(id));
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId('setup:channels')
      .setPlaceholder('Pick channels to watch')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(20);
    if (watched.length) menu.setDefaultChannels(...watched);
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  if (page === 2) {
    e.setTitle('blob setup · 3/3 · inactivity timer').setDescription(
      `How long a channel must be silent before blob pings @everyone.\nCurrent: **${fmtMinutes(cfg.inactivity_minutes)}**`,
    );
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('setup:time')
          .setPlaceholder('Pick a time')
          .addOptions(PRESETS.map((m) => ({ label: fmtMinutes(m), value: String(m), default: m === cfg.inactivity_minutes }))),
      ),
    );
  }

  const extra = page === 2 ? [new ButtonBuilder().setCustomId('setup:custom').setLabel('Custom time').setStyle(ButtonStyle.Secondary)] : [];
  rows.push(nav(page, extra));
  return { embeds: [e], components: rows };
}

export const setup = (i) => {
  if (!isOwner(i)) return i.reply({ content: 'only the server owner can use `/setup` 🫧', flags: EPHEMERAL });
  return i.reply({ ...renderSetup(i.guild, 0), flags: EPHEMERAL });
};

// Buttons, select menus and the custom-time modal (customId = "setup:<action>[:<arg>]")
export async function onSetup(i) {
  if (!i.inGuild()) return;
  if (!isOwner(i)) return i.reply({ content: 'only the server owner can use `/setup` 🫧', flags: EPHEMERAL });

  const [, action, arg] = i.customId.split(':');
  const cfg = getConfig(i.guildId);

  switch (action) {
    case 'page':
      return i.update(renderSetup(i.guild, Number(arg)));

    case 'role':
      await saveConfig(i.guildId, { admin_role_id: i.values[0] ?? null });
      return i.update(renderSetup(i.guild, 0));

    case 'channels': {
      forget([...cfg.watch_channels, ...i.values]);
      await saveConfig(i.guildId, { watch_channels: i.values.slice(0, 20) });
      return i.update(renderSetup(i.guild, 1));
    }

    case 'time':
      await saveConfig(i.guildId, { inactivity_minutes: Number(i.values[0]) });
      return i.update(renderSetup(i.guild, 2));

    case 'custom':
      return i.showModal(
        new ModalBuilder()
          .setCustomId('setup:customModal')
          .setTitle('Custom inactivity time')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('minutes')
                .setLabel(`Minutes (${MIN} - ${MAX})`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 90')
                .setRequired(true),
            ),
          ),
      );

    case 'customModal': {
      const m = Number(i.fields.getTextInputValue('minutes').trim());
      if (!Number.isInteger(m) || m < MIN || m > MAX)
        return i.reply({ content: `enter a whole number of minutes between ${MIN} and ${MAX} 🫧`, flags: EPHEMERAL });
      await saveConfig(i.guildId, { inactivity_minutes: m });
      return i.isFromMessage() ? i.update(renderSetup(i.guild, 2)) : i.reply({ ...renderSetup(i.guild, 2), flags: EPHEMERAL });
    }

    case 'done': {
      const chans = cfg.watch_channels.map((id) => `<#${id}>`).join(' ') || '*none*';
      const e = embed(i.guildId)
        .setTitle('blob is set up 🫧')
        .addFields(
          { name: 'Watching', value: chans },
          { name: 'Pings @everyone after', value: fmtMinutes(cfg.inactivity_minutes), inline: true },
          { name: 'Admin role', value: cfg.admin_role_id ? `<@&${cfg.admin_role_id}>` : '*none*', inline: true },
        )
        .setFooter({ text: 'Customize blob with /settings' });
      return i.update({ embeds: [e], components: [] });
    }
  }
}
