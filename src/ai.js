// Groq (OpenAI-compatible) calls. No SDK needed, just fetch.
const URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-20b';
const MAX_MESSAGES = 12; // rolling memory per user
const MAX_USERS = 500;

async function groq(messages, extra = {}) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, reasoning_effort: 'low', max_completion_tokens: 1024, ...extra }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ---- DM chat ----------------------------------------------------------------
const SYSTEM =
  "You are Blob, a tiny friendly Discord bot. Your name is Blob and you always know that. " +
  'Be brief (1-3 sentences unless the user asks for more) and genuinely helpful with anything. ' +
  'Casual tone, no headings.';

const history = new Map(); // userId -> [{ role, content }]

export async function askBlob(userId, text) {
  const messages = [...(history.get(userId) ?? []), { role: 'user', content: text }].slice(-MAX_MESSAGES);
  const reply = (await groq([{ role: 'system', content: SYSTEM }, ...messages], { temperature: 0.7 })) || 'blob?';

  history.delete(userId); // re-insert so the Map stays ordered by recent use
  history.set(userId, [...messages, { role: 'assistant', content: reply }].slice(-MAX_MESSAGES));
  if (history.size > MAX_USERS) history.delete(history.keys().next().value);
  return reply;
}

// ---- /aicensor --------------------------------------------------------------
const CENSOR_SYSTEM =
  "You help a Discord moderation bot's word filter. The user gives one blocked word or phrase. " +
  'List up to 15 other forms of that same word people use to dodge filters: inflections (plural, -ing, -ed, -er), ' +
  'common misspellings, phonetic spellings, abbreviations and letter swaps. ' +
  'Only forms with the same meaning. Never unrelated or innocent words. ' +
  'Lowercase, letters and digits only, no spaces. Reply with ONLY a JSON array of strings.';

// Called once when a word is added. The per-message scanning itself is local regex (see censor.js).
export async function censorVariants(word) {
  const text = await groq([{ role: 'system', content: CENSOR_SYSTEM }, { role: 'user', content: word }], { temperature: 0.2 });
  const json = text.match(/\[[\s\S]*\]/)?.[0];
  if (!json) return []; // model declined or rambled
  const arr = JSON.parse(json);
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
}
