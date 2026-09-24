import { censorVariants } from './ai.js';
import { addCensor, clearStrikes, getCensor, getConfig, getStrikes, removeCensor, saveStrikes } from './db.js';
import { EPHEMERAL, embed, isOwner } from './util.js';

// ---- tuning -----------------------------------------------------------------
const VIOLATIONS_PER_STEP = 2; // removed messages before each warning (and before the kick)
const MAX_WARNINGS = 2; // warnings before the kick
const REJOIN_OFFENSE_BANS = false; // true = a kicked user who offends again is banned on the very next message
const MAX_WORDS = 50;
const MAX_VARIANTS = 15;
const REASON = 'Blocked-word filter: repeated violations';

// ---- 1. normalize message text ---------------------------------------------
// Undo the cheap tricks: fullwidth/bold/circled letters, accents, zalgo, zero-width characters,
// Cyrillic/Greek lookalikes and boxed letters (🅵 🇫).
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu;
const LOOK = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', в: 'b', к: 'k', м: 'm',
  н: 'h', т: 't', ѵ: 'v', ԛ: 'q', ԝ: 'w', α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u',
  χ: 'x', η: 'n', μ: 'u', ω: 'w', ı: 'i', ɡ: 'g', ø: 'o', đ: 'd', ł: 'l', ħ: 'h', ŧ: 't',
};
const LOOK_RE = new RegExp(`[${Object.keys(LOOK).join('')}]`, 'gu');
const BOXED = /[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}\u{1F1E6}-\u{1F1FF}]/gu;
const unbox = (c) => {
  const cp = c.codePointAt(0);
  const base = cp >= 0x1f1e6 ? 0x1f1e6 : cp >= 0x1f170 ? 0x1f170 : 0x1f150;
  return String.fromCharCode(97 + cp - base);
};

export function fold(text) {
  return text
    .slice(0, 4000)
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(BOXED, unbox)
    .replace(LOOK_RE, (c) => LOOK[c]);
}

const clean = (s) => fold(s).replace(/[^\p{L}\p{N}]/gu, '');

// ---- 2. skeletons ---------------------------------------------------------------
// A skeleton is the message with leetspeak mapped to letters and every run of junk between letters squashed
// into ONE marker: "_" if it contained whitespace, "-" if it was only symbols. So "f u c k" -> "f_u_c_k",
// "f.u.c.k" -> "f-u-c-k", "@$$" -> "ass". Patterns then only ever deal with letters and one marker, and runs of
// the same letter are capped at 3, which keeps matching fast with no nasty backtracking (a hostile message
// can't stall the bot). `kind` is a parallel string: d = digit, l = letter/symbol, m = marker, so a match made
// only of digits ("455") can be told apart from a bypass ("4ss").
const DIGITS = { 4: 'a', 3: 'e', 1: 'i', 0: 'o', 5: 's', 7: 't', 8: 'b', 9: 'g' };
const SYMBOLS = { '@': 'a', '(': 'c', '<': 'c', '!': 'i', '|': 'i', $: 's', '+': 't' };
const MERGE = { l: 'i', v: 'u' }; // l/i/1/! and u/v are interchangeable to a human eye

export function skeleton(folded, leetSymbols = true) {
  let text = '', kind = '', gap = '', last = '', run = 0;
  for (const ch of folded) {
    const c = DIGITS[ch] ?? (leetSymbols ? SYMBOLS[ch] : undefined) ?? MERGE[ch] ?? ch;
    if (/[\p{L}\p{N}]/u.test(c)) {
      if (gap) {
        text += gap;
        kind += 'm';
        gap = '';
        last = '';
      }
      run = c === last ? run + 1 : 1;
      last = c;
      if (run > 3) continue; // fuuuuuuck -> fuuuck
      text += c;
      kind += /\d/.test(ch) ? 'd' : 'l';
    } else if (text) {
      gap = gap === '_' || /\s/.test(ch) ? '_' : '-';
    }
  }
  return { text, kind };
}

// Canonical form of a blocked word or AI variant
const canonWord = (w) =>
  [...w]
    .map((ch) => DIGITS[ch] ?? MERGE[ch] ?? ch)
    .join('')
    .replace(/(.)\1{3,}/gsu, '$1$1$1');

// ---- 3. words -> regex ------------------------------------------------------------
// Every letter can be stretched (the skeleton caps runs at 3) and a run of the same letter needs at least as
// many letters as the word has ("ass" needs 2 s's, so plain "as" never matches).
const SEP = '[_-]?'; // optional junk between letters
const SOFT = '-?'; // "anywhere" mode: symbols only, never whitespace, so neighbouring words can't be glued together

const core = (canon, sep) =>
  (canon.match(/(.)\1*/gsu) ?? [])
    .map((run) => {
      const [c] = run;
      const n = Math.min([...run].length, 3);
      return `${c}+` + (n > 1 ? `(?:${sep}${c}+){${n - 1}}` : '');
    })
    .join(sep);

// One masked letter (or two): f*ck, sh#t, f**k. The mask must be a real symbol, so "fck"-style typos stay AI's job
// and normal words like "sit" can never collide with "slut".
function masks(canon) {
  const ch = [...canon];
  const out = [];
  for (let i = 1; i < ch.length - 1; i++) {
    out.push(`${core(ch.slice(0, i).join(''), SEP)}-${core(ch.slice(i + 1).join(''), SEP)}`);
    if (i < ch.length - 2) out.push(`${core(ch.slice(0, i).join(''), SEP)}-${core(ch.slice(i + 2).join(''), SEP)}`);
  }
  return ch.length >= 4 ? out : [];
}

// Default ("whole word") matching must not touch other letters, so "class", "assess" and "Scunthorpe" are safe.
// It also allows plural/-ed/-ing endings. "anywhere" words are additionally matched inside other words ("fuckyou").
const SUFFIX = ['s', 'es', 'ed', 'ing'].join('|');
const EDGE_L = '(?<![^_-])';
const EDGE_R = '(?![^_-])';

const compiled = new Map(); // guildId -> compiled regexes
export const invalidate = (guildId) => compiled.delete(guildId);

export function compile(rows) {
  const strict = new Set(), num = new Set(), loose = new Set();
  for (const r of rows) {
    const base = clean(r.word);
    for (const form of new Set([base, ...(r.variants ?? []).map(clean)])) {
      const canon = canonWord(form);
      if (canon.length < 2) continue;
      if (!/\p{L}/u.test(form)) {
        num.add(core(canon, SEP)); // digits-only word like 420: numbers are what we're after
        continue;
      }
      strict.add(core(canon, SEP));
      if (r.anywhere) loose.add(core(canon, SOFT));
    }
    if (/\p{L}/u.test(base)) masks(canonWord(base)).forEach((m) => strict.add(m));
  }
  // V8 gets slow compiling one giant alternation (~500+ branches), so split into several regexes of ~200
  const build = (set, wrap) => {
    const all = [...set];
    const out = [];
    for (let i = 0; i < all.length; i += 200) out.push(new RegExp(wrap(all.slice(i, i + 200).join('|')), 'gu'));
    return out;
  };
  return {
    strict: build(strict, (a) => `${EDGE_L}(?:${a})(?:[_-]?(?:${SUFFIX}))?${EDGE_R}`),
    num: build(num, (a) => `${EDGE_L}(?:${a})${EDGE_R}`),
    loose: build(loose, (a) => a),
  };
}

// A match made only of digits-as-leet ("455") is a number, not a bypass: it needs a real letter or symbol in it.
function find(regexes, { text, kind }, needsLetter) {
  for (const re of regexes) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text)); re.lastIndex = m.index + 1)
      if (!needsLetter || kind.slice(m.index, m.index + m[0].length).includes('l')) return true;
  }
  return false;
}

export function detect({ strict, num, loose }, content) {
  const folded = fold(content);
  const run = (sk) => find(strict, sk, true) || find(num, sk, false) || find(loose, sk, true);
  const withSymbols = skeleton(folded, true);
  if (run(withSymbols)) return true;
  // "fuck!" / "(fuck)": a trailing ! or ( is punctuation, not leetspeak, so try again with symbols as junk
  const plain = skeleton(folded, false);
  return plain.text !== withSymbols.text && run(plain);
}

function matches(guildId, content) {
  const rows = getCensor(guildId);
  if (!rows.length) return false;
  if (!compiled.has(guildId)) compiled.set(guildId, compile(rows));
  return detect(compiled.get(guildId), content);
}

// ---- 3. the strike ladder ----------------------------------------------------
// every VIOLATIONS_PER_STEP removed messages -> warning 1, warning 2, then kick; after a kick the same
// ladder ends in a ban instead. Pure function so it's easy to reason about (and test).
export function step(rec) {
  const r = { ...rec, violations: rec.violations + 1 };
  if (REJOIN_OFFENSE_BANS && r.kicked) return { r, action: 'ban' };
  if (r.violations < VIOLATIONS_PER_STEP) return { r, action: 'none' };
  r.violations = 0;
  if (r.warnings < MAX_WARNINGS) {
    r.warnings++;
    return { r, action: 'warn' };
  }
  return { r, action: r.kicked ? 'ban' : 'kick' };
}

const dm = (user, content) =>
  user.send({ content, allowedMentions: { users: [user.id] } }).then(() => true, () => false);

async function invite(msg) {
  const ch = msg.channel.isThread() ? msg.channel.parent : msg.channel;
  try {
    return (await ch.createInvite({ maxAge: 7 * 86_400, maxUses: 1, unique: true, reason: REASON })).url;
  } catch {
    return null;
  }
}

async function punish(msg, member) {
  const { guild, author } = msg;
  const { r, action } = step(getStrikes(guild.id, author.id));
  const ping = `<@${author.id}>`;
  const save = (rec) => saveStrikes(guild.id, author.id, rec).catch((e) => console.warn('saving strikes failed:', e.message));

  if (action === 'kick' || action === 'ban') {
    if (!(action === 'ban' ? member.bannable : member.kickable)) {
      console.warn(`censor: can't ${action} ${author.username} in ${guild.name} (role above blob?)`);
      return save(r);
    }
    if (action === 'kick') {
      const url = await invite(msg);
      await dm(
        author,
        `${ping} 👢 you were **kicked** from **${guild.name}** for repeatedly using blocked words.\n` +
          `You can rejoin${url ? `: ${url}` : ' with a new invite'}, but if it happens again you'll be **banned**.`,
      );
      await member.kick(REASON);
      return save({ violations: 0, warnings: 0, kicked: true });
    }
    await dm(author, `${ping} 🔨 you were **banned** from **${guild.name}** for using blocked words again after a kick.`);
    await guild.members.ban(author.id, { reason: REASON });
    return clearStrikes(guild.id, author.id).catch((e) => console.warn('clearing strikes failed:', e.message));
  }

  save(r);
  if (action === 'warn') {
    const left = r.warnings < MAX_WARNINGS ? 'another warning' : 'a kick';
    const text =
      `${ping} ⚠️ **warning ${r.warnings}/${MAX_WARNINGS}** in **${guild.name}**: your message was removed for containing a blocked word.\n` +
      `${VIOLATIONS_PER_STEP} more removed messages will get you ${left}.`;
    if (!(await dm(author, text))) {
      // DMs closed: fall back to a short-lived channel message so they still get the warning
      const m = await msg.channel.send({ content: text, allowedMentions: { users: [author.id] } }).catch(() => null);
      if (m) setTimeout(() => m.delete().catch(() => {}), 30_000);
    }
  }
}

// ---- 4. the message hook (create + edit) ------------------------------------
export async function scan(msg) {
  if (!msg.content || msg.author.bot || !matches(msg.guildId, msg.content)) return;
  if (msg.author.id === msg.guild.ownerId) return;

  const member = msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null));
  if (!member) return;
  const { mod_role_id } = getConfig(msg.guildId);
  if (mod_role_id && member.roles.cache.has(mod_role_id)) return;

  try {
    await msg.delete();
  } catch (e) {
    if (e.code !== 10008) return console.warn(`censor: can't delete in ${msg.channelId}: ${e.message}`); // 10008 = already gone
  }
  await punish(msg, member);
}

// ---- 5. /aicensor (owner only) ----------------------------------------------
const spoil = (s) => `||${s}||`;

export async function aicensor(i) {
  if (!isOwner(i)) return i.reply({ content: 'only the server owner can use `/aicensor` 🫧', flags: EPHEMERAL });
  await i.deferReply({ flags: EPHEMERAL });
  const gid = i.guildId;
  const say = (content) => i.editReply({ content, embeds: [] });

  const forgive = i.options.getUser('forgive');
  if (forgive) {
    await clearStrikes(gid, forgive.id);
    return say(`${forgive.username} has a clean slate 🫧`);
  }

  const raw = i.options.getString('word');
  if (!raw) {
    const rows = getCensor(gid);
    const cfg = getConfig(gid);
    const lines = rows.map((r) => `${spoil(r.word)}${r.anywhere ? ' *(anywhere)*' : ''} · ${r.variants.length} variants`);
    const e = embed(gid)
      .setTitle('AI censor')
      .setDescription(lines.join('\n') || '*no blocked words yet. Add one with `/aicensor word:...`*')
      .addFields(
        { name: 'Exempt', value: `owner${cfg.mod_role_id ? ` and <@&${cfg.mod_role_id}>` : ' (set a mod role with `/settings modrole`)'}` },
        { name: 'Ladder', value: `every ${VIOLATIONS_PER_STEP} removed messages → warning 1 → warning 2 → kick. After a kick, the same ladder ends in a ban.` },
      );
    return i.editReply({ content: '', embeds: [e] });
  }

  const word = clean(raw);
  if (word.length < 2) return say('give me a word with at least 2 letters or numbers 🫧');

  if (i.options.getBoolean('remove')) {
    const had = await removeCensor(gid, word);
    invalidate(gid);
    return say(had ? `unblocked ${spoil(word)} 🫧` : `${spoil(word)} wasn't blocked`);
  }

  if (getCensor(gid).length >= MAX_WORDS && !getCensor(gid).some((r) => r.word === word))
    return say(`you've hit the ${MAX_WORDS} word limit. Remove one first 🫧`);

  // AI is used once, here: it suggests inflections/misspellings. Scanning messages afterwards is local regex.
  let variants = [];
  let note = '';
  if (i.options.getBoolean('ai') ?? true) {
    try {
      variants = [...new Set((await censorVariants(word)).map(clean))]
        .filter((v) => v.length >= 2 && v.length <= 40 && v !== word)
        .slice(0, MAX_VARIANTS);
      if (!variants.length) note = "\nAI didn't suggest extra variants, so blob is using pattern matching only.";
    } catch (err) {
      console.warn('censorVariants failed:', err.message);
      note = '\nAI was unavailable, so blob is using pattern matching only.';
    }
  }

  const anywhere = i.options.getBoolean('anywhere') ?? false;
  await addCensor(gid, { word, variants, anywhere });
  invalidate(gid);

  return say(
    `blocked ${spoil(word)} ${anywhere ? '(anywhere, also inside other words)' : '(whole word)'} 🫧\n` +
      `AI variants: ${variants.length ? variants.map(spoil).join(' ') : '*none*'}${note}\n` +
      `Catches spacing, symbols, leetspeak, lookalike letters and stretched letters.`,
  );
}
