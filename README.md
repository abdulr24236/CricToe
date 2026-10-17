# 🏏 CricToe

**A daily cricket trivia grid — fill a 3×3 board of cricketers who match both their row and column category, against the clock.**

Inspired by football's *Tiki-Taka-Toe* and basketball's *Immaculate Grid*, built for cricket.

- **One puzzle a day**, generated deterministically from the date — identical on every device, no server required.
- **3 minutes on the clock.** A correct answer adds **+10s**, a wrong answer costs **−15s**. Run out of time and the board is revealed.
- **Visual category tiles** — country flags, league badges, cricket glyphs and player photos.
- **Category types beyond trivia lists**: country, format, role, batting/bowling style, franchise leagues, ICC honours, captaincy, career stats — and **"played with MS Dhoni"** (anyone who shared an XI with him), derived from real match data.
- **~4,000 international cricketers** from 12 major nations, with per-format career stats.
- No accounts, no backend, no build step to deploy. Progress and streaks live in `localStorage`.

---

## Table of contents

1. [Quick start (run it locally)](#1-quick-start-run-it-locally)
2. [How the game works](#2-how-the-game-works)
3. [Project structure](#3-project-structure)
4. [Where the data comes from (and how to regenerate it)](#4-where-the-data-comes-from-and-how-to-regenerate-it)
5. [Deploying for free](#5-deploying-for-free)
6. [Customising the game](#6-customising-the-game)
7. [Architecture & extension points](#7-architecture--extension-points)
8. [Using the public JavaScript API](#8-using-the-public-javascript-api)
9. [Troubleshooting](#9-troubleshooting)
10. [Roadmap ideas](#10-roadmap-ideas)

---

## 1. Quick start (run it locally)

CricToe loads its data with `fetch()`, so it **must be served over HTTP** — opening `index.html` from the file system will show a friendly error instead of the board.

```bash
cd crictoe

# Any static server works. Python is usually already installed:
python -m http.server 8000
# ...then open http://localhost:8000
```

Alternatives:

```bash
npx serve .          # or: npx http-server -p 8000
php -S localhost:8000
```

**Query parameters**

| Parameter | Example | Effect |
|---|---|---|
| `date` | `?date=2026-07-14` | Replay any past (or future) puzzle |
| `practice` | `?practice=1` | Untimed board that never touches your streak |

---

## 2. How the game works

1. A fresh **3×3 grid** appears each day with three row categories and three column categories.
2. Tap a square and name a cricketer who fits **both** its row *and* its column.
3. **The clock starts the moment you open your first square** and is paused automatically if you switch tabs.
4. Correct answer → the square locks and you gain **+10s**. Wrong answer → you lose **15s** and a hint tells you which half of the square you missed.
5. Fill all nine squares before time runs out to win and extend your streak. Time up, or **Give up & reveal**, shows one valid answer per square.
6. **Practice mode** (top bar) turns the clock off and leaves your streak alone.

Category tiles are visual and image-forward: a flag for a nation, a coloured badge for a league, a cricket glyph for a role or honour, and a **player photo under a "Played with" caption** for teammate categories. Every criterion also carries a plain-English `note`, shown inside the guess panel, so a square can never be misread — "played *with*" is explicitly not "played against" and not "captained by".

> Every generated grid is verified to have **at least two valid answers in every one of its nine squares**, so there is never an unfair cell.

---

## 3. Project structure

```
crictoe/
├── index.html          # markup + element ids the script binds to
├── style.css           # dark "floodlit pitch" theme; tokens live in :root
├── script.js           # the whole game (13 labelled modules, no dependencies)
├── players.json        # generated: config + 179 criteria + 3,998 players   (~0.9 MB)
├── photos.json         # generated: playerId -> Commons photo URL           (~0.15 MB)
├── coappear.json       # generated: playerId -> teammates (for player_ref)  (~0.24 MB)
├── README.md
└── build/              # the data pipeline (only needed to regenerate data)
    ├── lib.mjs              # throttled, retry-aware Wikimedia/Wikidata client
    ├── fetch-wikitext.mjs   # 1. enumerate cricketers + download article wikitext
    ├── parse-wikitext.mjs   # 2. parse {{Infobox cricketer}} -> stats & traits
    ├── fetch-categories.mjs # 3. captain / commentator / World Cup winner categories
    ├── fetch-wikidata.mjs   # 4. Commons photos + Cricinfo join ids
    ├── fetch-cricsheet.mjs  # 5. leagues, ICC honours, co-appearance graph
    ├── build-data.mjs       # 6. merge everything -> players/photos/coappear.json
    └── cache/               # intermediate downloads (safe to delete)
```

Only the six top-level files need to be deployed. `build/` and `build/cache/` are development tools.

---

## 4. Where the data comes from (and how to regenerate it)

The dataset is **generated**, not hand-written. Three open sources are merged:

| Source | Gives us | Licence |
|---|---|---|
| **Wikipedia** | per-format career stats, batting hand, role, bowling style, club history | CC BY-SA 4.0 |
| **Wikidata** | Commons player photos, ESPNcricinfo ids (the join key to Cricsheet) | CC0 |
| **Cricsheet** | who actually played in each league, winners' XIs from every ICC/Asia Cup final, and the co-appearance graph behind "played alongside…" | ODC-By 1.0 (CC BY 4.0 for XML match data) |
| **Wikimedia Commons** | the photos themselves (used via `Special:FilePath`) | per-file |

Pages are enumerated from Wikipedia category pages such as `Category:India Test cricketers` for **12 nations × 3 formats**, then each article's `{{Infobox cricketer}}` is parsed.

### Regenerating

```bash
node build/fetch-wikitext.mjs    # ~4,100 articles  (a few minutes)
node build/parse-wikitext.mjs    # -> build/cache/players-parsed.json
node build/fetch-categories.mjs  # captain / commentator / World Cup winners
node build/fetch-wikidata.mjs    # Commons photos + cricinfo ids
node build/fetch-cricsheet.mjs   # downloads ~75 MB of match archives
node build/build-data.mjs        # -> players.json, photos.json, coappear.json
```

Every stage caches into `build/cache/`, so re-runs resume instead of re-downloading. The pipeline is polite: requests are spaced out, `429`/`5xx` responses are retried with exponential backoff, and `Retry-After` is honoured — please keep it that way if you extend it.

**Adding a nation:** add it to `NATIONS` in `build/fetch-wikitext.mjs` (and to `COUNTRIES` in `build/build-data.mjs` with a flag code), then re-run the pipeline.

**Accuracy note:** the stats are parsed from Wikipedia infoboxes and are *approximations* — perfect for trivia, not for a record book. Where a figure is missing the criterion simply doesn't match that player.

---

## 5. Deploying for free

CricToe is 100% static, so any static host works. All paths are relative, so it also works from a subdirectory.

### First, put the code on GitHub

```bash
git init
git add index.html style.css script.js players.json photos.json coappear.json README.md
git commit -m "CricToe: daily cricket trivia grid"
git branch -M main
git remote add origin https://github.com/<you>/crictoe.git
git push -u origin main
```

### Option A — GitHub Pages (recommended)

1. Push the repo (above).
2. **Settings → Pages → Source: Deploy from a branch → `main` / `root`**.
3. Your game is live at `https://<you>.github.io/crictoe/`.

Free, HTTPS, and custom domains are supported.

### Option B — Vercel

```bash
npm i -g vercel
vercel           # answer the prompts; framework preset: Other
vercel --prod
```

Or import the repo at [vercel.com/new](https://vercel.com/new) — no build command, output directory `.`.

### Option C — Netlify

```bash
npm i -g netlify-cli
netlify deploy --prod --dir .
```

Or drag the folder onto [app.netlify.com/drop](https://app.netlify.com/drop).

### Option D — any static host

Upload the six top-level files to Cloudflare Pages, Render, Surge, S3 + CloudFront, or your own server. No server-side code, no environment variables, no database.

### Before you publish

In `script.js`, point the share text at your URL:

```js
const APP = { /* … */ shareUrl: 'https://your-domain.example' };
```

(Or at runtime: `CricToe.setShareUrl('https://your-domain.example')`.)

---

## 6. Customising the game

Almost everything lives in the `config` block of `players.json`:

```json
{
  "epoch": "2024-01-01",
  "config": {
    "gridSize": 3,
    "allowReuse": true,
    "minAnswersPerCell": 2,
    "timer": { "seconds": 180, "wrongPenalty": 15, "correctBonus": 10 }
  }
}
```

| Key | Meaning |
|---|---|
| `epoch` | Day 0 of the puzzle calendar — change it and every future grid shifts |
| `timer.seconds` | Starting time. `240` for an easier board, `120` for a brutal one |
| `timer.wrongPenalty` | Seconds lost per wrong answer |
| `timer.correctBonus` | Seconds gained per correct answer |
| `minAnswersPerCell` | Solvability floor enforced by the generator (minimum 2 recommended) |
| `allowReuse` | May one cricketer answer several squares? |

The theme is entirely token-driven — edit the `:root` block at the top of `style.css` (colours, radii, fonts) to reskin the game. Display type is **Bebas Neue**, loaded from Google Fonts by `index.html`; if that request fails (offline, or a strict CSP) it falls back to Arial Narrow / Segoe UI and the layout still holds. `--font-display` and the `--card*` tokens at the bottom of `style.css` control the tile look.

### Adding or tweaking criteria

Criteria are emitted by `build/build-data.mjs`, but you can also hand-edit `players.json`. Each entry is one of:

```json
{ "id": "ipl", "type": "trait", "trait": "ipl", "group": "league",
  "label": "Played in the IPL", "short": "IPL",
  "note": "Has played at least one Indian Premier League match.",
  "icon": { "kind": "badge", "text": "IPL", "tone": "blue" } }
```

- **`trait`** — matches when `player.traits` contains `trait`.
- **`stat`** — `{ "type": "stat", "stat": "test_w", "min": 200 }` matches when `player.stats.test_w >= 200`.
- **`player_ref`** — `{ "type": "player_ref", "playerId": "ms-dhoni" }` matches anyone in `coappear.json`.
- **`note`** — one plain-English sentence explaining the rule, rendered under the guess panel chips. Every emitted criterion has one; keep it that way, because it is what disambiguates a square.
- A `photo` icon may carry a **`prefix`** (e.g. `"Played with"`), rendered as a caption above the player's name on the tile, with the full `label` ("Was a teammate of MS Dhoni") shown in the guess panel.

`group` matters: the generator picks **six distinct groups** per grid (three rows, three columns), so a grid can never ask for the same kind of thing twice. Groups in use: `country`, `format`, `role`, `style`, `league`, `honour`, `stat`, `teammate`, `misc`.

Icon `kind`s: `flag` (a country code for flagcdn), `badge` (styled acronym), `glyph` (a built-in cricket SVG), `stat` (number + glyph), `photo` (a player photo).

---

## 7. Architecture & extension points

`script.js` is a single dependency-free file split into 13 labelled modules:

| # | Module | Responsibility |
|---|---|---|
| 1 | `CONFIG` | constants, storage keys |
| 2 | `UTILS` | DOM, date, text and seeded-RNG helpers |
| 3 | `STORE` | `localStorage` persistence (versioned keys, private-mode safe) |
| 4 | `DATA` | loads the three JSON files; builds lookup + answer-set indexes |
| 5 | `PUZZLE ENGINE` | deterministic, date-seeded, always-solvable grids |
| 6 | `TIMER` | the shot clock (start/pause/penalty/bonus) |
| 7 | `GAME` | pure state and rules — solving, scoring, win/loss |
| 8–11 | `UI` | category tiles, board/HUD, guess panel + autocomplete, modals/toasts |
| 12 | `SHARE` | emoji summary for sharing |
| 13 | `PUBLIC API` | `window.CricToe` |

**How a daily grid is chosen:** `dayIndex` (days since `epoch`) is hashed with `xmur3`, seeded into a `mulberry32` PRNG, and used to shuffle the category groups and draw one criterion per group. The candidate grid is accepted only if all nine cells have at least `minAnswersPerCell` answers; otherwise the seed is advanced. The result is identical on every device and needs no backend.

**Answer sets are precomputed.** On load, `DATA` builds a `Set` of player indexes per criterion, so a cell's answers are a fast set intersection — which is why generation over thousands of players is instant, and why adding players is cheap.

---

## 8. Using the public JavaScript API

Everything is exposed on `window.CricToe` for tests, plugins and debugging:

```js
CricToe.version                       // '2.0.0'
CricToe.Data.players.length           // 3998
CricToe.Data.criteria.length          // 179
CricToe.PuzzleEngine.forDay(1000)     // deterministic grid object
CricToe.PuzzleEngine.cellSize(row, col)
CricToe.Game.submitGuess(index, player)
CricToe.Game.cellAnswers(0)           // all valid answers for a square
CricToe.Timer.add(-5000)              // nudge the clock
CricToe.Stats.data                    // streaks + time histogram
CricToe.loadDate('2026-07-14')        // swap the board without a reload
CricToe.setShareUrl('https://…')
CricToe.on('finished', (result) => console.log(result));
```

Events: `data:loaded`, `puzzle:ready`, `correct`, `wrong`, `finished`, `stats:change`, plus timer events (`tick`, `expire`, `bonus`, `penalty`, `change`).

---

## 9. Troubleshooting

**"Could not load the player data" instead of the board.**
You opened `index.html` directly (`file://`), and browsers block `fetch()` of local files for security. Serve the folder:

```bash
python -m http.server 8000
# open http://localhost:8000
```

**The data files are missing or 404.**
`index.html`, `script.js`, `players.json`, `photos.json` and `coappear.json` must sit **in the same folder**. If you renamed `players.json`, update `APP.dataUrl` in `script.js` too.

**No player photos appear.**
Photos are hotlinked from Wikimedia Commons via `Special:FilePath`. Some players have no free image (the game falls back to an initials avatar), and a strict ad-blocker or offline connection will hide the rest. Everything else works without them.

**A request for `/health` returns 404 in the server log.**
That is not CricToe — the game only ever requests its own files. The `/health` probe comes from an external tool (IDE preview, antivirus web-shield, browser extension or uptime monitor) and can be ignored. Success looks like this:

```
"GET / HTTP/1.1" 200 -
"GET /players.json HTTP/1.1" 200 -
```

You can mute the noise with a tiny logging server:

```python
# serve.py — python serve.py
import http.server, socketserver

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        message = str(args[0] if args else '')
        if '/health' in message:
            return  # ignore external health probes
        super().log_message(fmt, *args)

with socketserver.TCPServer(("", 8000), Quiet) as httpd:
    print("Serving on http://localhost:8000")
    httpd.serve_forever()
```

**Stale board after editing the data.**
Hard-refresh (`Ctrl+Shift+R`). Bump `APP.version` if you change the progress format.

**Paths with spaces (e.g. OneDrive folders).**
Quote them: `cd "C:\Users\You\OneDrive\Desktop\crictoe"`. Inside OneDrive, "Files On-Demand" can also make files unreadable until opened once — right-click the folder and choose *Always keep on this device* if the data fails to load.

**Clear my progress.** The Stats modal has **Clear saved data**; or delete the `crictoe:*` keys from `localStorage`.

---

## 10. Roadmap ideas

Already in: daily rotation, archive replay (`?date=`), practice mode, streaks, time histogram, hints on a miss, player photos, teammate categories.

Ideas from here: a hard mode with no hints, per-category difficulty ratings, a "guess the whole XI" bonus, women's internationals as a second dataset, cloud sync of streaks, and a small head-to-head mode.

---

## Licence & attribution

The game code is yours to use and modify. The **data** carries the licences of its sources, and the footer credits them:

- **Wikipedia** — CC BY-SA 4.0
- **Wikidata** — CC0
- **Cricsheet** — ODC-By 1.0 / CC BY 4.0
- **Wikimedia Commons** photos — per-file licences (mostly CC BY-SA); attribution is linked in the footer

If you republish the dataset, keep those credits (and the links) intact.

CricToe is an unofficial fan project and is not affiliated with the ICC, any national board, or any league. League names are used descriptively, and no league or board logos are used — the badges are drawn in CSS.
