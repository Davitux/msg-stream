# Where messages live — options for keeping history

Status: **decided — option A (IndexedDB), implemented.**

Chosen on 2026-08-17 because cross-device sync isn't wanted and losing data when the user clears
their browser is acceptable. That rules out the desktop and backend options, and makes the
durability caveats below a known, accepted tradeoff rather than a problem to solve. The one live
consequence: searching message text means scanning rows rather than using an index — fine at these
volumes, and revisitable if it ever isn't.

Since then the app has also dropped its last server route — Kick's chatroom ID is entered by hand
instead of proxied — so it now builds as a fully static site. Nothing in the reasoning below
changes; there is simply no server left to put a database behind, which makes option D a larger
step than it was when this was written.

The rest of this document is kept as the record of what was weighed.

## The problem

Right now everything lives in one localStorage key. Concretely:

- **Chat is lost on every reload.** It's never written to disk.
- **Paid messages survive**, but only the newest 200 per profile.
- **Nothing is searchable.** There's no way to answer "who sent that link last Tuesday".
- **The ceiling is ~5MB** for settings, read marks and saved tips combined.
- **Nothing crosses devices**, and credentials sit in plaintext.

A busy stream produces on the order of 10–50 messages a minute. Four hours of that is
roughly 5–10MB of raw text — already past the localStorage budget, and that's one session.

## What we're choosing between

| | A. IndexedDB | B. SQLite (WASM) | C. Desktop app | D. Backend + DB | E. Local file |
|---|---|---|---|---|---|
| Stops losing messages | yes | yes | yes | yes | partly |
| User installs anything | no | no | **yes** | no | no |
| Stays free / zero-ops | yes | yes | yes | **no** | yes |
| Survives "clear site data" | no | no | **yes** | **yes** | **yes** |
| Works across devices | no | no | no | **yes** | no |
| Full-text search | awkward | **yes (FTS5)** | **yes (FTS5)** | yes | no |
| Protects credentials | no | no | **yes (keychain)** | partly | no |
| Fixes Kick | no | no | maybe | **yes** | no |
| Effort | ~1 day | ~2–4 days | ~1–2 weeks | ~1–2 weeks | ~1 day |
| Ongoing cost | none | none | signing, 3 OS builds | hosting + auth | none |

## The options in detail

### A. IndexedDB (via Dexie)

Store every message in IndexedDB instead of localStorage. Quota jumps from ~5MB to
**several GB**, shared between IndexedDB and OPFS.

- **Good:** smallest change, no WASM bundle, multi-tab safe, works everywhere.
- **Bad:** no real query language. Filtering by platform and date is fine via indexes;
  searching message *text* means scanning every row in JS.
- **Verdict:** the cheapest thing that solves the stated problem, but a dead end if search
  matters, and nothing carries over to a desktop app later.

### B. SQLite compiled to WASM, stored in OPFS — *recommended first step*

Real SQLite running in the browser, with the database file in the Origin Private File
System. Same quota pool as IndexedDB (**several GB**).

- **Good:** actual SQL. `FTS5` gives proper full-text search over message bodies for free.
  Aggregates ("total received this month, by platform") become one query.
- **Deployment:** using the `opfs-sahpool` VFS means **no COOP/COEP headers are required**,
  so this still deploys to Vercel exactly as it does today. (The default OPFS VFS *does*
  require those headers — that's the trap to avoid.)
- **Bad:** `opfs-sahpool` allows only **one connection at a time**, so a second tab of the
  app will fail to open the database. Needs a Web Lock and an honest "already open in
  another tab" message. `wa-sqlite`'s `OPFSCoopSyncVFS` handles sequential connections more
  gracefully if that turns out to matter.
- **Bad:** Safari private browsing has no OPFS at all; Chrome incognito caps around 100MB.
  Both need a graceful in-memory fallback.
- **The real argument:** the schema and every query written here **port unchanged** to a
  native SQLite file if we ever go desktop. Option B is the only browser option that isn't
  throwaway work.

### C. Tauri desktop app + native SQLite

Wrap the existing frontend — Next.js static export works — in Tauri v2 (stable, 2.10.1 as
of March 2026), using `tauri-plugin-sql` for SQLite with migrations.

- **Good:** a real database file the user owns, backs up, and never has evicted. Credentials
  can move into the **OS keychain** instead of plaintext. Runs in the background, native
  notifications for large tips, no risk of a closed tab losing anything.
- **Bad:** you have to install it, and I have to build and sign for macOS, Windows and
  Linux. Apple notarization is $99/year. Auto-update is another moving part.
- **On Kick:** a desktop app escapes CORS, but Tauri's Rust HTTP client would likely hit the
  *same* TLS-fingerprint block that Node did. Crates exist that impersonate a browser's TLS
  fingerprint, which would probably work — but it's fragile and squarely against the spirit
  of their bot protection. **Treat "desktop fixes Kick" as a maybe, not a reason to choose it.**

### D. Backend + hosted database

Add a small API and a database — Turso (hosted SQLite, generous free tier) or Postgres on
Neon/Supabase.

- **Good:** the only option that gives **cross-device** history and survives losing the
  machine entirely. Also the **only option that properly fixes Kick**: their official API
  delivers chat by webhook, which needs exactly the public HTTPS endpoint this option adds.
- **Bad:** stops being free-forever and zero-ops. Needs real auth, which is the bulk of the
  work. Adapters still run in the browser (Vercel can't hold long-lived sockets), so this is
  a write-behind sink, not a rearchitecture.
- **Verdict:** right answer eventually if you want Kick and multi-device. Overkill purely to
  stop losing messages.

### E. Append to a local file (File System Access API)

Pick a file once; the app appends newline-delimited JSON to it.

- **Good:** data lands in a real file the user owns, immune to browser eviction. Trivial to
  implement and to back up.
- **Bad:** **Chromium only** — no Firefox, no Safari. Write-only in practice; you'd still
  need a database to query it.
- **Verdict:** not a solution on its own, but cheap insurance worth adding alongside any
  other option.

## A caveat that applies to A and B

Browser storage is durable but **not guaranteed**. Under disk pressure a browser evicts
least-recently-used origins, and eviction is **all-or-nothing** — the whole origin's data
goes at once. `navigator.storage.persist()` opts out of automatic eviction and should be
requested on first run, but the user clearing site data still wipes everything.

If "never lose a donation record" is a hard requirement rather than a nice-to-have, only
options C, D and E actually deliver it.

## Recommendation

**Phase 1 — Option B, behind an interface.** Introduce a `MessageStore` interface exactly
like the existing `SourceAdapter` pattern, with a SQLite-WASM implementation behind it.
This solves the stated problem in days, needs no install and no infra, and — crucially —
the schema and SQL are the same ones a desktop build would use.

**Phase 2 — Option C, if and when you want a desktop tool.** Swap the store implementation;
the schema, the queries and the entire UI come along unchanged. Decide this on whether you
want background running and keychain credentials, not on storage.

**Phase 3 — Option D, only if cross-device or Kick becomes the priority.** This is the one
that costs money and ongoing attention, so it should be driven by a feature you actually
want, not by persistence.

Add **E** at any point as cheap insurance.

## What phase 1 actually involves

```
lib/messages/
  MessageStore.ts        interface — save, query, search, prune
  sqlite/worker.ts       SQLite-WASM in a dedicated worker (OPFS needs one)
  sqlite/schema.sql      tables + indexes + FTS5
  sqlite/SqliteStore.ts  the implementation
```

Proposed schema:

```sql
CREATE TABLE messages (
  id             TEXT PRIMARY KEY,   -- platform:nativeId, same ids we already use
  profile_id     TEXT NOT NULL,
  platform       TEXT NOT NULL,
  kind           TEXT NOT NULL,
  author_name    TEXT NOT NULL,
  author_color   TEXT,
  message        TEXT NOT NULL,
  amount_value   REAL,               -- NULL for ordinary chat
  amount_currency TEXT,
  amount_display TEXT,
  timestamp      INTEGER NOT NULL,
  read           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX messages_by_time ON messages(profile_id, timestamp DESC);
CREATE INDEX messages_paid    ON messages(profile_id, timestamp DESC)
  WHERE amount_value IS NOT NULL;

CREATE VIRTUAL TABLE messages_fts USING fts5(
  message, author_name, content=messages, content_rowid=rowid
);
```

Deliberately **not** a rewrite of the feed:

- **Write path** reuses the animation-frame batch already in `lib/store.ts` — one
  transaction per batch rather than one insert per message.
- **Read path** hydrates the most recent ~500 rows into the existing in-memory feed on load.
  The feed component doesn't change at all.
- **History and search** become a separate view, added after the write path is proven.
- **Retention** keeps paid messages forever and prunes chat after a configurable window
  (30 days by default), so the database can't grow without limit.
- Request `navigator.storage.persist()` on first run and show usage in Settings.
- Keep the localStorage path for settings and profiles — it works and it's tiny.

## Open questions

1. **How much chat history do you actually want?** 30 days, a year, forever? This decides
   retention and whether the size question matters at all.
2. **Would you install a desktop app**, or is staying in the browser a requirement?
3. **Do you need this on more than one machine?** If yes, that's the backend, and it should
   be planned as such rather than reached by accident.
4. **How much does Kick matter?** If it's important, option D stops being optional — it's
   the only path their official API supports.
