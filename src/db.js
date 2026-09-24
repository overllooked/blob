import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const DEFAULTS = {
  admin_role_id: null,
  mod_role_id: null,
  watch_channels: [],
  inactivity_minutes: 60,
  allowed_channels: [],
  embed_color: '#5865F2',
  button_label: 'blob',
  button_emoji: null,
  button_style: 'primary',
  emojis: [],
};

// Everything is small, so keep it all in memory and write through to Supabase.
const configs = new Map(); // guildId -> row
const locks = new Set(); // `${guildId}:${userId}`
const censor = new Map(); // guildId -> [{ word, variants, anywhere }]
const strikes = new Map(); // `${guildId}:${userId}` -> { violations, warnings, kicked }

// PostgREST returns at most 1000 rows per request, so page through.
async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function loadAll() {
  const [cfgs, lks, words, strk] = await Promise.all([
    fetchAll('guild_config', '*'),
    fetchAll('bloblocks', 'guild_id,user_id'),
    fetchAll('censor_words', 'guild_id,word,variants,anywhere'),
    fetchAll('censor_strikes', 'guild_id,user_id,violations,warnings,kicked'),
  ]);
  cfgs.forEach((r) => configs.set(r.guild_id, r));
  lks.forEach((r) => locks.add(`${r.guild_id}:${r.user_id}`));
  words.forEach((r) => censor.set(r.guild_id, [...getCensor(r.guild_id), r]));
  strk.forEach((r) => strikes.set(`${r.guild_id}:${r.user_id}`, { violations: r.violations, warnings: r.warnings, kicked: r.kicked }));
}

export const getConfig = (guildId) => ({ ...DEFAULTS, ...configs.get(guildId), guild_id: guildId });
export const allConfigs = () => [...configs.values()].map((r) => getConfig(r.guild_id));

export async function saveConfig(guildId, patch) {
  const row = { ...getConfig(guildId), ...patch, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('guild_config').upsert(row);
  if (error) throw error;
  configs.set(guildId, row);
  return row;
}

export const isLocked = (guildId, userId) => locks.has(`${guildId}:${userId}`);

export async function lock(guildId, userId) {
  const { error } = await supabase.from('bloblocks').upsert({ guild_id: guildId, user_id: userId });
  if (error) throw error;
  locks.add(`${guildId}:${userId}`);
}

export async function unlock(guildId, userId) {
  const { error } = await supabase.from('bloblocks').delete().eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
  return locks.delete(`${guildId}:${userId}`);
}

// ---- AI censor: blocked words ----------------------------------------------
export const getCensor = (guildId) => censor.get(guildId) ?? [];

export async function addCensor(guildId, { word, variants, anywhere }) {
  const row = { guild_id: guildId, word, variants, anywhere };
  const { error } = await supabase.from('censor_words').upsert(row);
  if (error) throw error;
  censor.set(guildId, [...getCensor(guildId).filter((r) => r.word !== word), row]);
}

export async function removeCensor(guildId, word) {
  const { error } = await supabase.from('censor_words').delete().eq('guild_id', guildId).eq('word', word);
  if (error) throw error;
  const before = getCensor(guildId);
  const after = before.filter((r) => r.word !== word);
  censor.set(guildId, after);
  return after.length !== before.length;
}

// ---- AI censor: per-user strikes -------------------------------------------
// The cache is updated synchronously (before the first await), so back-to-back violations never race.
export const getStrikes = (guildId, userId) => ({
  violations: 0,
  warnings: 0,
  kicked: false,
  ...strikes.get(`${guildId}:${userId}`),
});

export async function saveStrikes(guildId, userId, { violations, warnings, kicked }) {
  strikes.set(`${guildId}:${userId}`, { violations, warnings, kicked });
  const { error } = await supabase
    .from('censor_strikes')
    .upsert({ guild_id: guildId, user_id: userId, violations, warnings, kicked, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function clearStrikes(guildId, userId) {
  strikes.delete(`${guildId}:${userId}`);
  const { error } = await supabase.from('censor_strikes').delete().eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}
