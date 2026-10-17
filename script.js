/* ==========================================================================
   CricToe — script.js
   A daily cricket trivia grid game (Tiki-Taka-Toe / Immaculate-Grid style).

   ARCHITECTURE OVERVIEW
   ---------------------
     1.  CONFIG           — tunable constants (timer, storage keys, version)
     2.  UTILS            — DOM / date / text / RNG helpers
     3.  STORE            — localStorage persistence (progress, stats, prefs)
     4.  DATA             — loads players/photos/coappear, builds fast indexes
     5.  PUZZLE ENGINE    — deterministic, date-seeded, always-solvable grids
     6.  TIMER            — the shot clock that replaced the guess counter
     7.  GAME             — pure game state + rules (solving, penalties, win/loss)
     8.  UI: TILES        — renders category tiles (flags, badges, glyphs, photos)
     9.  UI: BOARD        — renders the 3x3 grid, HUD and progress bar
    10.  UI: GUESS PANEL  — cell selection, autocomplete, guess submission
    11.  UI: MODALS       — how-to-play, results/share, stats, toasts
    12.  SHARE            — builds the emoji summary for sharing
    13.  PUBLIC API       — window.CricToe for future features + tests

   DATA MODEL
   ----------
   players.json  -> { epoch, config, attributions, criteria[], players[] }
   photos.json   -> { playerId: imageUrl }
   coappear.json -> { playerId: { name, teammates: [playerId] } }

   A criterion is one of:
     { type:'trait',      trait:'india' }        -> player.traits includes it
     { type:'stat',  stat:'test_c', min:20 }     -> player.stats[stat] >= min
     { type:'player_ref', playerId:'ms-dhoni' }  -> shares an XI with that player
   ========================================================================== */

(function () {
  'use strict';

  /* ========================================================================
     1. CONFIG
     ======================================================================== */
  const APP = {
    name: 'CricToe',
    version: '2.0.0',
    dataUrl: 'players.json',
    photosUrl: 'photos.json',
    coappearUrl: 'coappear.json',
    epoch: '2024-01-01', // day 0 of the puzzle calendar
    // Leave blank to share the page you are actually on. Call
    // CricToe.setShareUrl('https://your-domain/') to hard-code a canonical one.
    shareUrl: '',
  };

  /** Fallbacks if players.json somehow omits them. */
  const DEFAULT_CONFIG = {
    gridSize: 3,
    allowReuse: true,
    minAnswersPerCell: 2,
    timer: { seconds: 180, wrongPenalty: 15, correctBonus: 10 },
  };

  const STORE_KEYS = {
    progress: (dateKey) => `crictoe:progress:v2:${dateKey}`,
    stats: 'crictoe:stats:v2',
    prefs: 'crictoe:prefs:v2',
  };

  const EMOJI = { correct: '🟩', revealed: '🟨', empty: '⬛', wrong: '🟥' };

  /** Country flags come from flagcdn (free, no key, renders on Windows). */
  const flagUrl = (code) => `https://flagcdn.com/w40/${code}.png`;

  /** Small line-art cricket glyphs, drawn in the tile accent colour. */
  const GLYPHS = {
    bat: '<path d="M15.2 3.1l5.7 5.7-9 9-5.7-5.7z"/><path d="M6.2 17.8L4 20"/>',
    ball: '<circle cx="12" cy="12" r="8.4"/><path d="M7.4 6.6c2.6 3 2.6 7.8 0 10.8"/><path d="M16.6 6.6c-1.2 1.4-1.9 3.2-1.9 5.4"/>',
    cap: '<path d="M5.5 15.5h13"/><path d="M6.6 15.5c0-4 2.4-7.2 5.4-7.2s5.4 3.2 5.4 7.2"/><path d="M4 15.5h14"/>',
    gloves: '<rect x="3.4" y="7.4" width="6.6" height="11.6" rx="3.3"/><rect x="14" y="7.4" width="6.6" height="11.6" rx="3.3"/><path d="M3.4 15.6h6.6"/><path d="M14 15.6h6.6"/>',
    allround: '<path d="M15.4 3.2l5.4 5.4-8.6 8.6-5.4-5.4z"/><path d="M6.6 17.6L4.2 20"/><circle cx="6.9" cy="6.9" r="3.2"/>',
    bolt: '<path d="M13.4 2.6L5.2 13.4h5.1L8.6 21.4l8.2-11.2h-5.1z"/>',
    spin: '<path d="M19.6 12a7.6 7.6 0 1 1-2.3-5.5"/><path d="M20.4 3.4v4.2h-4.2"/>',
    speed: '<path d="M3.8 17.2a8.2 8.2 0 0 1 16.4 0"/><path d="M12 17.2l3.8-5"/><circle cx="12" cy="17.4" r="1.1"/>',
    hand: '<path d="M20 12H4.6"/><path d="M10.4 5.8L4.2 12l6.2 6.2"/>',
    trophy: '<path d="M7.4 3.8h9.2v4.6a4.6 4.6 0 0 1-9.2 0z"/><path d="M7.4 5.6H4.6a2.4 2.4 0 0 0 2.5 2.6"/><path d="M16.6 5.6h2.8a2.4 2.4 0 0 1-2.5 2.6"/><path d="M12 12.9v3.6"/><path d="M8.4 20.2h7.2"/>',
    star: '<path d="M12 3.2l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.9l-5.3 2.9 1.1-6L3.4 9.6l6-.8z"/>',
    mic: '<rect x="9.2" y="2.8" width="5.6" height="10.4" rx="2.8"/><path d="M6 11.2a6 6 0 0 0 12 0"/><path d="M12 17.2v4"/>',
  };

  /** Inline SVG for a named glyph. */
  function glyphSvg(name, className = 'axis__glyph') {
    const body = GLYPHS[name] || GLYPHS.ball;
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  /* ========================================================================
     2. UTILS
     ======================================================================== */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /** Create an element with optional class/text/html/attrs in one call. */
  function el(tag, opts = {}) {
    const node = document.createElement(tag);
    if (opts.className) node.className = opts.className;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.html != null) node.innerHTML = opts.html;
    if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  /** Escape text before putting it in an HTML string. */
  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** Two-letter initials for the photo fallback. */
  function initials(name) {
    const parts = String(name).replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /* ---- Dates ------------------------------------------------------------ */

  function toDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function dayIndexFromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    const [ey, em, ed] = APP.epoch.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ey, em - 1, ed)) / 86400000);
  }

  function shiftDateKey(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  function prettyDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function msToNextMidnight() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0) - now;
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  /** mm:ss for the shot clock. */
  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /* ---- Seeded randomness (deterministic daily puzzles) ------------------ */

  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rng) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Lowercase, strip accents/punctuation — used by search and matching. */
  function normalise(text) {
    return String(text)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Tiny event emitter (also exposed on window.CricToe). */
  function createEmitter() {
    const listeners = new Map();
    return {
      on(event, cb) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(cb);
        return () => listeners.get(event).delete(cb);
      },
      emit(event, payload) {
        (listeners.get(event) || []).forEach((cb) => {
          try { cb(payload); } catch (err) { console.error(err); }
        });
      },
    };
  }

  const emitter = createEmitter();

  /* ========================================================================
     3. STORE — localStorage with graceful failure
     ======================================================================== */
  const Store = {
    _mem: new Map(),
    _read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return this._mem.has(key) ? this._mem.get(key) : fallback;
      }
    },
    _write(key, value) {
      this._mem.set(key, value);
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
      return value;
    },
    _remove(key) {
      this._mem.delete(key);
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },

    loadProgress: function (dateKey) { return this._read(STORE_KEYS.progress(dateKey), null); },
    saveProgress(dateKey, snapshot) { return this._write(STORE_KEYS.progress(dateKey), snapshot); },
    clearProgress(dateKey) { this._remove(STORE_KEYS.progress(dateKey)); },

    loadStats() {
      return this._read(STORE_KEYS.stats, {
        played: 0, wins: 0, currentStreak: 0, maxStreak: 0,
        distribution: {}, bestTimeSec: null, lastDate: null, lastResult: null,
      });
    },
    saveStats(stats) { return this._write(STORE_KEYS.stats, stats); },

    loadPrefs() { return this._read(STORE_KEYS.prefs, { practice: false, seenHelp: false }); },
    savePrefs(prefs) { return this._write(STORE_KEYS.prefs, prefs); },

    clearAll() {
      this._mem.clear();
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('crictoe:'))
          .forEach((k) => localStorage.removeItem(k));
      } catch { /* ignore */ }
    },
  };

  /* ========================================================================
     4. DATA — load the dataset and precompute answer sets
     ======================================================================== */
  const Data = {
    players: [],
    byId: new Map(),
    indexOfId: new Map(),
    criteria: [],
    criteriaById: new Map(),
    /** criterionId -> Set<playerIndex> — makes cell intersections instant. */
    answerSets: new Map(),
    photos: {},
    coappear: {},
    config: DEFAULT_CONFIG,
    attributions: [],
    searchIndex: [],
    loaded: false,

    async load() {
      const fetchJson = async (url) => {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.json();
      };
      // All three are small (~1.2 MB raw, ~300 KB gzipped) — load together.
      const [payload, photos, coappear] = await Promise.all([
        fetchJson(APP.dataUrl),
        fetchJson(APP.photosUrl).catch(() => ({})),
        fetchJson(APP.coappearUrl).catch(() => ({})),
      ]);
      this.ingest(payload);
      this.photos = photos || {};
      this.coappear = coappear || {};
      this.buildIndexes();
      this.loaded = true;
      emitter.emit('data:loaded', { players: this.players.length, criteria: this.criteria.length });
      return this;
    },

    ingest(raw) {
      if (raw.epoch) APP.epoch = raw.epoch;
      this.config = Object.assign({}, DEFAULT_CONFIG, raw.config || {});
      this.config.timer = Object.assign({}, DEFAULT_CONFIG.timer, (raw.config && raw.config.timer) || {});
      this.attributions = raw.attributions || [];
      this.criteria = raw.criteria || [];
      this.players = raw.players || [];
    },

    buildIndexes() {
      this.byId.clear(); this.indexOfId.clear();
      this.players.forEach((p, i) => {
        this.byId.set(p.id, p);
        this.indexOfId.set(p.id, i);
      });
      this.criteriaById.clear();
      this.answerSets.clear();

      for (const c of this.criteria) {
        this.criteriaById.set(c.id, c);
        this.answerSets.set(c.id, this._answersFor(c));
      }

      this.searchIndex = this.players.map((p) => {
        const name = normalise(p.name);
        const hay = normalise([p.name, ...(p.aliases || [])].join(' '));
        return { player: p, name, hay, words: hay.split(' ') };
      });
    },

    _answersFor(c) {
      const set = new Set();
      if (c.type === 'trait') {
        this.players.forEach((p, i) => { if (p.traits.includes(c.trait)) set.add(i); });
      } else if (c.type === 'stat') {
        this.players.forEach((p, i) => { const v = p.stats[c.stat]; if (v != null && v >= c.min) set.add(i); });
      } else if (c.type === 'player_ref') {
        const ref = this.coappear[c.playerId];
        for (const id of (ref && ref.teammates) || []) {
          const i = this.indexOfId.get(id);
          if (i != null) set.add(i);
        }
      }
      return set;
    },

    photoOf(playerId) { return this.photos[playerId] || null; },

    /** Number of players satisfying a criterion. */
    answerCount(criterionId) {
      const set = this.answerSets.get(criterionId);
      return set ? set.size : 0;
    },

    /** Does this player satisfy a single criterion? */
    matches(player, criterion) {
      if (!player || !criterion) return false;
      if (criterion.type === 'trait') return player.traits.includes(criterion.trait);
      if (criterion.type === 'stat') {
        const v = player.stats[criterion.stat];
        return v != null && v >= criterion.min;
      }
      if (criterion.type === 'player_ref') {
        const set = this.answerSets.get(criterion.id);
        const i = this.indexOfId.get(player.id);
        return !!(set && i != null && set.has(i));
      }
      return false;
    },

    /** Players matching BOTH criteria (row ∩ column). */
    answers(rowCrit, colCrit) {
      const a = this.answerSets.get(rowCrit.id) || new Set();
      const b = this.answerSets.get(colCrit.id) || new Set();
      const [small, big] = a.size <= b.size ? [a, b] : [b, a];
      const out = [];
      for (const i of small) if (big.has(i)) out.push(this.players[i]);
      return out;
    },

    /** Ranked autocomplete search over names + aliases. */
    search(query, limit = 8) {
      const q = normalise(query);
      if (q.length < 2) return [];
      const hits = [];
      for (const entry of this.searchIndex) {
        const idx = entry.hay.indexOf(q);
        if (idx === -1) continue;
        let score = 3;
        if (entry.name.startsWith(q)) score = 0;
        else if (entry.words.some((w) => w.startsWith(q))) score = 1;
        else if (entry.name.includes(q)) score = 2;
        hits.push({ entry, score, idx });
      }
      hits.sort((a, b) => a.score - b.score || a.idx - b.idx ||
        a.entry.player.name.localeCompare(b.entry.player.name));
      return hits.slice(0, limit).map((h) => h.entry.player);
    },

    /** Turn typed text into a player, or null when it isn't a known cricketer. */
    resolvePlayer(text) {
      const q = normalise(text);
      if (!q) return null;
      // Exact name / alias.
      const exact = this.players.find((p) =>
        normalise(p.name) === q || (p.aliases || []).some((a) => normalise(a) === q));
      if (exact) return exact;
      // Otherwise require an unambiguous prefix match.
      const hits = this.search(text, 2);
      if (hits.length === 1) return hits[0];
      return null;
    },
  };

  /* ========================================================================
     5. PUZZLE ENGINE — deterministic and solvable by construction
     ======================================================================== */
  const PuzzleEngine = {
    groupList: [],
    criteriaByGroup: new Map(),

    init() {
      this.criteriaByGroup.clear();
      for (const c of Data.criteria) {
        if (!this.criteriaByGroup.has(c.group)) this.criteriaByGroup.set(c.group, []);
        this.criteriaByGroup.get(c.group).push(c);
      }
      this.groupList = [...this.criteriaByGroup.keys()];
    },

    /** How many players fit both criteria. */
    cellSize(rowCrit, colCrit) {
      const a = Data.answerSets.get(rowCrit.id) || new Set();
      const b = Data.answerSets.get(colCrit.id) || new Set();
      const [small, big] = a.size <= b.size ? [a, b] : [b, a];
      let n = 0;
      for (const i of small) if (big.has(i)) n++;
      return n;
    },

    /**
     * Build the grid for a given day.
     * Six distinct category *groups* are chosen (three rows, three columns)
     * so a grid can never ask for the same thing twice, then one criterion is
     * drawn per group. Failed draws retry with a new seed, so every published
     * grid is guaranteed solvable on every square.
     */
    generate(dayIndex) {
      const min = Data.config.minAnswersPerCell || 2;
      for (let attempt = 0; attempt < 800; attempt++) {
        const rng = mulberry32(xmur3(`${dayIndex}:${attempt}`)());
        if (this.groupList.length < 6) break;
        const groups = shuffle(this.groupList, rng).slice(0, 6);
        const pick = (group) => {
          const pool = this.criteriaByGroup.get(group) || [];
          return pool[Math.floor(rng() * pool.length)];
        };
        const rows = groups.slice(0, 3).map(pick);
        const cols = groups.slice(3, 6).map(pick);
        if (!rows.length || !cols.length) break;
        let ok = true;
        for (const r of rows) {
          for (const c of cols) {
            if (this.cellSize(r, c) < min) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (ok) return { dayIndex, rows, cols, attempt };
      }
      // Extremely unlikely fallback: first three criteria of each group.
      return {
        dayIndex,
        rows: this.groupList.slice(0, 3).map((g) => this.criteriaByGroup.get(g)[0]),
        cols: this.groupList.slice(3, 6).map((g) => this.criteriaByGroup.get(g)[0]),
        attempt: -1,
      };
    },

    forDay(dayIndex) { return this.generate(dayIndex); },
    forDateKey(dateKey) { return this.generate(dayIndexFromKey(dateKey)); },

    /** The nine cells, each knowing its row/column criteria. */
    cells(puzzle) {
      const out = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          out.push({ index: r * 3 + c, row: r, col: c, rowCrit: puzzle.rows[r], colCrit: puzzle.cols[c] });
        }
      }
      return out;
    },

    answersFor(rowCrit, colCrit) { return Data.answers(rowCrit, colCrit); },
  };

  /* ========================================================================
     6. TIMER — the shot clock
     ======================================================================== */
  const Timer = {
    totalMs: 180000,
    remainingMs: 180000,
    state: 'idle',       // idle | running | paused | over | off
    enabled: true,
    _handle: null,
    _lastTick: 0,
    _emit: createEmitter(),

    on(event, cb) { return this._emit.on(event, cb); },
    _fire(event, payload) { this._emit.emit(event, payload); this._emit.emit('change', this.status()); },

    status() {
      return { state: this.state, remainingMs: this.remainingMs, totalMs: this.totalMs, enabled: this.enabled };
    },

    reset(seconds, remainingMs = null, enabled = true) {
      this.stop();
      this.enabled = enabled;
      this.totalMs = Math.max(1, seconds) * 1000;
      this.remainingMs = remainingMs == null ? this.totalMs : Math.min(remainingMs, this.totalMs);
      this.state = enabled ? 'idle' : 'off';
      this._fire('reset');
    },

    /** idempotent: pressing a cell repeatedly never restarts the clock. */
    start() {
      if (!this.enabled || this.state === 'running' || this.state === 'over') return;
      this.state = 'running';
      this._lastTick = Date.now();
      this._handle = setInterval(() => this._tick(), 200);
      this._fire('start');
    },

    _tick() {
      if (this.state !== 'running') return;
      const now = Date.now();
      const delta = now - this._lastTick;
      this._lastTick = now;
      this.remainingMs -= delta;
      if (this.remainingMs <= 0) {
        this.remainingMs = 0;
        this.stop();
        this.state = 'over';
        this._fire('tick');
        this._fire('expire');
        return;
      }
      this._fire('tick');
    },

    pause() {
      if (this.state !== 'running') return;
      this.stop();
      this.state = 'paused';
      this._fire('pause');
    },

    resume() {
      if (!this.enabled || this.state !== 'paused') return;
      this.start();
    },

    stop() {
      if (this._handle) { clearInterval(this._handle); this._handle = null; }
    },

    /** Bonus (+) or penalty (−) in milliseconds. */
    add(ms, reason = '') {
      if (!this.enabled || this.state === 'over') return;
      this.remainingMs = Math.max(0, this.remainingMs + ms);
      this._fire(ms >= 0 ? 'bonus' : 'penalty', { ms, reason });
      if (this.remainingMs <= 0) {
        this.stop();
        this.state = 'over';
        this._fire('expire');
      }
    },

    /** Seconds actually used (for stats). */
    elapsedSec() {
      return Math.max(0, Math.round((this.totalMs - this.remainingMs) / 1000));
    },

    freeze() {
      this.stop();
      if (this.state === 'running') this.state = 'paused';
      this._fire('freeze');
    },
  };

  /* ========================================================================
     7. GAME — pure state and rules
     ======================================================================== */
  const Game = {
    state: null,
    emitter: createEmitter(),

    start(puzzle, { dateKey, isToday, practice = false, restore = null }) {
      const size = Data.config.gridSize || 3;
      const total = size * size;
      this.state = {
        puzzle,
        dateKey,
        isToday,
        practice,
        cells: new Array(total).fill(null), // { playerId, revealed }
        finished: null,                      // { won, reason }
        wrongCount: 0,
      };

      let remaining = null;
      if (restore && restore.cells) {
        restore.cells.forEach((cell, i) => {
          if (i < total && cell && Data.byId.has(cell.playerId)) {
            this.state.cells[i] = { playerId: cell.playerId, revealed: !!cell.revealed };
          }
        });
        if (restore.wrongCount) this.state.wrongCount = restore.wrongCount;
        if (restore.remainingMs != null) remaining = restore.remainingMs;
        if (restore.finished) this.state.finished = restore.finished;
      }

      Timer.reset(Data.config.timer.seconds, remaining, !practice);

      if (this.state.finished) Timer.freeze();
      if (this.state.finished && this.state.finished.won) {
        this.state.cells.forEach((c, i) => { if (c) this.state.cells[i] = { ...c, revealed: false }; });
      }
      this.emitter.emit('start', this.state);
      return this.state;
    },

    solvedCount() {
      return this.state ? this.state.cells.filter(Boolean).length : 0;
    },

    cellState(index) { return this.state ? this.state.cells[index] : null; },

    playerAt(index) {
      const cell = this.cellState(index);
      return cell ? Data.byId.get(cell.playerId) : null;
    },

    isFinished() { return !!(this.state && this.state.finished); },

    /** All valid answers for a cell (used for reveal + tests). */
    cellAnswers(index) {
      const cell = PuzzleEngine.cells(this.state.puzzle)[index];
      return PuzzleEngine.answersFor(cell.rowCrit, cell.colCrit);
    },

    isPlayerUsed(playerId) {
      return this.state ? this.state.cells.some((c) => c && c.playerId === playerId && !c.revealed) : false;
    },

    /**
     * Submit a guess for a cell.
     * Returns { ok, unknown?, feedback?, won?, reason? }.
     */
    submitGuess(index, player) {
      if (!this.state || this.isFinished()) return { ok: false, reason: 'finished' };
      if (this.state.cells[index]) return { ok: false, reason: 'occupied' };
      if (!player) return { ok: false, unknown: true, reason: 'unknown' };
      if (!Data.config.allowReuse && this.isPlayerUsed(player.id)) {
        return { ok: false, reason: 'reused' };
      }

      const cell = PuzzleEngine.cells(this.state.puzzle)[index];
      const rowOk = Data.matches(player, cell.rowCrit);
      const colOk = Data.matches(player, cell.colCrit);

      if (rowOk && colOk) {
        this.state.cells[index] = { playerId: player.id, revealed: false };
        const bonus = Data.config.timer.correctBonus;
        if (bonus) Timer.add(bonus * 1000, 'correct');
        this._persist();
        this.emitter.emit('correct', { index, player });
        if (this.solvedCount() === this.state.cells.length) this._finish(true, 'solved');
        return { ok: true, solved: true, feedback: 'Correct!' };
      }

      // Wrong: charge the clock and explain which half they missed.
      this.state.wrongCount++;
      Timer.add(-Data.config.timer.wrongPenalty * 1000, 'wrong');
      let feedback = 'Wrong — that player fits neither category.';
      if (rowOk) feedback = `Close — fits “${cell.rowCrit.short || cell.rowCrit.label}” but not “${cell.colCrit.short || cell.colCrit.label}”.`;
      else if (colOk) feedback = `Close — fits “${cell.colCrit.short || cell.colCrit.label}” but not “${cell.rowCrit.short || cell.rowCrit.label}”.`;
      this._persist();
      return { ok: false, rowOk, colOk, feedback };
    },

    /** Give up: reveal one valid answer on every unsolved square. */
    reveal() {
      if (!this.state || this.isFinished()) return;
      this._fillUnsolved();
      this._finish(false, 'revealed');
    },

    reset() {
      if (!this.state) return;
      this.state.cells = this.state.cells.map(() => null);
      this.state.finished = null;
      this.state.wrongCount = 0;
      Timer.reset(Data.config.timer.seconds, null, !this.state.practice);
      Store.clearProgress(this.state.dateKey);
      this.emitter.emit('reset', this.state);
    },

    /** Called by the app when the clock runs out. */
    timeUp() {
      if (!this.state || this.isFinished()) return;
      this._fillUnsolved(); // out of time? the board is shown so you can learn from it
      this._finish(false, 'timeout');
    },

    /** Drop one valid answer into every square that is still empty. */
    _fillUnsolved() {
      const size = Data.config.gridSize || 3;
      for (let i = 0; i < size * size; i++) {
        if (this.state.cells[i]) continue;
        const answers = this.cellAnswers(i);
        if (answers.length) this.state.cells[i] = { playerId: answers[0].id, revealed: true };
      }
    },

    _finish(won, reason) {
      if (this.state.finished) return;
      this.state.finished = { won, reason, solved: this.solvedCount() };
      Timer.freeze();
      this._persist();
      // Only the real daily puzzle feeds the streak — never archive replays
      // or practice boards.
      if (!this.state.practice && this.state.isToday) {
        Stats.recordCompletion({
          won,
          solved: this.solvedCount(),
          secondsUsed: Timer.elapsedSec(),
          dateKey: this.state.dateKey,
        });
      }
      this.emitter.emit('finished', this.state.finished);
    },

    _persist() {
      if (!this.state) return;
      Store.saveProgress(this.state.dateKey, this.snapshot());
    },

    snapshot() {
      if (!this.state) return null;
      return {
        version: APP.version,
        dateKey: this.state.dateKey,
        cells: this.state.cells.map((c) => (c ? { playerId: c.playerId, revealed: c.revealed } : null)),
        wrongCount: this.state.wrongCount,
        remainingMs: Math.round(Timer.remainingMs),
        finished: this.state.finished,
      };
    },
  };

  /* ========================================================================
     8-13 continue below (UI, share, bootstrap)
     ======================================================================== */

  /* ========================================================================
     STATS — streaks, win rate and a "time taken" histogram
     ======================================================================== */
  const Stats = {
    data: null,

    load() { this.data = Store.loadStats(); return this.data; },

    recordCompletion({ won, solved, secondsUsed, dateKey }) {
      const s = this.data;
      if (s.lastDate === dateKey) return s; // never count the same day twice
      s.played++;
      if (won) {
        s.wins++;
        const yesterday = shiftDateKey(dateKey, -1);
        if (s.lastResult === 'win' && s.lastDate === yesterday) s.currentStreak++;
        else s.currentStreak = 1;
        s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
        const bucket = Math.min(5, Math.floor(secondsUsed / 30));
        s.distribution[bucket] = (s.distribution[bucket] || 0) + 1;
        if (s.bestTimeSec == null || secondsUsed < s.bestTimeSec) s.bestTimeSec = secondsUsed;
      } else {
        s.currentStreak = 0;
      }
      s.lastDate = dateKey;
      s.lastResult = won ? 'win' : 'loss';
      Store.saveStats(s);
      emitter.emit('stats:change', s);
      return s;
    },

    displayStreak() { return this.data ? this.data.currentStreak : 0; },

    reset() {
      this.data = {
        played: 0, wins: 0, currentStreak: 0, maxStreak: 0,
        distribution: {}, bestTimeSec: null, lastDate: null, lastResult: null,
      };
      Store.saveStats(this.data);
      emitter.emit('stats:change', this.data);
    },
  };

  /* ========================================================================
     8. UI: TILES — flags, league badges, cricket glyphs and player photos
     ======================================================================== */

  /** Circular initials avatar, used whenever a Commons photo is missing. */
  function fallbackAvatar(name, baseClass) {
    return el('span', { className: `${baseClass} ${baseClass}--fallback`, text: initials(name || '?') });
  }

  /** Build the little icon that sits above a category label. */
  function buildIcon(crit) {
    const icon = crit.icon || { kind: 'glyph', name: 'ball' };
    const wrap = el('span', { className: 'axis__icon' });
    const degraded = () => {
      wrap.innerHTML = '';
      wrap.appendChild(el('span', {
        className: 'axis__badge',
        text: String(crit.short || '?').slice(0, 3).toUpperCase(),
      }));
    };

    if (icon.kind === 'flag') {
      const img = el('img', { className: 'axis__flag', attrs: { src: flagUrl(icon.code), alt: '', loading: 'lazy', decoding: 'async' } });
      img.addEventListener('error', degraded);
      wrap.appendChild(img);
    } else if (icon.kind === 'badge') {
      wrap.appendChild(el('span', {
        className: `axis__badge axis__badge--${icon.tone || 'blue'}`,
        text: icon.text,
      }));
    } else if (icon.kind === 'photo') {
      const ref = Data.coappear[icon.playerId];
      const url = Data.photoOf(icon.playerId);
      if (url) {
        const img = el('img', { className: 'axis__photo', attrs: { src: url, alt: '', loading: 'lazy', decoding: 'async' } });
        img.addEventListener('error', () => img.replaceWith(fallbackAvatar(ref && ref.name, 'axis__photo')));
        wrap.appendChild(img);
      } else {
        wrap.appendChild(fallbackAvatar(ref && ref.name, 'axis__photo'));
      }
    } else if (icon.kind === 'stat') {
      wrap.innerHTML = glyphSvg(icon.glyph || 'ball');
    } else {
      wrap.innerHTML = glyphSvg(icon.name || 'ball');
    }
    return wrap;
  }

  /** Build a full row/column header tile (image on top, label underneath). */
  function buildAxis(crit, orientation) {
    const tile = el('div', {
      className: `axis axis--${orientation}`,
      attrs: {
        role: orientation === 'col' ? 'columnheader' : 'rowheader',
        title: crit.note ? `${crit.label} — ${crit.note}` : crit.label,
      },
    });
    tile.appendChild(buildIcon(crit));

    const text = el('span', { className: 'axis__text' });
    const prefix = crit.icon && crit.icon.prefix;
    const badgeText = crit.icon && crit.icon.kind === 'badge' ? String(crit.icon.text || '') : '';
    const label = crit.short || crit.label;
    // A badge that already spells out the label (BBL, IPL, …) needs no caption.
    const redundant = !!badgeText && badgeText.toLowerCase() === String(label).toLowerCase();
    if (redundant) tile.classList.add('axis--icon-only');
    if (prefix) text.appendChild(el('span', { className: 'axis__prefix', text: prefix }));
    if (!redundant) text.appendChild(el('span', { className: 'axis__label', text: label }));
    tile.appendChild(text);
    return tile;
  }

  /** Compact chip used in the guess panel header. */
  function critChipHtml(crit) {
    const icon = crit.icon || {};
    let inner = '';
    if (icon.kind === 'flag') {
      inner = `<img src="${flagUrl(icon.code)}" alt="" width="18" height="13" style="border-radius:2px;vertical-align:-2px" />`;
    } else if (icon.kind === 'badge') {
      inner = `<span class="axis__badge axis__badge--${icon.tone || 'blue'}" style="font-size:.58rem;padding:1px 6px">${esc(icon.text)}</span>`;
    } else if (icon.kind === 'stat') {
      inner = glyphSvg(icon.glyph || 'ball', 'chip__glyph');
    } else if (icon.kind === 'photo') {
      inner = glyphSvg('star', 'chip__glyph');
    } else {
      inner = glyphSvg(icon.name || 'ball', 'chip__glyph');
    }
    return `<span class="chip">${inner}<span>${esc(icon.prefix ? `${icon.prefix} ${crit.short || crit.label}` : (crit.short || crit.label))}</span></span>`;
  }

  /* ========================================================================
     9. UI: BOARD
     ======================================================================== */
  const Board = {
    els: {},
    puzzle: null,

    cacheDom() {
      this.els = {
        board: $('#board'),
        note: $('#board-note'),
        title: $('#puzzle-title'),
        date: $('#puzzle-date'),
        solved: $('#hud-solved'),
        streak: $('#hud-streak'),
        timer: $('#hud-timer'),
        timerLabel: $('#hud-timer-label'),
        timerItem: $('#hud-timer-item'),
        countdown: $('#hud-countdown'),
        countdownLabel: $('#hud-countdown-label'),
        resetItem: $('#hud-reset-item'),
        progress: $('#progress-bar'),
        archive: $('#archive-note'),
      };
    },

    /** Full (re)build of the grid skeleton — only when the puzzle changes. */
    renderBoard(puzzle) {
      this.puzzle = puzzle;
      const board = this.els.board;
      board.innerHTML = '';
      const corner = el('div', { className: 'axis axis--corner', attrs: { 'aria-hidden': 'true' } });
      corner.appendChild(el('span', { className: 'axis--corner__mark', text: '🏏' }));
      board.appendChild(corner);
      puzzle.cols.forEach((crit) => board.appendChild(buildAxis(crit, 'col')));

      const cells = PuzzleEngine.cells(puzzle);
      for (let r = 0; r < 3; r++) {
        board.appendChild(buildAxis(puzzle.rows[r], 'row'));
        for (let c = 0; c < 3; c++) {
          board.appendChild(this.buildCell(cells[r * 3 + c], puzzle));
        }
      }
      this.renderCells();
    },

    buildCell(cell, puzzle) {
      const node = el('button', {
        className: 'cell',
        attrs: {
          type: 'button',
          role: 'gridcell',
          'data-index': String(cell.index),
          'aria-label': `Row ${cell.row + 1} (${puzzle.rows[cell.row].short}) and column ${cell.col + 1} (${puzzle.cols[cell.col].short})`,
        },
      });
      node.appendChild(el('span', { className: 'cell__plus', text: '＋' }));
      return node;
    },

    /** Repaint every cell from game state. */
    renderCells() {
      $$('.cell', this.els.board).forEach((node) => {
        const index = Number(node.dataset.index);
        const state = Game.cellState(index);
        node.className = 'cell';
        node.innerHTML = '';
        if (!state) {
          node.appendChild(el('span', { className: 'cell__plus', text: '＋' }));
          return;
        }
        const player = Data.byId.get(state.playerId);
        if (!player) {
          node.appendChild(el('span', { className: 'cell__plus', text: '＋' }));
          return;
        }

        node.classList.add('cell--solved');
        node.classList.add(state.revealed ? 'cell--revealed' : 'cell--correct');

        const url = Data.photoOf(player.id);
        if (url) {
          const img = el('img', { className: 'cell__photo', attrs: { src: url, alt: '', loading: 'lazy', decoding: 'async' } });
          img.addEventListener('error', () => img.replaceWith(fallbackAvatar(player.name, 'cell__photo')));
          node.appendChild(img);
        } else {
          node.appendChild(fallbackAvatar(player.name, 'cell__photo'));
        }
        node.appendChild(el('span', { className: 'cell__name', text: player.name }));
        node.appendChild(el('span', { className: 'cell__tag', text: state.revealed ? 'Revealed' : 'Solved' }));
      });
    },

    renderTimer() {
      const st = Timer.status();
      const { timer, timerLabel, timerItem } = this.els;
      if (!timer) return;
      timerItem.classList.remove('is-low', 'is-critical', 'is-paused');

      if (!st.enabled) {
        timer.textContent = '∞';
        timerLabel.textContent = 'Practice';
        return;
      }
      timer.textContent = formatClock(st.remainingMs);
      if (st.state === 'over') {
        timerLabel.textContent = 'Time up';
        timerItem.classList.add('is-critical');
        return;
      }
      if (Game.isFinished()) { // e.g. a restored, already-completed board
        timerLabel.textContent = 'Final';
        timerItem.classList.add('is-paused');
        return;
      }
      if (st.state === 'idle') { timerLabel.textContent = 'Time left'; return; }
      if (st.state === 'paused') {
        timerLabel.textContent = 'Paused';
        timerItem.classList.add('is-paused');
        return;
      }
      timerLabel.textContent = 'Time left';
      if (st.remainingMs <= 30000) timerItem.classList.add('is-critical');
      else if (st.remainingMs <= 60000) timerItem.classList.add('is-low');
    },

    flashTimer(kind) {
      const item = this.els.timerItem;
      if (!item) return;
      const cls = kind === 'bonus' ? 'is-bonus' : 'is-penalty';
      item.classList.remove(cls);
      void item.offsetWidth; // restart the animation
      item.classList.add(cls);
      setTimeout(() => item.classList.remove(cls), 700);
    },

    renderHud() {
      const size = Data.config.gridSize || 3;
      const total = size * size;
      this.els.solved.textContent = `${Game.solvedCount()}/${total}`;
      this.els.streak.textContent = String(Stats.displayStreak());
      this.els.progress.style.width = `${(Game.solvedCount() / total) * 100}%`;
      this.renderTimer();
    },

    renderMeta(state) {
      const { title, date, archive, resetItem } = this.els;
      if (state.practice) title.textContent = 'Practice board';
      else if (!state.isToday) title.textContent = 'Archive puzzle';
      else title.textContent = 'Daily Puzzle';
      date.textContent = prettyDate(state.dateKey);

      resetItem.hidden = Boolean(state.practice || !state.isToday);
      if (!state.isToday && !state.practice) {
        archive.hidden = false;
        archive.textContent = `You're replaying the puzzle from ${prettyDate(state.dateKey)}. Streaks are not affected.`;
      } else {
        archive.hidden = true;
      }
    },

    renderAll() {
      this.renderCells();
      this.renderHud();
    },
  };

  /* ========================================================================
     10. UI: GUESS PANEL
     ======================================================================== */
  const GuessPanel = {
    els: {},
    activeIndex: null,
    suggestions: [],
    cursor: -1,

    cacheDom() {
      this.els = {
        panel: $('#guess-panel'),
        cats: $('#guess-cats'),
        note: $('#guess-note'),
        form: $('#guess-form'),
        input: $('#guess-input'),
        submit: $('#guess-submit'),
        list: $('#guess-suggestions'),
        hint: $('#guess-hint'),
        close: $('#guess-close'),
      };
    },

    open(index) {
      if (!Game.state || Game.isFinished()) return;
      if (Game.cellState(index)) return; // already solved
      this.activeIndex = index;
      Timer.start(); // first interaction starts the clock (no-op afterwards)

      const cell = PuzzleEngine.cells(Game.state.puzzle)[index];
      this.els.cats.innerHTML =
        `${critChipHtml(cell.rowCrit)}<span class="guess-plus">+</span>${critChipHtml(cell.colCrit)}`;
      this.els.note.innerHTML =
        `<span class="crit-note"><b>Row</b> ${esc(cell.rowCrit.label)}${cell.rowCrit.note ? ` — ${esc(cell.rowCrit.note)}` : ''}</span>` +
        `<span class="crit-note"><b>Column</b> ${esc(cell.colCrit.label)}${cell.colCrit.note ? ` — ${esc(cell.colCrit.note)}` : ''}</span>`;
      this.els.hint.textContent = '';
      this.els.input.value = '';
      this.clearSuggestions();
      this.els.panel.hidden = false;
      this.position(index);
      $$('.cell', Board.els.board).forEach((n) => n.classList.remove('cell--active'));
      const node = $(`.cell[data-index="${index}"]`, Board.els.board);
      if (node) node.classList.add('cell--active');
      setTimeout(() => this.els.input.focus({ preventScroll: true }), 30);
    },

    position(index) {
      const node = $(`.cell[data-index="${index}"]`, Board.els.board);
      const panel = this.els.panel;
      if (!node || panel.hidden) return;
      const rect = node.getBoundingClientRect();
      const width = panel.offsetWidth || 340;
      const height = panel.offsetHeight || 180;
      let left = rect.left + rect.width / 2 - width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      let top = rect.bottom + 10;
      if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 10);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    },

    close() {
      this.els.panel.hidden = true;
      this.activeIndex = null;
      this.clearSuggestions();
      $$('.cell', Board.els.board).forEach((n) => n.classList.remove('cell--active'));
    },

    clearSuggestions() {
      this.suggestions = [];
      this.cursor = -1;
      this.els.list.hidden = true;
      this.els.list.innerHTML = '';
      this.els.input.setAttribute('aria-expanded', 'false');
    },

    updateSuggestions() {
      const query = this.els.input.value;
      const results = Data.search(query, 8);
      this.suggestions = results;
      this.cursor = -1;

      if (!query || query.trim().length < 2) { this.clearSuggestions(); return; }
      if (!results.length) {
        this.els.list.innerHTML =
          '<li class="suggestion suggestion--empty" role="option" aria-disabled="true">No matching cricketer in the database</li>';
        this.els.list.hidden = false;
        this.els.input.setAttribute('aria-expanded', 'true');
        return;
      }

      this.els.list.innerHTML = '';
      results.forEach((player, i) => {
        const li = el('li', { className: 'suggestion', attrs: { role: 'option', 'data-i': String(i), id: `sugg-${i}` } });
        const url = Data.photoOf(player.id);
        if (url) {
          const img = el('img', { className: 'suggestion__photo', attrs: { src: url, alt: '', loading: 'lazy' } });
          img.addEventListener('error', () => img.replaceWith(fallbackAvatar(player.name, 'suggestion__photo')));
          li.appendChild(img);
        } else {
          li.appendChild(fallbackAvatar(player.name, 'suggestion__photo'));
        }
        const text = el('span', { className: 'suggestion__text' });
        text.appendChild(el('span', { className: 'suggestion__name', text: player.name }));
        text.appendChild(el('span', {
          className: 'suggestion__meta',
          text: player.country ? `${player.traits.length} qualifying categories` : 'cricketer',
        }));
        li.appendChild(text);
        li.addEventListener('mousedown', (ev) => { ev.preventDefault(); this.submitPlayer(player); });
        this.els.list.appendChild(li);
      });
      this.els.list.hidden = false;
      this.els.input.setAttribute('aria-expanded', 'true');
    },

    moveSuggestion(delta) {
      if (!this.suggestions.length) return;
      this.cursor = (this.cursor + delta + this.suggestions.length) % this.suggestions.length;
      $$('.suggestion', this.els.list).forEach((n, i) => n.classList.toggle('is-active', i === this.cursor));
    },

    handleSubmit() {
      const text = this.els.input.value.trim();
      if (!text) return;
      const player = Data.resolvePlayer(text);
      if (!player) {
        this.els.hint.textContent = `We couldn't find "${text}". Check the spelling, or pick from the list.`;
        this.els.input.classList.add('is-error');
        setTimeout(() => this.els.input.classList.remove('is-error'), 500);
        return; // unknown names never cost time
      }
      this.submitPlayer(player);
    },

    submitPlayer(player) {
      const index = this.activeIndex;
      if (index == null) return;
      const result = Game.submitGuess(index, player);

      if (result.unknown) { this.els.hint.textContent = 'Unknown cricketer.'; return; }
      if (result.reason === 'reused') {
        this.els.hint.textContent = 'That player is already on the board — pick someone else.';
        return;
      }
      if (result.ok) {
        Modals.toast(`${player.name} ✓  +${Data.config.timer.correctBonus}s`, 'good');
        Board.flashTimer('bonus');
        this.close();
        Board.renderAll();
        if (Game.isFinished()) Modals.showResult();
        return;
      }

      // Wrong: charge the clock, shake the cell, explain the miss.
      Modals.toast(`−${Data.config.timer.wrongPenalty}s`, 'bad');
      Board.flashTimer('penalty');
      const node = $(`.cell[data-index="${index}"]`, Board.els.board);
      if (node) {
        node.classList.add('cell--wrong', 'cell--partial');
        setTimeout(() => node.classList.remove('cell--wrong', 'cell--partial'), 600);
      }
      this.els.hint.textContent = result.feedback || 'Not quite.';
      this.els.input.value = '';
      this.updateSuggestions();
      Board.renderAll();
      if (Timer.state === 'over') { Game.timeUp(); Board.renderAll(); Modals.showResult(); }
    },
  };

  /* ========================================================================
     11. UI: MODALS + TOASTS
     ======================================================================== */
  const Modals = {
    els: {},
    openStack: [],
    _toastHandle: null,

    cacheDom() {
      this.els = {
        overlay: $('#overlay'),
        toast: $('#toast'),
        resultTitle: $('#result-title'),
        resultBlurb: $('#result-blurb'),
        resultGrid: $('#result-grid'),
        resultMeta: $('#result-meta'),
        resultReveal: $('#result-reveal'),
        statsGrid: $('#stats-grid'),
        statsDist: $('#stats-dist'),
        statsSaved: $('#stats-saved'),
      };
    },

    open(id) {
      const node = document.getElementById(id);
      if (!node) return;
      this.els.overlay.hidden = false;
      node.hidden = false;
      if (this.openStack.includes(id)) return; // already open — don't stack it twice
      this.openStack.push(id);
    },

    close(id = null) {
      const targetId = id || this.openStack[this.openStack.length - 1];
      if (targetId) {
        const node = document.getElementById(targetId);
        if (node) node.hidden = true;
        this.openStack = this.openStack.filter((x) => x !== targetId);
      }
      if (!this.openStack.length) this.els.overlay.hidden = true;
    },

    closeAll() { [...this.openStack].forEach((id) => this.close(id)); },
    isOpen() { return this.openStack.length > 0; },

    toast(message, tone = 'info') {
      const node = this.els.toast;
      if (!node) return;
      node.textContent = message;
      node.className = `toast toast--${tone}`;
      node.hidden = false;
      clearTimeout(this._toastHandle);
      this._toastHandle = setTimeout(() => { node.hidden = true; }, 1800);
    },

    showResult() {
      const state = Game.state;
      if (!state || !state.finished) return;
      const { won, reason, solved } = state.finished;
      const size = Data.config.gridSize || 3;
      const total = size * size;
      const secondsUsed = Timer.enabled ? Timer.elapsedSec() : null;

      this.els.resultTitle.textContent = won
        ? 'Puzzle complete'
        : (reason === 'timeout' ? "Time's up" : 'Board revealed');
      this.els.resultBlurb.textContent = won
        ? `You filled all ${total} squares in ${formatClock((secondsUsed || 0) * 1000)}.`
        : `You solved ${solved} of ${total} squares. A fresh grid lands at midnight.`;
      this.els.resultGrid.textContent = Share.buildEmojiGrid();
      this.els.resultMeta.textContent = won
        ? `Streak: ${Stats.displayStreak()} 🔥`
        : 'Streak reset. Back tomorrow for a new grid.';

      const rows = PuzzleEngine.cells(state.puzzle).map((cell) => {
        const st = Game.cellState(cell.index);
        const player = st ? Data.byId.get(st.playerId) : null;
        return `${cell.index + 1}. ${player ? player.name : '—'}`;
      });
      this.els.resultReveal.textContent = `Answers — ${rows.join('   ·   ')}`;
      this.open('modal-result');
    },

    renderStats() {
      const s = Stats.data;
      const winPct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
      const cells = [
        ['Played', s.played],
        ['Win rate', `${winPct}%`],
        ['Current streak', s.currentStreak],
        ['Max streak', s.maxStreak],
        ['Best time', s.bestTimeSec != null ? formatClock(s.bestTimeSec * 1000) : '—'],
        ['Wins', s.wins],
      ];
      this.els.statsGrid.innerHTML = cells
        .map(([label, value]) =>
          `<div class="stat"><b>${esc(String(value))}</b><span>${esc(label)}</span></div>`)
        .join('');

      const max = Math.max(1, ...Object.values(s.distribution || {}));
      const labels = ['0–30s', '30–60s', '60–90s', '90–120s', '120–150s', '150s+'];
      this.els.statsDist.innerHTML = labels.map((label, i) => {
        const count = (s.distribution || {})[String(i)] || 0;
        const pct = Math.round((count / max) * 100);
        return `<li><span class="dist__row">${esc(label)}</span>` +
          `<span class="dist__bar"><span class="dist__fill" style="width:${count ? Math.max(6, pct) : 0}%"></span></span>` +
          `<span class="dist__count">${count}</span></li>`;
      }).join('');
      this.els.statsSaved.textContent = 'Stats are stored only in this browser.';
    },
  };

  /* ========================================================================
     12. SHARE
     ======================================================================== */
  const Share = {
    buildEmojiGrid() {
      const size = Data.config.gridSize || 3;
      const lines = [];
      for (let r = 0; r < size; r++) {
        let line = '';
        for (let c = 0; c < size; c++) {
          const st = Game.cellState(r * size + c);
          line += !st ? EMOJI.empty : (st.revealed ? EMOJI.revealed : EMOJI.correct);
        }
        lines.push(line);
      }
      return lines.join('\n');
    },

    /** Where a shared result points: an explicit URL, else the live page. */
    link() {
      if (APP.shareUrl) return APP.shareUrl;
      try {
        return window.location.origin + window.location.pathname;
      } catch {
        return '';
      }
    },

    buildText() {
      const state = Game.state;
      const { won, solved } = state.finished || { won: false, solved: Game.solvedCount() };
      const size = Data.config.gridSize || 3;
      const total = size * size;
      const secondsUsed = Timer.enabled ? Timer.elapsedSec() : null;
      const score = won ? formatClock((secondsUsed || 0) * 1000) : `${solved}/${total}`;
      return [
        `CricToe ${state.dateKey} ${won ? '🏆' : '⏱️'} ${score}`,
        this.buildEmojiGrid(),
        this.link(),
      ].filter(Boolean).join('\n');
    },

    async copy() {
      const text = this.buildText();
      try {
        await navigator.clipboard.writeText(text);
        Modals.toast('Result copied to clipboard', 'good');
      } catch {
        window.prompt('Copy your result:', text); // clipboard blocked (http/file:)
      }
    },
  };

  /* ========================================================================
     13. APP — bootstrap, query params, wiring
     ======================================================================== */
  const App = {
    prefs: null,
    countdownHandle: null,

    readParams() {
      const params = new URLSearchParams(location.search);
      const dateParam = params.get('date');
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam : toDateKey();
      const isToday = dateKey === toDateKey();
      const practice = params.get('practice') === '1' || !!this.prefs.practice;
      return { dateKey, isToday, practice };
    },

    launch({ dateKey, isToday, practice }) {
      const puzzle = PuzzleEngine.forDateKey(dateKey);
      const restore = Store.loadProgress(dateKey);
      Game.start(puzzle, { dateKey, isToday, practice, restore });
      Board.renderBoard(puzzle);
      Board.renderMeta(Game.state);
      Board.renderAll();
      emitter.emit('puzzle:ready', { puzzle, state: Game.state });
    },

    reload() { this.launch(this.readParams()); },

    togglePractice() {
      const on = !this.prefs.practice;
      this.prefs.practice = on;
      Store.savePrefs(this.prefs);
      const btn = $('#btn-practice');
      if (btn) { btn.classList.toggle('is-active', on); btn.setAttribute('aria-pressed', String(on)); }
      GuessPanel.close();
      this.reload();
      Modals.toast(on ? 'Practice mode — no timer, no streak' : 'Practice mode off', 'info');
    },

    resetGame() {
      GuessPanel.close();
      Game.reset();
      Board.renderAll();
      Modals.toast('Board reset', 'info');
    },

    giveUp() {
      GuessPanel.close();
      Game.reveal();
      Board.renderAll();
      Modals.showResult();
    },

    startCountdown() {
      const tick = () => {
        const node = Board.els.countdown;
        if (node) node.textContent = formatCountdown(msToNextMidnight());
      };
      tick();
      clearInterval(this.countdownHandle);
      this.countdownHandle = setInterval(tick, 1000);
    },

    bindStaticUi() {
      $('#btn-help').addEventListener('click', () => Modals.open('modal-help'));
      $('#btn-help-footer').addEventListener('click', () => Modals.open('modal-help'));
      $('#btn-stats').addEventListener('click', () => { Modals.renderStats(); Modals.open('modal-stats'); });
      $('#btn-practice').addEventListener('click', () => this.togglePractice());
      $('#overlay').addEventListener('click', () => Modals.closeAll());
      $$('[data-close-modal]').forEach((btn) =>
        btn.addEventListener('click', () => Modals.close(btn.closest('.modal').id)));

      $('#btn-share').addEventListener('click', () => Share.copy());
      $('#btn-copy-share').addEventListener('click', () => Share.copy());
      $('#btn-reset').addEventListener('click', () => this.resetGame());
      $('#btn-reveal').addEventListener('click', () => this.giveUp());
      $('#btn-clear-stats').addEventListener('click', () => {
        Stats.reset();
        Modals.renderStats();
        Modals.toast('Saved data cleared', 'info');
      });

      GuessPanel.els.close.addEventListener('click', () => GuessPanel.close());
      GuessPanel.els.form.addEventListener('submit', (ev) => { ev.preventDefault(); GuessPanel.handleSubmit(); });
      GuessPanel.els.input.addEventListener('input', () => GuessPanel.updateSuggestions());
      GuessPanel.els.input.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); GuessPanel.moveSuggestion(1); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); GuessPanel.moveSuggestion(-1); }
        else if (ev.key === 'Enter' && GuessPanel.cursor >= 0 && GuessPanel.suggestions[GuessPanel.cursor]) {
          ev.preventDefault();
          GuessPanel.submitPlayer(GuessPanel.suggestions[GuessPanel.cursor]);
        } else if (ev.key === 'Escape') { GuessPanel.close(); }
      });

      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { GuessPanel.close(); Modals.closeAll(); }
      });
    },

    bindEvents() {
      Board.els.board.addEventListener('click', (ev) => {
        const cell = ev.target.closest('.cell');
        if (!cell) return;
        GuessPanel.open(Number(cell.dataset.index));
      });

      Timer.on('expire', () => {
        Game.timeUp();
        GuessPanel.close();
        Board.renderAll();
        Modals.showResult();
      });
      Timer.on('tick', () => Board.renderTimer());
      Timer.on('change', () => Board.renderTimer());
      Timer.on('bonus', () => Board.flashTimer('bonus'));
      Timer.on('penalty', () => Board.flashTimer('penalty'));

      Game.emitter.on('finished', () => {
        Board.renderAll();
        if (!Modals.isOpen()) Modals.showResult();
      });
      emitter.on('stats:change', () => {
        if (Board.els.streak) Board.els.streak.textContent = String(Stats.displayStreak());
      });

      // Never lose time while the tab is in the background.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) Timer.pause();
      });

      window.addEventListener('resize', () => {
        if (GuessPanel.activeIndex != null) GuessPanel.position(GuessPanel.activeIndex);
      });
    },

    showLoadError(err) {
      console.error(err);
      const board = $('#board');
      if (!board) return;
      board.innerHTML =
        '<div style="grid-column:1/-1;padding:24px;text-align:center;line-height:1.6">' +
        '<strong>Could not load the player data.</strong><br>' +
        'If you opened this file directly (<code>file://</code>), the browser blocks ' +
        '<code>players.json</code> for security reasons.<br>' +
        'Serve the folder over HTTP instead — e.g. <code>python -m http.server 8000</code> — ' +
        'then visit <code>http://localhost:8000</code>.</div>';
      const note = $('#board-note');
      if (note) note.textContent = 'Load failed.';
    },

    async boot() {
      Board.cacheDom();
      GuessPanel.cacheDom();
      Modals.cacheDom();
      Stats.load();
      this.prefs = Store.loadPrefs();
      this.applyTheme();
      this.applyHelpConfig();
      this.bindStaticUi();
      this.startCountdown();

      try {
        await Data.load();
        PuzzleEngine.init();
        this.applyHelpConfig(); // now reflect the timer set in players.json
        this.bindEvents();

        const btn = $('#btn-practice');
        if (btn) {
          btn.classList.toggle('is-active', !!this.prefs.practice);
          btn.setAttribute('aria-pressed', String(!!this.prefs.practice));
        }

        this.launch(this.readParams());
        if (!this.prefs.seenHelp) {
          this.prefs.seenHelp = true;
          Store.savePrefs(this.prefs);
          Modals.open('modal-help');
        }
      } catch (err) {
        this.showLoadError(err);
      }
    },

    /** ?theme=purple switches to the alternate palette. URL-only, no storage. */
    applyTheme() {
      try {
        const theme = new URLSearchParams(window.location.search).get('theme');
        if (theme) document.documentElement.dataset.theme = theme;
      } catch { /* malformed query string — keep the default */ }
    },

    applyHelpConfig() {
      const seconds = (Data.loaded ? Data.config.timer.seconds : DEFAULT_CONFIG.timer.seconds);
      const node = $('#help-seconds');
      if (node) node.textContent = formatClock(seconds * 1000);
    },
  };

  /* ========================================================================
     PUBLIC API — window.CricToe (tests, extensions, debugging)
     ======================================================================== */
  window.CricToe = {
    version: APP.version,
    APP,
    Data,
    Game,
    Timer,
    Stats,
    PuzzleEngine,
    Store,
    UI: { Board, GuessPanel, Modals, Share, App },
    on: (event, cb) => emitter.on(event, cb),
    emit: (event, payload) => emitter.emit(event, payload),
    /** Point the share text at your deployed URL. */
    setShareUrl(url) { APP.shareUrl = url; },
    /** Rebuild the board for a date without a page reload (tests + archives). */
    loadDate(dateKey) { App.launch({ dateKey, isToday: dateKey === toDateKey(), practice: false }); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.boot());
  } else {
    App.boot();
  }
})();
