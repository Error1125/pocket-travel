# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

口袋旅行 (Pocket Travel) — a mobile-first travel itinerary PWA. Two pages: a trip list/homepage (`index.html`) and a trip planner with interactive map (`trip.html`). Supports local-only mode (localStorage) and optional cloud mode (Supabase) with real-time sync and sharing.

## Tech Stack

- **No build system** — static site, open in browser or deploy to GitHub Pages
- **Leaflet.js** — interactive map in `trip.html`
- **CartoDB Voyager** — map tiles (requires internet; trip data is fully offline)
- **Supabase** (optional) — auth, cloud storage, real-time sync, invite-based sharing
- **localStorage** — offline cache for both modes; sole storage in local mode

## Architecture

### File Structure

```
index.html          Homepage: trip list, auth (cloud), import/export, sharing
trip.html           Trip planner: map + daily itinerary + pool stops + language guide
app/config.js       Mode switch: Supabase URL/key (empty = local mode), auth methods, app name
server/             AI proxy examples — Mimo token lives in server env vars, NEVER in frontend
app/store.js        Data layer (window.PT): unified API over local and cloud backends
vendor/supabase.js  Bundled Supabase client (no CDN dependency)
db/schema.sql       Supabase schema: tables, RLS policies, RPC functions, realtime
```

### Data Layer (`app/store.js` → `window.PT`)

The key abstraction. `PT` exposes one API regardless of backend:
- `PT.init()` / `PT.ready()` — boot
- `PT.listTrips()` / `PT.createTrip()` / `PT.deleteTrip()` — trip CRUD
- `PT.loadDoc(id)` / `PT.saveDoc(id, doc)` — read/write a trip document
- `PT.connect(id, {onRemote, onPresence})` — subscribe to real-time changes + presence (who else is viewing; cloud mode)
- `PT.importTrip(json)` / `PT.exportTrip(id)` — JSON import/export

A **trip document** is `{ P, DAYS, RES, LANG, S }`:
- **`P`** (Places) — `{id: { n, j?, c, la, ln, ar, d, p?, t?, a?, o?, tr?, bk? }}` (name, japanese name, category, lat, lng, area, description, price, time, is-anchor, hide-on-map, transport hint, booking info)
- **`DAYS`** — `[{ id, date, dow, title, note, plan[], pool[], switches?[] }]`
- **`RES`** — info sections for the 情報 tab (anchors, checklists, tips) — user-editable in-app (add sections/rows)
- **`LANG`** — language survival kit: `[{ s: "group title", ps: [["phrase", "note"]] }]`; user-editable in-app; `[]` hides the 语言 tab, `undefined` (old docs) falls back to the built-in Japanese pack
- **`S`** — user planning state: `{ plans:{dayId:[stopIds]}, done:{}, sw:{}, coach, nav }`

### Dual Backend Design

`app/store.js` selects backend at load time based on `config.js`:
- **LocalBackend** — pure localStorage, no auth, works offline
- **CloudBackend** — Supabase auth + Postgres + realtime; localStorage used as offline cache

Both implement the same interface. `trip.html` always reads from cache first (instant + offline), then syncs in background.

### Trip HTML (`trip.html`)

Single-page app with:
- Full-screen Leaflet map with custom `L.divIcon` markers
- Day bar navigation (horizontal scroll)
- Pool (optional stops) vs Plan (active stops) toggle
- Bottom sheet for stop details + navigation buttons
- Switches: toggle UI that adds/removes stops or skips areas
- Language quick-reference cards — data-driven (`LANG`), add phrases/groups in-app
- Place editor (bottom sheet ✎ / ＋ buttons): add/edit/delete places incl. transport (`tr`) & booking (`bk`); anchors get a red warning on create and require confirm on create/edit/delete (double-confirm on delete)
- Presence pill under the day bar: shows companions currently viewing the shared trip (cloud mode)

### Key Patterns in `trip.html`

- `renderDay()` — redraws map markers and route polyline for current day
- `visPlan(dayId)` — returns visible plan (filters out skipped stops)
- `navUrl(p)` — generates Google Maps or Yahoo! Transit deep link
- `save()` — writes state to localStorage (and queues cloud save); doc now carries `LANG`
- `openEditor(id?, {mode, dayId})` — place add/edit sheet (plan or pool); map pick mode via `_pick`
- `setSheetSnap("peek"|"mid"|"full")` — stop-detail sheet snap levels; opens at peek so bubbles stay visible; fixed action bar lives in `#sfoot`, nav opens a chooser popup (`openNavPop`), edit is tucked in the ⋯ menu, delete = long-press a plan card
- AI buddy: `aiSend(text)` chat flow → `PTAI.chat({messages, doc})` when `AI_ENDPOINT` set, local demo otherwise; responses render as chat bubbles, place cards, or whole-route preview cards; adopting is always user-initiated (never auto-writes the doc). Fab eye states: `.think` (scanning) / `.ping` (reply flash) / `.happy` / `.wig` (idle micro-expressions via `aiIdleTick`); `?ai=1` on the trip URL auto-opens the panel (used by the homepage entry)
- Swipe-to-delete: plan & pool cards are wrapped in `.swipe` (with a `.swipe-del` layer); `initSwipe(container)` binds the leftward drag, `openSwipe`/`closeSwipe` toggle. Reorder (`startReorder`) operates on the `.swipe` wrapper, not the inner `.card`. Delete goes through `deletePlaceFlow` (anchors double-confirm)
- Recommendation sheet (`openRecSheet`) writes its actions into `#sfoot` (加入行程 / 收进随缘池 only, no nav) — must set `#sfoot` so stale buttons from a prior `openSheet` don't leak
- `trip.html` has ONE authoritative `<style>` block; an old duplicate block was removed. `index.html` `tagCard` reads `PT.loadDocSync(id)` for day/place counts + a cover.
- Homepage AI (`index.html`): no mascot. `renderAIEntry()` = bottom brand-mark button; a top `.ai-hero` banner (rendered in `paintList`) has quick chips. Both call `openAIChat(prefill?)`, a full-screen overlay (`#aichat`) with its own chat loop `acSend()` → `PTAI.chat({messages, doc, want:"trip"})` (demo `acDemoTrip()` fallback). Full-trip proposals render as `.ac-trip` cards; `acCreateTrip(trip, cb)` builds a doc (P + DAYS + S.plans) and calls `PT.createTrip({title,emoji,doc})`, then `loadList()`. index.html now includes `app/ai-planner.js`.
- AI response protocol (`app/ai-planner.js`): `chat()` returns `{reply, P?, route?, trip?}`; `trip = {title, emoji, P, days:[{date,title,plan:[id]}]}`. Request may carry `want:"trip"`. Server prompt in `server/supabase-edge/ai-proxy.ts` emits `trip` for whole-plan asks.
- `renderPresence(names)` / `syncSayTab()` — presence pill & 语言 tab visibility
- Markers: stamp icons for anchors (time-based), pin icons for regular stops (numbered)

## Working with This Code

- **Local dev**: `python3 -m http.server 8000` (multi-file needs a server; direct file:// may break)
- **Deploy**: push to GitHub Pages (Settings → Pages → main branch root)
- **Cloud mode**: fill `app/config.js` with Supabase credentials, run `db/schema.sql` in Supabase SQL Editor
- **anon key is safe to commit** — it's a public frontend key; security is enforced by RLS in the database

## Data Format

Trip JSON (importable):
```json
{
  "v": 2,
  "meta": { "title": "...", "emoji": "🗼", "exported": "2026-07-03" },
  "P": { "stopId": { "n": "Name", "c": "eat", "la": 35.67, "ln": 139.76, "ar": "Area", "d": "Description", "tr": "Ginza line exit A4", "bk": "Reserve 7 days ahead" } },
  "DAYS": [{ "id": "d1", "date": "7.17", "title": "Day Title", "plan": ["stopId"], "pool": ["otherId"] }],
  "res": { "sections": [{ "h": "Title", "rows": [["key", "value"]] }] },
  "LANG": [{ "s": "🙏 基本", "ps": [["すみません", "不好意思/劳驾"]] }]
}
```

Categories: `eat` 🍜, `sweet` 🍡, `photo` 📸, `shop` 🛍️, `spot` ⛩️, `fun` 🎡, `hotel` 🏨, `fly` ✈️
