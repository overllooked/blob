# blob 🫧

A tiny Discord bot: discord.js + Supabase + Groq. Three dependencies-ish, no build step.

## Setup

1. **Discord**: create an app at <https://discord.com/developers/applications>, add a bot, copy the token.
   On the **Bot** tab turn on **Message Content Intent** (needed for `/bloblock`).
2. **Invite** with the `bot` + `applications.commands` scopes and the **Administrator** permission,
   then drag blob's role to the very top of your role list.
3. **Supabase**: create a project, paste `schema.sql` into the SQL editor and run it.
   Copy the project URL and the `service_role` key.
4. **Groq**: create a key at <https://console.groq.com/keys>.
5. `cp .env.example .env` and fill it in.
6. Run (Node 20.6+):
   ```
   npm install
   npm run deploy   # registers slash commands (re-run whenever commands.js changes)
   npm start
   ```

## Commands

| Command | Who | What |
|---|---|---|
| `/setup` | server owner | permission check, admin role, up to 20 watched channels, inactivity timer |
| `/settings` | server owner | profile (nickname, bio), avatar, banner, mod role, color, button, emojis, channels, view |
| `/aicensor` | server owner | block a word and all its bypasses (`word:`, `remove:`, `anywhere:`, `ai:`, `forgive:`), no word = list |
| `/ban` `/kick` | Ban/Kick perm, or blob admin role | with role-hierarchy checks |
| `/bloblock` `/unbloblock` | Manage Messages, or blob admin role | every word becomes "blob" |
| `/ayaya` | Administrator, or blob admin role | one AYAYA in every text channel |
| `/blob` | anyone | blob DMs you; anything you DM him gets an AI reply |
| `/ping` | anyone | latency |

Slash command names must be lowercase on Discord, so it's `/ayaya`, not `/AYAYA`.

## AI censor

`/aicensor word:foo` blocks a word. The AI (Groq) is asked **once**, when the word is added, for inflections and
misspellings. After that every message is checked locally with regex, so it's instant, free, and never hits Groq's
rate limits. It catches spacing (`f u c k`), symbols (`f.u.c.k`, `f*ck`), leetspeak (`sh1t`, `@ss`), lookalike
letters (Cyrillic/Greek/fullwidth/bold/boxed), zero-width characters, stretched letters, and edited-in words.

- Matches whole words by default (so "class" and "assess" are fine for "ass"). `anywhere:true` also catches it glued inside other words ("fuckyou").
- Exempt: the server owner and the mod role (`/settings modrole`).
- Every 2 removed messages: warning 1, then warning 2, then a kick (DM + invite link). After a kick the same ladder ends in a ban.
- Edit the constants at the top of `src/censor.js` to change the numbers (`VIOLATIONS_PER_STEP`, `MAX_WARNINGS`, `REJOIN_OFFENSE_BANS`).

## Files

```
src/index.js     client, events, DM chat, bloblock hook
src/commands.js  slash command definitions
src/setup.js     /setup wizard
src/settings.js  /settings
src/actions.js   ban, kick, ping, blob, bloblock, unbloblock, ayaya
src/censor.js    AI word filter + strike ladder + /aicensor
src/watcher.js   inactivity pings
src/db.js        Supabase + in-memory cache
src/ai.js        Groq openai/gpt-oss-20b
src/util.js      helpers
```
