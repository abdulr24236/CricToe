/**
 * CricToe data pipeline — stage 2
 * ---------------------------------------------------------------
 * Parses the cached wikitext into structured player records:
 *   node build/parse-wikitext.mjs
 *
 * Handles both {{Infobox cricketer}} layouts used on Wikipedia:
 *   • column style : |column1=[[Test cricket|Test]] |matches1= |100s/50s1= |fivefor1=
 *   • legacy style : |testmatches= |testruns= |test100s= |testfivefor=
 *
 * Output: build/cache/players-parsed.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const WIKITEXT_DIR = path.join(CACHE, 'wikitext');

/* ================================================================== *
 * 1. Wikitext primitives
 * ================================================================== */

/** Finds `{{<name> ...}}` and returns the template body (nesting-aware). */
function extractTemplate(text, templateName) {
  const needle = new RegExp(`\\{\\{\\s*${templateName}`, 'i');
  const m = needle.exec(text);
  if (!m) return null;
  let i = m.index + 2; // just past "{{"
  let depth = 1;
  for (; i < text.length; i++) {
    if (text.startsWith('{{', i)) { depth++; i++; continue; }
    if (text.startsWith('}}', i)) { depth--; if (depth === 0) return text.slice(m.index + 2, i); i++; continue; }
  }
  return null;
}

/**
 * Splits template body on top-level `|` — ignoring pipes inside
 * [[wiki links]], {{nested templates}} and <ref> tags.
 */
function splitParams(body) {
  const params = {};
  let key = null;
  let value = '';
  let link = 0;   // [[ ]] depth
  let tpl = 0;    // {{ }} depth
  let ref = 0;    // <ref> depth

  const push = () => { if (key != null) params[key.trim().toLowerCase()] = value.trim(); };

  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    const four = body.slice(i, i + 4).toLowerCase();

    if (two === '[[') { link++; value += two; i++; continue; }
    if (two === ']]') { link--; value += two; i++; continue; }
    if (two === '{{') { tpl++; value += two; i++; continue; }
    if (two === '}}') { tpl--; value += two; i++; continue; }
    if (four === '<ref') { ref++; value += '<ref'; i += 3; continue; }
    if (body.slice(i, i + 6).toLowerCase() === '</ref>') { ref--; value += '</ref>'; i += 5; continue; }

    const c = body[i];
    if (c === '|' && link === 0 && tpl === 0 && ref === 0) { push(); key = null; value = ''; continue; }
    if (c === '=' && key === null && link === 0 && tpl === 0) { key = value; value = ''; continue; }
    value += c;
  }
  push();
  return params;
}

/** Strips wiki markup and HTML to plain text. */
function plain(value) {
  if (value == null) return '';
  return String(value)
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<[^>]*>/g, ' ')                  // any remaining HTML (e.g. <br>)
    .replace(/\{\{[^{}]*\}\}/g, '')            // simple templates
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[target|label]]
    .replace(/\[\[([^\]]+)\]\]/g, '$1')        // [[target]]
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses "1,234" / "30/31" / "–" / "12.5" into a number (or null). */
function num(value) {
  const s = plain(value).replace(/,/g, '').trim();
  if (!s || s === '–' || s === '-' || s === '—' || s === 'n/a') return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/* ================================================================== *
 * 2. Traits
 * ================================================================== */

/** Franchise/team name → league trait. Matched case-insensitively. */
const LEAGUE_TEAMS = {
  ipl: ['mumbai indians', 'chennai super kings', 'royal challengers', 'kolkata knight riders',
    'delhi capitals', 'delhi daredevils', 'rajasthan royals', 'punjab kings', 'kings xi punjab',
    'sunrisers hyderabad', 'deccan chargers', 'gujarat titans', 'lucknow super giants',
    'gujarat lions', 'rising pune supergiant', 'pune warriors', 'kochi tuskers kerala'],
  psl: ['karachi kings', 'lahore qalandars', 'peshawar zalmi', 'islamabad united',
    'quetta gladiators', 'multan sultans'],
  bbl: ['sydney sixers', 'sydney thunder', 'melbourne stars', 'melbourne renegades',
    'perth scorchers', 'adelaide strikers', 'brisbane heat', 'hobart hurricanes'],
  cpl: ['trinbago knight riders', 'barbados royals', 'barbados tridents', 'guyana amazon warriors',
    'jamaica tallawahs', 'st kitts and nevis patriots', 'st lucia kings', 'saint lucia kings',
    'st lucia zouks', 'antigua hawksbills'],
  thehundred: ['london spirit', 'oval invincibles', 'manchester originals', 'birmingham phoenix',
    'trent rockets', 'southern brave', 'welsh fire', 'northern superchargers'],
  ilt20: ['mi emirates', 'gulf giants', 'desert vipers', 'abu dhabi knight riders',
    'sharjah warriors', 'dubai capitals'],
  sat20: ['joburg super kings', 'durban\u2019s super giants', 'durbans super giants', 'mi cape town',
    'paarl royals', 'pretoria capitals', 'sunrisers eastern cape'],
};

/** League traits a player's club list implies. */
function leaguesFromClubs(clubs) {
  const found = new Set();
  const haystack = clubs.map((c) => c.toLowerCase()).join(' | ');
  for (const [league, teams] of Object.entries(LEAGUE_TEAMS)) {
    if (teams.some((t) => haystack.includes(t))) found.add(league);
  }
  return [...found];
}

/** Bowling-type trait from the free-text bowling field. */
function bowlingTraits(bowling) {
  const b = bowling.toLowerCase();
  const out = [];
  const spin = /(spin|off[\s-]?break|off[\s-]?spin|leg[\s-]?break|leg[\s-]?spin|orthodox|googly|chinaman|slow left|left-arm slow|wrist[\s-]?spin|doosra)/.test(b);
  const pace = /(fast|medium|seam|swing)/.test(b);
  if (spin) out.push('spinner');
  if (pace && !spin) out.push('pacer');
  return out;
}

/**
 * True when a player should be classed as a genuine bowler rather than a
 * batter who happens to have a "bowling" line in the infobox. Without this,
 * part-timers (Kohli, AB de Villiers) get tagged as pacers/spinners.
 */
function isGenuineBowler(role, internationalWickets) {
  if (/bowl|all[\s-]?round/i.test(role)) return true;
  return internationalWickets >= 50;
}

/* ================================================================== *
 * 3. Record building
 * ================================================================== */

function slug(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Reads the standard stats table (column style or legacy params). */
function readStatTables(p) {
  const per = {};
  const COLUMN_KEYS = ['', '1', '2', '3', '4', '5', '6'];

  // --- column style -------------------------------------------------
  for (const suffix of COLUMN_KEYS) {
    const label = plain(p[`column${suffix}`]);
    if (!label) continue;
    const fmt = /test/i.test(label) ? 'test'
      : /(one day|odi)/i.test(label) ? 'odi'
        : /(twenty20 international|t20i)/i.test(label) ? 't20i'
          : /(first-class|first class)/i.test(label) ? 'fc' : null;
    if (!fmt) continue;
    const centuries = String(p[`100s/50s${suffix}`] || '').split('/');
    per[fmt] = {
      matches: num(p[`matches${suffix}`]),
      runs: num(p[`runs${suffix}`]),
      centuries: num(centuries[0]),
      fifties: num(centuries[1]),
      wickets: num(p[`wickets${suffix}`]),
      fivefor: num(p[`fivefor${suffix}`]),
      catches: num(String(p[`catches/stumpings${suffix}`] || '').split('/')[0]),
    };
  }

  // --- legacy style -------------------------------------------------
  const legacy = (fmt, key) => { if (!per[fmt]) per[fmt] = {}; };
  if (!per.test && (p.testmatches != null || p.testcap != null)) legacy('test');
  if (!per.odi && (p.odimatches != null || p.odicap != null)) legacy('odi');
  if (!per.t20i && (p.t20imatches != null || p.t20icap != null)) legacy('t20i');
  const legacyMap = {
    test: { matches: 'testmatches', runs: 'testruns', centuries: 'test100s', wickets: 'testwickets', fivefor: 'testfivefor' },
    odi: { matches: 'odimatches', runs: 'odiruns', centuries: 'odi100s', wickets: 'odiwickets', fivefor: 'odifivefor' },
    t20i: { matches: 't20imatches', runs: 't20iruns', centuries: 't20i100s', wickets: 't20iwickets', fivefor: 't20ifivefor' },
  };
  for (const [fmt, keys] of Object.entries(legacyMap)) {
    for (const [stat, key] of Object.entries(keys)) {
      if (p[key] != null) per[fmt][stat] = num(p[key]);
    }
  }
  return per;
}

function buildRecord(page) {
  const text = page.wikitext;
  if (!text) return null;

  const body = extractTemplate(text, 'Infobox\\s+cricketer');
  if (!body) return null;
  const p = splitParams(body);
  const per = readStatTables(p);

  // A player must have at least one international format we recognise.
  const international = Object.entries(per)
    .filter(([fmt]) => fmt !== 'fc' && (fmt !== undefined));
  if (!international.length) return null;

  // Canonical name comes from the article title (clean and disambiguation-free);
  // the infobox name often carries HTML tags or non-Latin scripts.
  const infoboxName = plain(p.name);
  const name = page.title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const country = plain(p.country);
  const batting = plain(p.batting);
  const bowling = plain(p.bowling);
  const role = plain(p.role);

  // International wickets across formats — used to spot genuine bowlers.
  const intlWickets = ['test', 'odi', 't20i']
    .reduce((sum, f) => sum + ((per[f] && per[f].wickets) || 0), 0);

  const traits = new Set();

  // Country
  const COUNTRY_TRAITS = {
    India: 'india', Pakistan: 'pakistan', Australia: 'australia', England: 'england',
    'South Africa': 'southafrica', 'New Zealand': 'newzealand', 'Sri Lanka': 'srilanka',
    'West Indies': 'westindies', Bangladesh: 'bangladesh', Afghanistan: 'afghanistan',
    Zimbabwe: 'zimbabwe', Ireland: 'ireland',
  };
  const countryTrait = COUNTRY_TRAITS[country];
  if (countryTrait) traits.add(countryTrait);

  // Formats actually played
  if (per.test && (per.test.matches || 0) > 0) traits.add('test_cricketer');
  if (per.odi && (per.odi.matches || 0) > 0) traits.add('odi_cricketer');
  if (per.t20i && (per.t20i.matches || 0) > 0) traits.add('t20i_cricketer');

  // Handedness
  if (/left[\s-]?hand/i.test(batting)) traits.add('lefthand');

  // Bowling style — only for players who actually bowl.
  if (isGenuineBowler(role, intlWickets)) {
    bowlingTraits(bowling).forEach((t) => traits.add(t));
  }

  // Role
  if (/wicket[\s-]?keep|wicketkeeper/i.test(role)) traits.add('wicketkeeper');
  if (/all[\s-]?rounder/i.test(role)) traits.add('allrounder');
  if (/batter|batsman|batting/i.test(role)) traits.add('batter');
  if (/open(ing|er)/i.test(role)) { traits.add('opener'); traits.add('batter'); }

  // Wicketkeeping can also be inferred from stumpings in the stats table.
  for (const fmt of ['test', 'odi', 't20i']) {
    const raw = p[`catches/stumpings${fmt === 'test' ? '1' : fmt === 'odi' ? '2' : '3'}`];
    const stumpings = String(raw || '').split('/')[1];
    if (stumpings && num(stumpings) > 0) traits.add('wicketkeeper');
  }

  // Clubs → leagues
  const clubs = [];
  for (let i = 1; i <= 20; i++) {
    const club = plain(p[`club${i}`]);
    if (club) clubs.push(club);
  }
  leaguesFromClubs(clubs).forEach((l) => traits.add(l));

  // Stats in the compact shape the game expects.
  const stats = {};
  const sum = (...vals) => {
    const nums = vals.filter((v) => v != null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  };
  const caps = sum(per.test && per.test.matches, per.odi && per.odi.matches, per.t20i && per.t20i.matches);
  if (caps) stats.caps = caps;
  if (per.test) {
    if (per.test.centuries) stats.test_c = per.test.centuries;
    if (per.test.wickets) stats.test_w = per.test.wickets;
    if (per.test.runs) stats.test_r = per.test.runs;
    if (per.test.fivefor) stats.test_5w = per.test.fivefor;
  }
  if (per.odi) {
    if (per.odi.centuries) stats.odi_c = per.odi.centuries;
    if (per.odi.wickets) stats.odi_w = per.odi.wickets;
    if (per.odi.runs) stats.odi_r = per.odi.runs;
  }
  if (per.t20i) {
    if (per.t20i.centuries) stats.t20i_c = per.t20i.centuries;
    if (per.t20i.wickets) stats.t20i_w = per.t20i.wickets;
    if (per.t20i.runs) stats.t20i_r = per.t20i.runs;
  }

  const aliases = [];
  const surname = name.split(' ').slice(1).join(' ');
  if (surname) aliases.push(surname);
  if (infoboxName && infoboxName !== name) aliases.push(infoboxName);
  const nickname = plain(p.nickname);
  if (nickname && nickname.length < 40) aliases.push(nickname);

  return {
    id: slug(page.title),
    name,
    title: page.title,
    country,
    traits: [...traits].sort(),
    stats,
    aliases: [...new Set(aliases.filter(Boolean))],
    _clubs: clubs,
    _careerSpan: plain(p.internationalspan),
  };
}

/* ================================================================== *
 * 4. Main
 * ================================================================== */
function main() {
  const files = fs.readdirSync(WIKITEXT_DIR).filter((f) => f.endsWith('.json')).sort();
  const seen = new Map();
  let scanned = 0, noInfobox = 0, noFormat = 0;

  for (const file of files) {
    const pages = JSON.parse(fs.readFileSync(path.join(WIKITEXT_DIR, file), 'utf8'));
    for (const page of pages) {
      scanned++;
      if (page.missing || !page.wikitext) { noInfobox++; continue; }
      const rec = buildRecord(page);
      if (!rec) {
        // Distinguish "no infobox" from "infobox without formats".
        if (extractTemplate(page.wikitext, 'Infobox\\s+cricketer')) noFormat++;
        else noInfobox++;
        continue;
      }
      if (!seen.has(rec.id)) seen.set(rec.id, rec);
    }
  }

  const players = [...seen.values()];
  fs.writeFileSync(path.join(CACHE, 'players-parsed.json'), JSON.stringify(players));

  /* ---- diagnostics ---- */
  console.log(`scanned pages      : ${scanned}`);
  console.log(`no usable infobox  : ${noInfobox}`);
  console.log(`infobox, no formats: ${noFormat}`);
  console.log(`players parsed     : ${players.length}\n`);

  const traitCounts = {};
  for (const p of players) for (const t of p.traits) traitCounts[t] = (traitCounts[t] || 0) + 1;
  const interesting = ['india', 'pakistan', 'australia', 'england', 'southafrica', 'newzealand',
    'srilanka', 'westindies', 'bangladesh', 'afghanistan', 'zimbabwe', 'ireland',
    'lefthand', 'spinner', 'pacer', 'wicketkeeper', 'allrounder', 'batter', 'opener',
    'ipl', 'psl', 'bbl', 'cpl', 'thehundred', 'ilt20', 'sat20'];
  console.log('trait coverage (need >= 4 for the puzzle generator):');
  for (const t of interesting) console.log(`  ${t.padEnd(14)} ${String(traitCounts[t] || 0).padStart(5)}`);

  const statKeys = ['caps', 'test_c', 'odi_c', 't20i_c', 'test_w', 'odi_w', 'test_r', 'odi_r', 't20i_r', 'test_5w'];
  console.log('\nstat coverage:');
  for (const k of statKeys) {
    const n = players.filter((p) => p.stats[k] != null).length;
    const over = (min) => players.filter((p) => (p.stats[k] || 0) >= min).length;
    console.log(`  ${k.padEnd(8)} present:${String(n).padStart(5)}   >=100:${String(over(100)).padStart(5)}  >=5000:${String(over(5000)).padStart(5)}`);
  }
  console.log('\nsample:');
  for (const p of players.slice(0, 3)) {
    console.log(`  ${p.name} (${p.country}) [${p.traits.join(',')}] ${JSON.stringify(p.stats)}`);
  }
  const kohli = players.find((p) => p.title === 'Virat Kohli');
  console.log('  Virat Kohli:', JSON.stringify(kohli && { traits: kohli.traits, stats: kohli.stats }));
}

main();
