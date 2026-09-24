import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const guildOnly = (b) => b.setContexts(InteractionContextType.Guild);

const imageSub = (name, desc) => (s) =>
  s
    .setName(name)
    .setDescription(desc)
    .addAttachmentOption((o) => o.setName('file').setDescription('Upload an image'))
    .addStringOption((o) => o.setName('url').setDescription('...or paste an image URL'))
    .addBooleanOption((o) => o.setName('reset').setDescription('Reset to default'));

const actions = (name, desc, choices) => (o) => o.setName(name).setDescription(desc).setRequired(true).addChoices(...choices);
const ACT = [
  { name: 'add', value: 'add' },
  { name: 'remove', value: 'remove' },
  { name: 'clear', value: 'clear' },
];

const textChannel = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export const commands = [
  guildOnly(
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Check blob\'s permissions, pick channels to watch and the inactivity timer (owner only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ),

  guildOnly(
    new SlashCommandBuilder()
      .setName('settings')
      .setDescription('Customize blob for your server, free (owner only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((s) => s.setName('view').setDescription('Show blob\'s current settings'))
      .addSubcommand((s) =>
        s
          .setName('profile')
          .setDescription('Blob\'s nickname and bio in this server')
          .addStringOption((o) => o.setName('nickname').setDescription('New nickname').setMaxLength(32))
          .addStringOption((o) => o.setName('bio').setDescription('New bio').setMaxLength(190))
          .addBooleanOption((o) => o.setName('reset').setDescription('Reset nickname and bio')),
      )
      .addSubcommand(imageSub('avatar', 'Blob\'s avatar in this server'))
      .addSubcommand(imageSub('banner', 'Blob\'s banner in this server'))
      .addSubcommand((s) =>
        s
          .setName('modrole')
          .setDescription('Role that is exempt from the AI word filter')
          .addRoleOption((o) => o.setName('role').setDescription('The mod role'))
          .addBooleanOption((o) => o.setName('reset').setDescription('Remove the mod role')),
      )
      .addSubcommand((s) =>
        s
          .setName('color')
          .setDescription('Embed color')
          .addStringOption((o) => o.setName('hex').setDescription('Hex color, e.g. #FF66AA').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('button')
          .setDescription('Blob\'s default button (text, emoji, color)')
          .addStringOption((o) => o.setName('text').setDescription('Button text').setMaxLength(80))
          .addStringOption((o) => o.setName('emoji').setDescription('Button emoji'))
          .addStringOption((o) =>
            o.setName('style').setDescription('Button color').addChoices(
              { name: 'Blurple', value: 'primary' },
              { name: 'Gray', value: 'secondary' },
              { name: 'Green', value: 'success' },
              { name: 'Red', value: 'danger' },
            ),
          )
          .addBooleanOption((o) => o.setName('reset').setDescription('Reset button to default')),
      )
      .addSubcommand((s) =>
        s
          .setName('emojis')
          .setDescription('Emojis blob is allowed to use')
          .addStringOption(actions('action', 'What to do', ACT))
          .addStringOption((o) => o.setName('emoji').setDescription('One or more emojis (unicode or custom)')),
      )
      .addSubcommand((s) =>
        s
          .setName('channels')
          .setDescription('Channels blob is allowed to chat in (none set = everywhere)')
          .addStringOption(actions('action', 'What to do', ACT))
          .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(...textChannel)),
      ),
  ),

  guildOnly(
    new SlashCommandBuilder()
      .setName('aicensor')
      .setDescription('AI word filter: block a word and its bypasses. No word = list (owner only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) => o.setName('word').setDescription('Word or phrase to block').setMaxLength(60))
      .addBooleanOption((o) => o.setName('remove').setDescription('Unblock this word'))
      .addBooleanOption((o) => o.setName('anywhere').setDescription('Also match inside other words, e.g. "fuckyou" (more aggressive)'))
      .addBooleanOption((o) => o.setName('ai').setDescription('Let AI suggest spelling variants (default: yes)'))
      .addUserOption((o) => o.setName('forgive').setDescription("Reset a user's warnings and strikes")),
  ),

  guildOnly(
    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a user')
      .addUserOption((o) => o.setName('user').setDescription('Who to ban').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)),
  ),

  guildOnly(
    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a user')
      .addUserOption((o) => o.setName('user').setDescription('Who to kick').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)),
  ),

  guildOnly(new SlashCommandBuilder().setName('blob').setDescription('blob will DM you. Chat with him there!')),
  guildOnly(new SlashCommandBuilder().setName('ping').setDescription('Check blob\'s latency')),

  guildOnly(
    new SlashCommandBuilder()
      .setName('bloblock')
      .setDescription('Turn everything a user says into "blob"')
      .addUserOption((o) => o.setName('user').setDescription('Who to blob lock').setRequired(true)),
  ),

  guildOnly(
    new SlashCommandBuilder()
      .setName('unbloblock')
      .setDescription('Remove a blob lock')
      .addUserOption((o) => o.setName('user').setDescription('Who to unlock').setRequired(true)),
  ),

  // Discord requires slash command names to be lowercase, so this is /ayaya
  guildOnly(new SlashCommandBuilder().setName('ayaya').setDescription('AYAYA in every channel')),
];

export const commandData = commands.map((c) => c.toJSON());
