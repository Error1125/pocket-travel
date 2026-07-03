# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

東京口袋帖 (Tokyo Pocket Travel Guide) — a single-file mobile-first PWA for managing Tokyo travel itineraries with an interactive map. Users import a trip JSON, then browse/plan/navigate stops per day.

## Tech Stack

- **No build system** — single `index.html` with inlined CSS and JS (open directly in browser)
- **Leaflet.js 1.9.4** — inlined in `<script>` at top, provides the interactive map
- **CartoDB Voyager** tiles — map style (requires internet for tiles; all trip data is offline)
- **localStorage** — persists user state (`tpk2` key) and imported trip data (`tpk2_trip` key)
- **No dependencies, no npm, no bundler**

## Architecture

The entire app lives in `index.html` with three `<script>` blocks:

1. **Leaflet library** (lines ~2074–9963) — vendored, do not modify
2. **Data constants** (lines ~9966–10117) — `CAT`, `P`, `DAYS`, `RES`, `LANG` globals with template/example data. Overwritten at runtime if a saved trip exists in localStorage.
3. **App logic** (lines ~10119–end) — IIFE containing all UI, map, and state logic

### Key Data Structures

- **`P` (Places)** — object keyed by stop ID. Each entry: `{ n, j?, c, la, ln, ar, d, p?, t?, a?, o? }` (name, japanese name, category, lat, lng, area, description, price, time, is-anchor, hide-on-map)
- **`DAYS`** — array of day objects: `{ id, date, dow, title, note, plan[], pool[], switches?[] }`
- **`CAT`** (Categories) — emoji + label + color per category (`eat`, `sweet`, `photo`, `shop`, `spot`, `fun`, `hotel`, `fly`)
- **`RES`** (Resources) — info sections shown in the 情報 (info) tab
- **`S` (State)** — user state in localStorage: `{ plans:{dayId:[stopIds]}, done:{}, sw:{}, coach, nav }`

### Trip JSON Format (`東京口袋帖_行程.json`)

Importable trip file with `{ v, meta, P, DAYS, res }`. On import, `P`/`DAYS`/`RES` are saved to localStorage and the page reloads. The JSON in the repo is the real Tokyo 5-day trip data.

### UI Structure

- **Map** (`#map`) — full-screen Leaflet map with stop markers and route polylines
- **Day bar** (`#daybar`) — horizontal day tabs + pool/plan toggle + action buttons
- **Bottom sheet** (`#sheet`) — stop detail panel with navigation buttons
- **Switches** — toggle UI elements that add/remove stops or skip areas (defined per day in `switches[]`)

## Key Patterns

- All state changes call `save()` which writes `S` to localStorage
- `renderDay()` redraws map markers and the stop list for the current day
- `visPlan(dayId)` returns the visible plan (filtering out skipped stops)
- Navigation links generate Google Maps or Yahoo! Transit URLs via `navUrl()`
- Markers use `L.divIcon` with custom HTML (stamp icons for anchors, pin icons for regular stops)
- The "pool" is a per-day array of optional stops not in the active plan

## Working with This File

- Edit `index.html` directly — there is no build step
- The trip JSON file can be edited to modify trip data, then re-imported in the app
- CSS is in a `<style>` block in `<head>` (lines ~16–1990)
- Keep the Leaflet vendored block untouched
- Test by opening `index.html` in a browser
