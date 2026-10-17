/**
 * CricToe data pipeline — stage 6 (final)
 * ---------------------------------------------------------------
 * Merges every cached source into the three files the web app ships:
 *
 *   players.json    the dataset + the criterion catalogue + config
 *   photos.json     playerId -> Commons photo URL   (lazy loaded)
 *   coappear.json   playerId -> teammate ids        (lazy loaded)
 *
 *   node build/build-data.mjs
 *
 * Sources merged:
 *   Wikipedia infoboxes   (stats, roles, handedness, clubs -> leagues)
 *   Wikipedia categories  (captains, commentators, World Cup winners)
 *   Wikidata              (Commons photos)
 *   Cricsheet             (real league appearances, ICC/Asia Cup honours,
 *                          co-appearance graph)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const ROOT = path.join(HERE, '..');

const read = (f) => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));

/* ------------------------------------------------------------------ *
 * Country presentation
 * ------------------------------------------------------------------ */
const COUNTRIES = [
  { trait: 'india', label: 'India', code: 'in' },
  { trait: 'pakistan', label: 'Pakistan', code: 'pk' },
  { trait: 'australia', label: 'Australia', code: 'au' },
  { trait: 'england', label: 'England', code: 'gb-eng' },
  { trait: 'southafrica', label: 'South Africa', code: 'za' },
  { trait: 'newzealand', label: 'New Zealand', code: 'nz' },
  { trait: 'srilanka', label: 'Sri Lanka', code: 'lk' },
  { trait: 'westindies', label: 'West Indies', code: null }, // no national flag exists
  { trait: 'bangladesh', label: 'Bangladesh', code: 'bd' },
  { trait: 'afghanistan', label: 'Afghanistan', code: 'af' },
  { trait: 'zimbabwe', label: 'Zimbabwe', code: 'zw' },
  { trait: 'ireland', label: 'Ireland', code: 'ie' },
];

/* Traits that become criteria, with presentation metadata.
   `short` is what appears on the tile, `note` explains the rule in plain
   English inside the guess panel, and `icon` drives the tile artwork. */
const TRAIT_CRITERIA = [
  // format
  { trait: 'test_cricketer', group: 'format', label: 'Played Test cricket', short: 'Test cricket', glyph: 'cap',
    note: 'Has appeared in at least one Test match.' },
  { trait: 'odi_cricketer', group: 'format', label: 'Played ODI cricket', short: 'ODI cricket', glyph: 'ball',
    note: 'Has appeared in at least one One Day International.' },
  { trait: 't20i_cricketer', group: 'format', label: 'Played T20 internationals', short: 'T20I cricket', glyph: 'bolt',
    note: 'Has appeared in at least one T20 international.' },
  // role
  { trait: 'opener', group: 'role', label: 'Opening batter', short: 'Opener', glyph: 'bat',
    note: 'Bats at the top of the order.' },
  { trait: 'allrounder', group: 'role', label: 'All-rounder', short: 'All-rounder', glyph: 'allround',
    note: 'Contributes with both bat and ball.' },
  { trait: 'wicketkeeper', group: 'role', label: 'Wicket-keeper', short: 'Wicket-keeper', glyph: 'gloves',
    note: 'Keeps wicket for their side.' },
  // style
  { trait: 'lefthand', group: 'style', label: 'Left-handed batter', short: 'Left-hander', glyph: 'hand',
    note: 'Bats left-handed.' },
  { trait: 'spinner', group: 'style', label: 'Spin bowler', short: 'Spinner', glyph: 'spin',
    note: 'Bowls spin as their main style.' },
  { trait: 'pacer', group: 'style', label: 'Pace bowler', short: 'Pacer', glyph: 'speed',
    note: 'Bowls pace as their main style.' },
  // league
  { trait: 'ipl', group: 'league', label: 'Played in the IPL', short: 'IPL', badge: 'IPL', tone: 'blue',
    note: 'Has played at least one Indian Premier League match.' },
  { trait: 'psl', group: 'league', label: 'Played in the PSL', short: 'PSL', badge: 'PSL', tone: 'green',
    note: 'Has played at least one Pakistan Super League match.' },
  { trait: 'bbl', group: 'league', label: 'Played in the Big Bash', short: 'BBL', badge: 'BBL', tone: 'cyan',
    note: 'Has played at least one Big Bash League match.' },
  { trait: 'cpl', group: 'league', label: 'Played in the CPL', short: 'CPL', badge: 'CPL', tone: 'purple',
    note: 'Has played at least one Caribbean Premier League match.' },
  { trait: 'thehundred', group: 'league', label: 'Played in The Hundred', short: 'Hundred', badge: '100', tone: 'pink',
    note: 'Has played at least one match in The Hundred.' },
  { trait: 'ilt20', group: 'league', label: 'Played in ILT20', short: 'ILT20', badge: 'ILT20', tone: 'orange',
    note: 'Has played at least one International League T20 match.' },
  { trait: 'sat20', group: 'league', label: 'Played in SA20', short: 'SA20', badge: 'SA20', tone: 'teal',
    note: 'Has played at least one SA20 match.' },
  // honour
  { trait: 'worldcup', group: 'honour', label: 'Won the ODI World Cup', short: 'ODI World Cup', glyph: 'trophy',
    note: 'Was in a 50-over World Cup-winning squad.' },
  { trait: 't20worldcup', group: 'honour', label: 'Won the T20 World Cup', short: 'T20 World Cup', glyph: 'trophy',
    note: 'Was in a T20 World Cup-winning squad.' },
  { trait: 'champions_trophy', group: 'honour', label: 'Won the Champions Trophy', short: 'Champions Trophy', glyph: 'trophy',
    note: 'Was in a Champions Trophy-winning squad.' },
  { trait: 'asia_cup', group: 'honour', label: 'Won the Asia Cup', short: 'Asia Cup', glyph: 'trophy',
    note: 'Was in an Asia Cup-winning squad.' },
  { trait: 'wtc_final', group: 'honour', label: 'Won the World Test Championship', short: 'WTC', glyph: 'trophy',
    note: "Was in the winning side of a World Test Championship final." },
  // other
  { trait: 'captain', group: 'misc', label: 'Captained their country', short: 'Captain', glyph: 'star',
    note: 'Has captained their national team.' },
  { trait: 'commentator', group: 'misc', label: 'Now a commentator', short: 'Commentator', glyph: 'mic',
    note: 'Now works as a cricket commentator.' },
];

/* Round, human-readable stat thresholds. Anything too rare is dropped. */
const STAT_THRESHOLDS = {
  caps: [50, 100, 150, 200, 250, 300, 400],
  test_c: [5, 10, 15, 20, 25, 30, 40],
  odi_c: [5, 10, 15, 20, 25, 30, 40],
  t20i_c: [1, 2, 3, 5],
  test_w: [50, 100, 150, 200, 250, 300, 400, 500, 600, 700],
  odi_w: [50, 100, 150, 200, 250, 300, 400],
  t20i_w: [25, 50, 75, 100],
  test_r: [2000, 3000, 5000, 8000, 10000, 12000],
  odi_r: [2000, 3000, 5000, 8000, 10000, 12000],
  t20i_r: [500, 1000, 1500, 2000, 3000],
  test_5w: [3, 5, 10, 15, 20, 25, 30],
};
const STAT_META = {
  caps: { label: 'international caps', glyph: 'cap' },
  test_c: { label: 'Test centuries', glyph: 'bat' },
  odi_c: { label: 'ODI centuries', glyph: 'bat' },
  t20i_c: { label: 'T20I centuries', glyph: 'bat' },
  test_w: { label: 'Test wickets', glyph: 'ball' },
  odi_w: { label: 'ODI wickets', glyph: 'ball' },
  t20i_w: { label: 'T20I wickets', glyph: 'ball' },
  test_r: { label: 'Test runs', glyph: 'bat' },
  odi_r: { label: 'ODI runs', glyph: 'bat' },
  t20i_r: { label: 'T20I runs', glyph: 'bat' },
  test_5w: { label: 'five-wicket hauls', glyph: 'ball' },
};
/* Only keep a stat criterion if enough players qualify for a fair cell. */
const MIN_STAT_ANSWERS = 12;
const MAX_STAT_ANSWERS = 600;
/* A player_ref criterion needs a healthy answer pool to stay solvable. */
const MIN_REF_ANSWERS = 10;

/* ------------------------------------------------------------------ */

function main() {
  const parsed = read('players-parsed.json');
  const wikidata = read('wikidata.json');
  const categoryTraits = read('category-traits.json');
  const leagues = read('cricsheet-leagues.json');
  const honours = read('cricsheet-honours.json');
  const coappear = read('cricsheet-coappear.json');

  const playerById = new Map(parsed.map((p) => [p.id, p]));

  /* ---- 1. player records ---------------------------------------- */
  const players = parsed.map((p) => {
    const traits = new Set(p.traits);

    // Leagues: infobox club lists ∪ actual Cricsheet appearances.
    for (const [trait, ids] of Object.entries(leagues)) {
      if (ids.includes(p.id)) traits.add(trait);
    }

    // Honours: Wikipedia World-Cup squads ∪ Cricsheet winners' XIs.
    const wikiTitles = new Set([p.title]);
    for (const [trait, ids] of Object.entries(honours)) {
      if (ids.includes(p.id)) traits.add(trait);
    }
    // World Cup winners straight from the category stage (title keyed).
    for (const [trait, titles] of Object.entries(categoryTraits.honours)) {
      if (titles.some((t) => wikiTitles.has(t))) traits.add(trait);
    }

    // Category-derived "other" traits.
    if (categoryTraits.captain.includes(p.title)) traits.add('captain');
    if (categoryTraits.commentator.includes(p.title)) traits.add('commentator');

    // Derived: any ICC senior trophy.
    if (traits.has('worldcup') || traits.has('t20worldcup') || traits.has('champions_trophy')) {
      traits.add('icc_trophy');
    }

    const wd = wikidata[p.title] || {};
    return {
      id: p.id,
      name: p.name,
      country: p.traits.find((t) => COUNTRIES.some((c) => c.trait === t)) || null,
      traits: [...traits].sort(),
      stats: p.stats,
      aliases: p.aliases,
      photo: wd.image || null,
    };
  });

  /* ---- 2. criterion catalogue ----------------------------------- */
  const criteria = [];

  for (const c of COUNTRIES) {
    criteria.push({
      id: c.trait,
      type: 'trait',
      trait: c.trait,
      group: 'country',
      label: c.label,
      short: c.label,
      note: `Played international cricket for ${c.label}.`,
      icon: c.code ? { kind: 'flag', code: c.code } : { kind: 'badge', text: 'WI', tone: 'maroon' },
    });
  }

  for (const t of TRAIT_CRITERIA) {
    const count = players.filter((p) => p.traits.includes(t.trait)).length;
    if (count < MIN_STAT_ANSWERS) continue;
    criteria.push({
      id: t.trait,
      type: 'trait',
      trait: t.trait,
      group: t.group,
      label: t.label,
      short: t.short,
      note: t.note,
      icon: t.badge
        ? { kind: 'badge', text: t.badge, tone: t.tone }
        : { kind: 'glyph', name: t.glyph },
    });
  }

  for (const [stat, thresholds] of Object.entries(STAT_THRESHOLDS)) {
    const values = players.map((p) => p.stats[stat]).filter((v) => v != null);
    for (const min of thresholds) {
      const count = values.filter((v) => v >= min).length;
      if (count < MIN_STAT_ANSWERS || count > MAX_STAT_ANSWERS) continue;
      const meta = STAT_META[stat];
      criteria.push({
        id: `${stat}_${min}`,
        type: 'stat',
        stat,
        min,
        group: 'stat',
        label: `${min}+ ${meta.label}`,
        short: `${min}+ ${meta.label.split(' ').pop()}`,
        note: `Has ${min} or more ${meta.label}.`,
        icon: { kind: 'stat', text: String(min), glyph: meta.glyph },
      });
    }
  }

  for (const [playerId, ref] of Object.entries(coappear)) {
    if (ref.teammates.length < MIN_REF_ANSWERS) continue;
    // The tile shows a photo + a "PLAYED WITH" caption + the name, so there is
    // no room for misreading it as "captained by" or "played against".
    criteria.push({
      id: `ref_${playerId}`,
      type: 'player_ref',
      playerId,
      group: 'teammate',
      label: `Was a teammate of ${ref.name}`,
      short: ref.name,
      note: `Any cricketer who has appeared in the same XI as ${ref.name} — for their country ` +
        `or as a franchise teammate in a league we cover. Playing against them does not count.`,
      icon: { kind: 'photo', playerId, prefix: 'Played with' },
    });
  }

  /* ---- 3. solve-every-cell sanity check ------------------------- */
  // (the app re-checks, but catching an unsolvable catalogue here is cheaper)
  const bad = [];
  for (const c of criteria) {
    const n = criteriaAnswersCount(c, players, coappear);
    if (n < 2) bad.push(`${c.id} (${n})`);
  }

  /* ---- 4. output ------------------------------------------------- */
  const payload = {
    epoch: '2024-01-01',
    generated: new Date().toISOString().slice(0, 10),
    config: {
      gridSize: 3,
      totalGuesses: 9,
      allowReuse: true,
      minAnswersPerCell: 2,
      timer: { seconds: 180, wrongPenalty: 15, correctBonus: 10 },
    },
    attributions: [
      { name: 'Wikipedia', licence: 'CC BY-SA 4.0', url: 'https://en.wikipedia.org' },
      { name: 'Wikidata', licence: 'CC0', url: 'https://www.wikidata.org' },
      { name: 'Cricsheet', licence: 'ODC-By 1.0 / CC BY 4.0', url: 'https://cricsheet.org' },
      { name: 'Wikimedia Commons', licence: 'per-file', url: 'https://commons.wikimedia.org' },
    ],
    criteria,
    players: players.map(({ id, name, country, traits, stats, aliases }) => ({ id, name, country, traits, stats, aliases })),
  };

  fs.writeFileSync(path.join(ROOT, 'players.json'), JSON.stringify(payload));

  const photos = {};
  for (const p of players) if (p.photo) photos[p.id] = p.photo;
  fs.writeFileSync(path.join(ROOT, 'photos.json'), JSON.stringify(photos));

  const coappearOut = {};
  for (const [id, ref] of Object.entries(coappear)) {
    if (ref.teammates.length < MIN_REF_ANSWERS) continue;
    coappearOut[id] = { name: ref.name, teammates: ref.teammates };
  }
  fs.writeFileSync(path.join(ROOT, 'coappear.json'), JSON.stringify(coappearOut));

  /* ---- diagnostics ----------------------------------------------- */
  const byGroup = {};
  for (const c of criteria) byGroup[c.group] = (byGroup[c.group] || 0) + 1;
  console.log(`players            : ${players.length}`);
  console.log(`criteria           : ${criteria.length}`);
  console.log('criteria per group :');
  for (const [g, n] of Object.entries(byGroup).sort()) console.log(`  ${g.padEnd(10)} ${n}`);
  console.log(`photos             : ${Object.keys(photos).length}`);
  console.log(`coappear refs      : ${Object.keys(coappearOut).length}`);
  console.log(`unsolvable criteria: ${bad.length ? bad.join(', ') : 'none'}`);
  const size = (f) => `${(fs.statSync(path.join(ROOT, f)).size / 1048576).toFixed(2)} MB`;
  console.log(`\nplayers.json ${size('players.json')} | photos.json ${size('photos.json')} | coappear.json ${size('coappear.json')}`);
}

/** How many players satisfy a criterion (mirrors the app's logic). */
function criteriaAnswersCount(c, players, coappear) {
  if (c.type === 'trait') return players.filter((p) => p.traits.includes(c.trait)).length;
  if (c.type === 'stat') return players.filter((p) => (p.stats[c.stat] || -1) >= c.min).length;
  if (c.type === 'player_ref') {
    const known = new Set(players.map((p) => p.id));
    const ref = coappear[c.playerId];
    return ((ref && ref.teammates) || []).filter((id) => known.has(id)).length;
  }
  return 0;
}

main();
