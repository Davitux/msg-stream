# msg-stream

One inbox for live chat and tips across streaming platforms. Every message lands in a single
feed showing **who sent it, what they said, and how much they gave** — in the platform's own
currency — with a read toggle so you can clear them as you go.

Built to be configured per streamer: nothing is baked in at build time, so one deployment serves
anyone who fills in their own channels and keys. A streamer with several channels keeps each one
as its own **profile** and switches between them. Interface in **English or Spanish**, with
**dark, light, or follow-the-system** themes.

## Status by platform

| Platform | State | How it works |
|---|---|---|
| **Twitch** | Working | EventSub WebSocket, entirely in the browser. Chat for any channel; cheers and subs when you're the broadcaster. |
| **YouTube** | Working | Polls the Live Streaming API with your own key. Super Chats, Super Stickers, memberships. |
| **Kick** | Working | Public Pusher socket, straight from the browser. Needs a chatroom ID pasted once — see below. |
| **Streamlabs** | Working | Socket API, straight from the browser. Every donation routed through Streamlabs — **including Ceneka**. |
| **StreamElements** | Working | Realtime socket, straight from the browser. Every tip routed through StreamElements — **including Ceneka**. |
| **Ceneka** | Arrives via the above | Has no realtime API of its own; see below. |

### Kick needs one number, pasted once

Kick's chat is a public Pusher socket, and WebSockets aren't subject to CORS, so the browser talks
to it directly. The catch is the numeric **chatroom ID** the subscription needs: the only endpoint
that returns it, `kick.com/api/v2/channels/{slug}`, refuses a browser `fetch()` (no CORS headers)
and refuses a server request (bot protection keyed on TLS fingerprint — verified against
`/api/v1`, `/api/v2` and every header combination, all returning the identical block reference).

So it's entered by hand. Open this in your normal browser and copy the number at `chatroom` → `id`:

```
https://kick.com/api/v2/channels/<your-slug>
```

Settings links straight there once you've filled in the slug. A direct address-bar navigation is
not a cross-origin request, so CORS doesn't apply, and a real browser passes the fingerprint check.
The ID is stable per channel, so this is a one-time paste.

The top-level `id` in the same response is the optional **channel ID**, which adds subscription and
gift events. Chat works without it.

Two caveats: this rides an undocumented socket and can break without notice, and **Kicks** (Kick's
paid gifting currency) are not mapped yet — the event shape isn't documented anywhere verifiable,
and inventing amounts would be worse than showing none. Capture one from `raw` on a live channel
and it's a few lines to add.

### Ceneka arrives through Streamlabs or StreamElements

Ceneka has no realtime API, no webhooks and no alert transport of its own. Verified against their
own client code: no socket library of any kind, and `alert_resend.php` confirms alerts are
*"enviada al servicio configurado"* — sent to the configured service. Their dashboard offers
exactly two, `#streamlabsConfig` and `#configStreamElements`.

So **whichever of those you linked in your Ceneka panel is where your donations arrive**, and
turning that source on in msg-stream picks them up. This is not a workaround — it's the only path
Ceneka provides, and any Ceneka streamer showing alerts on stream already has one of those accounts.

A direct Ceneka adapter was investigated and rejected. Their `listarDonaciones.php` endpoint is
public and returns usable JSON, but it sends **no CORS headers** (and no JSONP), so a browser
can't read it. Reaching it needs a relay, and a shared relay doesn't scale: 100 streamers polling
every 10s is ~144,000 requests/day, past Cloudflare Workers' free 100k/day and 4× past Vercel
Hobby's monthly allowance. Its payload also has **no currency field** at all, which this app won't
guess at. A browser extension would sidestep all of that and stays on the table.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # full suite (vitest)
npm run test:watch
npm run coverage
npm run lint
npm run build
```

On a fresh install no sources are on yet — open Settings, fill in whichever platform you use,
and switch it on in the channel strip.

## Tests

`npm test` runs the whole suite under vitest + jsdom. It covers:

| File | What it pins down |
|---|---|
| `tests/money.test.ts` | Amount formatting per unit and locale — including that bits are **never** rendered as a currency. |
| `tests/store.test.ts` | Ingest batching, dedupe, ring-buffer eviction, read-state capping, filters, profile isolation, persistence and the v0→v1 migration. |
| `tests/history.test.ts` | The storage layer, run twice — once in memory and once against real IndexedDB — plus paging, read marks surviving a reload, per-profile isolation, retention pruning, the fallback when IndexedDB is refused, and importing the old localStorage format. |
| `tests/adapters.test.ts` | Every platform payload → `StreamEvent` mapping, plus error and auth handling. |
| `tests/adapters.twitch.test.ts` | The EventSub flow end to end against a fake socket: what it subscribes to on your own channel vs someone else's, reconnect handover, revocation, and the OAuth fragment. |
| `tests/socketio.test.ts` | The Socket.IO framing spoken by both tip sources — packet decoding, event encoding, URL building, and that malformed frames are ignored rather than thrown. |
| `tests/tips.test.ts` | Streamlabs and StreamElements: payload mapping against the documented shapes, the authenticate handshake, the engine-version-3 heartbeat, and that an unreadable amount is dropped rather than displayed. |
| `tests/adapters.network.test.ts` | YouTube's polling loop and Kick's Pusher handshake against mocked `fetch`/`WebSocket`, including that Kick never touches the network except its own socket. |
| `tests/i18n.test.ts` | Both dictionaries have the same keys and placeholders, and nothing is left untranslated. |
| `tests/gaps.test.ts` | Gap detection and reporting: the heartbeat, per-source outage tracking, duration formatting, rebuilding a gap after `raw` is dropped, and YouTube's resume cursor. |
| `tests/secret-input.test.tsx` | Credential masking: default hidden, deliberate reveal, the auto-hide timeout, re-masking when the drawer reopens, and that the public client ID stays visible. |
| `tests/tiers.test.ts` | Band mapping: threshold banding, normalising a source's range onto the interface's, clamping when a source states no maximum, and staying neutral when none is reported. |
| `tests/page.test.tsx` | The feed as a whole under each capture mode: which filters are offered, that pre-existing chat is hidden, and that unread filtering still works. |
| `tests/theme.test.ts` | Theme resolution and the pre-paint boot script, including a corrupt-storage fallback. |
| `tests/connections.test.ts` | When a platform reconnects and when it must not. |
| `tests/ui.test.tsx` | Rendering and interaction for the feed, status strip and settings drawer. |

Adapter payload mapping is deliberately split into pure functions
(`twitchNotificationToEvent`, `kickEventToStreamEvent`) so the shapes can be tested without
standing up a socket; the socket behaviour itself is covered separately against fakes.

Current coverage is ~84% of statements. The gap is mostly retry timers and defensive branches.

## What gets taken in

By default the app takes in **paid messages only** — tips, Super Chats, cheers and subscriptions.
Ordinary chat is dropped at the door: never rendered, never written to the database, so it costs
neither screen space nor storage. Settings → History switches this to **Everything** if you want
the full chat.

Gap notices are always kept whatever this is set to — a notice that messages were missed is not
itself a message, and suppressing it would hide the one thing it exists to report.

Paid-only capture means paid only throughout: chat already in the database from before the setting
changed is hidden too, so it can't reappear on reload and contradict the setting.

Two controls disappear while it is on, because both would be inert: the **Paid only** filter chip
(there is nothing left for it to filter out) and the **retention** control (there is no chat to
retain). The counter names the mode — `0 unread · Paid only` — instead of repeating the same
number twice, so the absence of chat is explained rather than mysterious.

## Message history

**Everything you capture is kept** in IndexedDB, per profile. Refreshing restores the feed and your
read marks; nothing is lost when the tab closes.

The feed shows the most recent 200 on load, with **Load older** paging further back through
whatever is stored. Because every event ID is `platform:nativeId`, restored messages keep the read
marks you already gave them, and a source that replays recent history on connect — YouTube does —
won't show them twice.

**Retention** is a setting: chat is pruned after 7, 30 or 90 days, or kept forever. Paid messages
are never pruned, whatever that's set to. Settings → History shows how many messages are stored
and how much room they take, and lets you delete a profile's history outright.

The database is asked to be persistent on first run (`navigator.storage.persist()`), which opts out
of automatic eviction under disk pressure. Two things still clear it: the user clearing site data,
and a browser that refuses the request. **This is per-browser and per-device by design** — there is
no sync, and none is planned. See `docs/persistence-options.md` for what was weighed and why.

If a browser refuses IndexedDB entirely (Safari private browsing), the app falls back to an
in-memory store and keeps working — history just doesn't outlive the tab.

Switching profiles swaps the feed to that profile's own history. Deleting a profile deletes it.

## Coming back after a disconnect

Reloading the page or losing connection no longer means silently missing messages.

**YouTube genuinely resumes.** Its `pageToken` cursor is saved after every poll, so a reload picks
up from exactly the message it stopped at. If YouTube rejects a stale token the cursor is dropped
and it starts clean rather than retrying something the API will keep refusing.

**Nothing else can.** Twitch's EventSub and Kick's Pusher socket deliver only from the moment you
subscribe and publish no history; Streamlabs' realtime feed is the same. Its REST API is
CORS-open but needs an OAuth token that requires a client secret, which a static app cannot hold.
StreamElements is the one remaining possibility — its API sends `access-control-allow-origin: *`
and accepts the JWT you already paste — but that isn't built yet.

So for those, the app **says there is a hole** instead of pretending nothing happened. A gap shows
as a hatched row sitting in the timeline exactly where the missing messages would have been:

> **NOT LISTENING FOR 12M** — Messages sent between 16:36 and 16:48 were not captured.

Gaps are detected two ways: a heartbeat written while sources are live catches reloads and
crashes, and a per-source tracker catches mid-stream outages. Reconnect blips under 20 seconds are
ignored, and a marker older than six hours is treated as a new session rather than an enormous
hole. Gaps are stored like any other message and rebuilt from their id on load, so they survive a
reload themselves — and no platform filter can hide one, since a gap is about the feed rather than
one platform.

There is also a **confirmation prompt** before leaving the page while sources are connected, which
is what catches the accidental reload before it costs anything.

## Naming the source

Each message row names where it came from. Settings → Appearance → **Source label** switches
between the full **Name** (default) and a compact colour-coded **Mark** — `YT`, `TW`, `KI`, `SL`,
`SE`, `CE` — which is denser once you know the colours. The full name stays as the accessible
label either way, so switching costs a screen reader nothing.

### Why marks and not the platforms' logos

Those logos are trademarks, each with brand guidelines attached. Using one to identify the service
it belongs to is normally fine, but redrawing one from memory would be both a derivative of the
mark and visibly wrong — worse on both counts than not doing it.

If you want the real artwork, download each platform's official SVG from its own brand kit, put
them in `public/logos/<platform>.svg`, and swap the badge in `components/PlatformTag.tsx` for an
`<img src={`/logos/${platform}.svg`} alt={label} />`. That is a deliberate decision for you to
make, since it means agreeing to each platform's brand terms and not implying their endorsement.

## Credentials on screen

The person using this is often live on camera, so the credential fields — YouTube API key,
Streamlabs socket token, StreamElements token — are masked by default with a **Show** control that
**hides again after ten seconds**. Reopening the drawer starts masked too, so a token cannot be
left readable by walking away mid-stream.

The Twitch **client ID is deliberately not masked**. It is public by design — it travels in the
OAuth redirect URL and in the header of every Helix request — so hiding it would buy nothing while
stopping you checking you pasted the right one.

Worth being precise: masking is shoulder-surfing protection, not security. Every value is still
plaintext in localStorage and readable in devtools. For an app whose screen may be on air, that is
the threat actually worth covering.

## Profiles

Each profile holds one set of channels — a Twitch channel, a YouTube stream, a Kick slug — and
switching profiles disconnects everything and reconnects against the new one. The feed is cleared
on the switch, since the messages on screen belong to the channels you just left.

The Twitch **client ID** is the one setting shared across profiles: it identifies the app
registration for the whole deployment, not any single channel. Everything else, including the
Twitch sign-in, is per profile — so profiles can point at different Twitch accounts.

## Language and theme

English and Spanish, switched under Settings → Appearance. Adapters report their status as
translation keys rather than sentences, so connection messages follow the chosen language too;
text that comes back from a platform's own API is passed through untranslated, since we can't
translate it and shouldn't invent it.

Theme is dark, light, or system. An inline script in the document head resolves and paints the
stored theme before first paint, so there's no white flash on load. `data-theme` is always set
explicitly, which means the stylesheet needs no `prefers-color-scheme` branch.

## Setting up a real source

**Twitch** — create an app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps),
set its OAuth redirect URL to your deployment's address (add `http://localhost:3000/` too for
development), paste the client ID into Settings, then sign in on each profile. Reading chat works for any
channel; cheer and subscription events need you to be that channel's broadcaster.

**YouTube** — enable the YouTube Data API v3 in the
[Google Cloud console](https://console.cloud.google.com/apis/library/youtube.googleapis.com),
create an API key, restrict it by HTTP referrer to your deployment, then paste it into Settings
along with the live video's ID or URL.

Use your *own* key rather than sharing one: the quota is 10,000 units per day **per key**, and
each poll costs several units. The adapter honours the polling interval YouTube returns and backs
off hard when quota runs out, but a shared key across several streamers would still empty quickly.

## Deploying

**There is no server.** `npm run build` produces a static site in `out/` — plain HTML, CSS and JS,
about 1.3 MB. Every adapter talks to its platform directly from the browser and history lives in
IndexedDB, so any static host will do.

```bash
npm run build
npm run start          # serves out/ locally, exactly as a host would
```

### Hosted on Cloudflare Workers

Chosen over the alternatives for one reason that outlives the technical comparison: **Cloudflare's
free plan permits commercial use**. Vercel's Hobby plan and GitHub Pages both restrict
primarily-commercial use, so adding a paid feature later would force a migration or an upgrade
under time pressure. This avoids that.

Workers rather than Pages because Cloudflare recommends it for new projects as of 2026, and
because a Worker that serves only assets today can grow a `fetch` handler tomorrow — so if this
ever does need a backend, it is a config change rather than a re-platform. Pages remains supported
and would work equally well for a purely static site.

`wrangler.jsonc` holds the whole configuration. Note the absent `main`: there is no Worker script,
only assets.

```bash
npm run deploy:dry     # build and validate, uploading nothing
npm run deploy         # build and publish, by hand
```

### Deploys run from CI

`.github/workflows/ci.yml` lints, typechecks, tests and builds on every push and pull request, and
**deploys only from `main`, only after those pass**. That gating is the point: Cloudflare's own Git
integration would deploy on push without running a single test, so a commit that broke all 460 of
them would ship happily.

Two repository secrets are needed, under Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages, in the right-hand sidebar |

Use the **Edit Cloudflare Workers** template rather than a broader token: it grants write access to
Workers and nothing else. A read-only token fails, because deploying writes.

`.github/dependabot.yml` proposes dependency updates weekly, grouped so a quiet week is one or two
pull requests rather than a dozen: Next and React move together in one group because a Next major
expects a matching React, production dependencies in another, and tooling in a third. Majors
outside the Next group are left ungrouped deliberately — those are the ones worth reading on their
own. The actions used by the workflow above are updated too.

Every one of those pull requests runs the full checks, which is what makes accepting them a
judgement rather than a gamble. They deploy nothing: the deploy job only runs on a push to `main`,
so Dependabot never reaches Cloudflare — and it could not anyway, since pull requests from it are
denied access to repository secrets.

**Do not also connect the repo in the Cloudflare dashboard.** You would get two deployment paths
racing each other, and the dashboard one skips the tests — which is exactly what this workflow
exists to prevent.

**No environment variables** — every credential is entered in the browser and stays there. The two
secrets above are for deploying, not for the app.

The free URL is `msg-stream.<your-subdomain>.workers.dev`. Cloudflare notes that `workers.dev` is
meant for personal and hobby use; that is advice about production robustness rather than a licence
restriction, and a custom domain resolves it whenever you want one.

Free-tier limits, none of which this app can realistically reach: static asset requests and
bandwidth are unlimited, with 500 builds a month.

### HTTPS is required, not optional

Twitch refuses OAuth redirect URLs that aren't HTTPS (except `localhost`), and IndexedDB and
`navigator.storage.persist()` both need a secure context. Cloudflare gives HTTPS free, so this
only bites if you self-host over plain HTTP.

### After the first deploy

1. **Add the deployed URL to your Twitch app** at
   [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) as an OAuth redirect URL —
   `https://your-worker-url/` **with the trailing slash**, since Twitch matches it exactly.
2. **Add the domain to your YouTube API key's** HTTP-referrer restrictions, or sign-in will work
   and YouTube will 403.

### The preview-deployment trap

Preview and branch deployments get generated URLs. Twitch matches redirect URLs exactly, so
**Twitch sign-in fails on any preview** unless that exact URL is registered — impractical when it
changes per commit. Use the production URL for anything involving Twitch. The other sources are
unaffected: they take pasted tokens rather than a redirect.

### What deploying does not change

Nothing is shared between visitors. Each browser keeps its own settings, credentials and message
history, so deploying once serves any number of streamers at no cost and with nothing to
administer — and equally, your own history does not follow you between devices.

## How it's put together

```
app/
  page.tsx                    the only page — everything runs client-side
lib/
  types.ts                    StreamEvent + SourceAdapter — the contracts everything meets
  store.ts                    Zustand store, profiles, filtering
  messages/                   MessageStore interface + IndexedDB and in-memory implementations
  money.ts                    amount formatting
  i18n.ts                     both dictionaries + interpolation
  theme.ts                    theme resolution + the pre-paint boot script
  useConnections.ts           reconciles live adapters against the active profile
  adapters/                   one file per platform
components/                   Feed, EventRow, StatusBar, SettingsDrawer
tests/                        vitest suite
```

Every platform implements one `SourceAdapter` interface and emits a normalized `StreamEvent`, so
platform-specific mess stays inside its own adapter and the UI never learns about it.

Two decisions worth knowing about:

**Significance bands, in the platform's own colours.** Some sources bucket a donation into a
visible band. YouTube reports it as `superChatDetails.tier` — note it sends the tier *number*, never
a colour — and the feed tints the row with YouTube's matching Super Chat colour, blue through red.
Twitch cheers get their cheermote colours the same way. A source that publishes no ladder gets **no
tint at all**, rather than a colour nobody chose.

Where a ladder exists the amount wears the band as a **solid block**, the way those platforms show
it themselves — a faint background tint cannot separate adjacent bands over a dark ground, which
is the whole reason the colour is there. The amount stays one size throughout: the colour already
ranks the donation, so scaling the text as well was redundant. It sits beside the sender's name
rather than on its own line — with paid-only capture every row carries one, so a dedicated line
cost a line on every message in the feed. On a narrow screen it wraps below, which is the old
layout, exactly when there is no room for the compact one. The ink on that block is chosen per colour by measured
WCAG contrast, because no single one reads across a range running from pale yellow to deep red.
Sources with no ladder keep the amount in gold.

Settings → Appearance → **Row background** additionally tints the whole row with that colour. It is
**off by default**: the amount already carries the colour, and tinting every row as well makes a
busy feed loud. Turn it on when a large donation needs to be impossible to miss.

One swatch deviates: the magenta band is one step darker than YouTube's own `#e91e63`, which at
its exact value carries text at 4.35 — under the 4.5 floor for either ink. One caveat worth knowing — Google publishes the tier integer but never states which number
is which colour, so tier 1 is taken to be the lowest band. Ascending is the obvious reading and
matches the amounts, but if a $1 Super Chat ever shows up red, the array in `lib/tiers.ts` is
inverted.

This is the one honest way to rank donations *across* currencies: a ¥1,000 Super Chat and a $5 one
cannot be compared without an exchange rate, and this app never invents one — but YouTube already
bucketed them using its own per-currency thresholds, so using its answer adds information without
inventing any.

Other sources can be mapped in through `tierFromThresholds` in `lib/tiers.ts`, which bands a value
against ascending cut-offs *in the same unit*. Twitch is done that way already, using Twitch's own
cheermote thresholds (1 / 100 / 1000 / 5000 / 10000 bits) — their cut-offs, not ours, and entirely
within bits. A source that reports no band stays visually neutral rather than being shown as the
smallest possible donation.

**Amounts are never converted between currencies.** Bits stay bits, Kicks stay Kicks, ARS stays
ARS. `Amount` carries the native unit and the UI renders it as-is. Inventing a USD equivalent
would put quietly-wrong numbers on a screen used to make decisions.

**Sources do not connect until the database is open.** A message arriving while IndexedDB is still
opening would be written to the in-memory fallback and lost on the next reload, so the adapters
wait on `historyReady` rather than on settings alone.

**Messages go to IndexedDB; only settings stay in localStorage.** The feed itself is a capped
window (1,000 live events, growing as you page back) so an eight-hour stream can't exhaust the
tab, while the database keeps everything. Writes are batched one transaction per animation frame,
reusing the batching the feed already does. The `raw` API payload is dropped before storing — it's
the biggest part of an event and only useful live.

## Ideas for later

- Kick via the official webhook API
- Ceneka, once we know how it exposes donations
- Search across stored history (the data is there; the UI isn't)
- A browser extension, to read Ceneka directly without any third-party account
- More languages (adding one is a single object in `lib/i18n.ts`)
- Reply / mark-as-handled actions rather than just read
- Sound or desktop notification on a paid message above a threshold
- Virtualized list, if a very busy chat starts to stutter
