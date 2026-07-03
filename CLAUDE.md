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
app/store.js        Data layer (window.PT): unified API over local and cloud backends
vendor/supabase.js  Bundled Supabase client (no CDN dependency)
db/schema.sql       Supabase schema: tables, RLS policies, RPC functions, realtime
```

### Data Layer (`app/store.js` → `window.PT`)

The key abstraction. `PT` exposes one API regardless of backend:
- `PT.init()` / `PT.ready()` — boot
- `PT.listTrips()` / `PT.createTrip()` / `PT.deleteTrip()` — trip CRUD
- `PT.loadDoc(id)` / `PT.saveDoc(id, doc)` — read/write a trip document
- `PT.connect(id, {onRemote})` — subscribe to real-time changes (cloud mode)
- `PT.importTrip(json)` / `PT.exportTrip(id)` — JSON import/export

A **trip document** is `{ P, DAYS, RES, S }`:
- **`P`** (Places) — `{id: { n, j?, c, la, ln, ar, d, p?, t?, a?, o? }}` (name, japanese name, category, lat, lng, area, description, price, time, is-anchor, hide-on-map)
- **`DAYS`** — `[{ id, date, dow, title, note, plan[], pool[], switches?[] }]`
- **`RES`** — info sections for the 情報 tab (anchors, checklists, tips)
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
- Language quick-reference cards (Japanese phrases)

### Key Patterns in `trip.html`

- `renderDay()` — redraws map markers and route polyline for current day
- `visPlan(dayId)` — returns visible plan (filters out skipped stops)
- `navUrl(p)` — generates Google Maps or Yahoo! Transit deep link
- `save()` — writes state to localStorage (and queues cloud save)
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
  "P": { "stopId": { "n": "Name", "c": "eat", "la": 35.67, "ln": 139.76, "ar": "Area", "d": "Description" } },
  "DAYS": [{ "id": "d1", "date": "7.17", "title": "Day Title", "plan": ["stopId"], "pool": ["otherId"] }],
  "res": { "sections": [{ "h": "Title", "rows": [["key", "value"]] }] }
}
```

Categories: `eat` 🍜, `sweet` 🍡, `photo` 📸, `shop` 🛍️, `spot` ⛩️, `fun` 🎡, `hotel` 🏨, `fly` ✈️
