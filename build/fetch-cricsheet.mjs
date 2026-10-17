/**
 * CricToe data pipeline — stage 5
 * ---------------------------------------------------------------
 * Turns Cricsheet ball-by-ball archives into three things that
 * Wikipedia cannot give us:
 *
 *   1. league participation  — who actually played in the IPL / PSL / …
 *   2. tournament honours    — winners' XIs from every ICC/Asia Cup final
 *   3. co-appearance         — "played in the same XI as <player>",
 *                              which powers the `player_ref` criterion
 *
 *   node build/fetch-cricsheet.mjs
 *
 * Outputs (build/cache/):
 *   cricsheet-leagues.json    trait -> [playerId]
 *   cricsheet-honours.json    trait -> [playerId]
 *   cricsheet-coappear.json   { <playerId>: { name, teammates: [playerId] } }
 *
 * Source: Cricsheet (ODC-By 1.0 / CC BY 4.0 — attribution required).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const CRIC = path.join(CACHE, 'cricsheet');
const ZIPS = path.join(CRIC, 'zips');
const URL_BASE = 'https://cricsheet.org/downloads/';

/* Leagues we track, and the identifier used in match `event.name`. */
const LEAGUE_BY_EVENT = [
  [/indian premier league/i, 'ipl'],
  [/pakistan super league/i, 'psl'],
  [/big bash league/i, 'bbl'],
  [/caribbean premier league/i, 'cpl'],
  [/the hundred/i, 'thehundred'],
  [/international league t20/i, 'ilt20'],
  [/\bsa20\b/i, 'sat20'],
];

/* ICC / continental finals -> honour trait. */
const HONOUR_BY_EVENT = [
  [/world test championship/i, 'wtc_final'],
  [/t20 world cup|world t20|world twenty20/i, 't20worldcup'],
  [/champions trophy|knockout/i, 'champions_trophy'],
  [/asia cup/i, 'asia_cup'],
  [/cricket world cup/i, 'worldcup'],
];

/* Archives to pull (men's only — the dataset is men's internationals). */
const ARCHIVES = [
  { file: 'tests_male_json.zip', dir: 'tests' },
  { file: 'odis_male_json.zip', dir: 'odis' },
  { file: 't20s_male_json.zip', dir: 't20s' },
  { file: 'ipl_male_json.zip', dir: 'ipl' },
  { file: 'psl_male_json.zip', dir: 'psl' },
  { file: 'bbl_male_json.zip', dir: 'bbl' },
  { file: 'cpl_male_json.zip', dir: 'cpl' },
  { file: 'hnd_male_json.zip', dir: 'hnd' },
  { file: 'ilt_male_json.zip', dir: 'ilt' },
  { file: 'sat_male_json.zip', dir: 'sat' },
];

/**
 * Iconic players used as the subject of a `player_ref` criterion
 * ("Played in the same XI as …"). Long careers keep these puzzles solvable.
 */
const REFERENCE_PLAYERS = [
  // India
  'MS Dhoni', 'Virat Kohli', 'Rohit Sharma', 'Sachin Tendulkar', 'Sourav Ganguly',
  'Rahul Dravid', 'Virender Sehwag', 'Yuvraj Singh', 'Suresh Raina', 'Ravindra Jadeja',
  'Ravichandran Ashwin', 'Jasprit Bumrah', 'Shikhar Dhawan', 'Ajinkya Rahane',
  'Gautam Gambhir', 'Harbhajan Singh', 'Zaheer Khan', 'Anil Kumble', 'Mohammed Shami',
  'Hardik Pandya', 'KL Rahul', 'Rishabh Pant',
  // Australia
  'Ricky Ponting', 'Adam Gilchrist', 'Shane Warne', 'Glenn McGrath', 'Michael Clarke',
  'Steve Smith', 'David Warner', 'Glenn Maxwell', 'Aaron Finch', 'Shane Watson',
  'Brett Lee', 'Mitchell Starc', 'Pat Cummins', 'Matthew Hayden', 'Michael Hussey',
  // England
  'Eoin Morgan', 'Joe Root', 'Ben Stokes', 'Jos Buttler', 'James Anderson',
  'Stuart Broad', 'Alastair Cook', 'Ian Bell', 'Kevin Pietersen', 'Moeen Ali',
  // South Africa
  'Jacques Kallis', 'AB de Villiers', 'Dale Steyn', 'Hashim Amla', 'Graeme Smith',
  'Mark Boucher', 'Morne Morkel', 'Faf du Plessis', 'Quinton de Kock',
  // New Zealand
  'Brendon McCullum', 'Kane Williamson', 'Ross Taylor', 'Martin Guptill',
  'Trent Boult', 'Tim Southee', 'Daniel Vettori',
  // Pakistan
  'Shahid Afridi', 'Misbah-ul-Haq', 'Younis Khan', 'Inzamam-ul-Haq', 'Wasim Akram',
  'Shoaib Akhtar', 'Babar Azam', 'Mohammad Rizwan', 'Shoaib Malik', 'Mohammad Hafeez',
  // Sri Lanka
  'Kumar Sangakkara', 'Mahela Jayawardene', 'Lasith Malinga', 'Tillakaratne Dilshan',
  'Angelo Mathews', 'Sanath Jayasuriya', 'Dinesh Chandimal',
  // West Indies
  'Chris Gayle', 'Kieron Pollard', 'Dwayne Bravo', 'Shivnarine Chanderpaul',
  'Brian Lara', 'Marlon Samuels', 'Andre Russell', 'Nicholas Pooran',
  // Bangladesh
  'Shakib Al Hasan', 'Mushfiqur Rahim', 'Tamim Iqbal', 'Mahmudullah Riyad', 'Mashrafe Mortaza',
  // Afghanistan / Zimbabwe / Ireland
  'Mohammad Nabi', 'Rashid Khan', 'Mohammad Shahzad',
  'Brendan Taylor', 'Hamilton Masakadza', 'Sean Williams', 'Sikandar Raza',
  'Kevin O\'Brien', 'Paul Stirling', 'William Porterfield',
];

/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(file) {
  const dest = path.join(ZIPS, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) return dest;
  fs.mkdirSync(ZIPS, { recursive: true });
  console.log(`  downloading ${file}…`);
  const res = await fetch(URL_BASE + file, { headers: { 'User-Agent': 'CricToe/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function extract(zipPath, dirName) {
  const dir = path.join(CRIC, dirName);
  if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.json'))) return dir;
  fs.mkdirSync(dir, { recursive: true });
  // `unzip` is present in the Git Bash environment; -o overwrites silently.
  execFileSync('unzip', ['-qq', '-o', zipPath, '-d', dir], { stdio: 'inherit' });
  return dir;
}

/* ------------------------------------------------------------------ *
 * Linking: Cricsheet id -> our player id
 * ------------------------------------------------------------------ */
function buildLink(registerCsv, wikidata, players) {
  const lines = registerCsv.split('\n');
  const header = lines[0].split(',');
  const ci = header.indexOf('key_cricinfo');
  const idc = header.indexOf('identifier');
  const namec = header.indexOf('name');

  const cricIdByCricinfo = new Map();   // cricinfo id -> cricsheet id
  const cricIdByName = new Map();       // cricsheet display name -> cricsheet id
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(',');
    if (c[ci]) cricIdByCricinfo.set(c[ci], c[idc]);
    if (c[namec]) cricIdByName.set(c[namec], c[idc]);
  }

  const wikidataCricinfo = new Map();   // title -> cricinfo id
  for (const [title, v] of Object.entries(wikidata)) if (v.cricinfo) wikidataCricinfo.set(title, v.cricinfo);

  const titleToPlayerId = new Map(players.map((p) => [p.title, p.id]));
  const cricIdToPlayerId = new Map();
  for (const [title, cricinfoId] of wikidataCricinfo) {
    const cricsheetId = cricIdByCricinfo.get(cricinfoId);
    const playerId = titleToPlayerId.get(title);
    if (cricsheetId && playerId) cricIdToPlayerId.set(cricsheetId, playerId);
  }
  return { cricIdToPlayerId, cricIdByName };
}

/* ------------------------------------------------------------------ */

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });

  /* register ------------------------------------------------------- */
  const registerFile = path.join(CACHE, 'cricsheet-people.csv');
  if (!fs.existsSync(registerFile)) {
    console.log('Downloading Cricsheet people register…');
    const res = await fetch('https://cricsheet.org/register/people.csv', { headers: { 'User-Agent': 'CricToe/1.0' } });
    fs.writeFileSync(registerFile, await res.text());
  }
  const registerCsv = fs.readFileSync(registerFile, 'utf8');

  const wikidata = JSON.parse(fs.readFileSync(path.join(CACHE, 'wikidata.json'), 'utf8'));
  const players = JSON.parse(fs.readFileSync(path.join(CACHE, 'players-parsed.json'), 'utf8'));
  const { cricIdToPlayerId, cricIdByName } = buildLink(registerCsv, wikidata, players);
  console.log(`Linked Cricsheet ids -> players: ${cricIdToPlayerId.size} / ${players.length}`);

  const playerById = new Map(players.map((p) => [p.id, p]));
  const refs = REFERENCE_PLAYERS
    .map((t) => players.find((p) => p.title === t))
    .filter(Boolean);
  const refIds = new Set(refs.map((p) => p.id));
  console.log(`Reference players found: ${refIds.size} / ${REFERENCE_PLAYERS.length}`);

  /* download + extract --------------------------------------------- */
  const dirs = [];
  for (const a of ARCHIVES) {
    const zip = await download(a.file);
    dirs.push({ dir: extract(zip, a.dir), label: a.dir });
  }

  /* single pass over every match ------------------------------------ */
  const leaguePlayers = {};   // trait -> Set(playerId)
  const honourPlayers = {};   // trait -> Set(playerId)
  const teammates = {};       // refPlayerId -> Map(otherId, count)
  let matches = 0, xisMapped = 0;

  for (const { dir } of dirs) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { continue; }
      const info = j.info || {};
      if (!info.players) continue;
      matches++;

      const cricsheetIdFor = (displayName) => {
        const reg = info.registry && info.registry.people;
        if (reg && reg[displayName]) return reg[displayName];
        return cricIdByName.get(displayName);
      };

      const xiByTeam = {};
      for (const [team, names] of Object.entries(info.players)) {
        const ids = [];
        for (const n of names) {
          const csId = cricsheetIdFor(n);
          const pid = csId && cricIdToPlayerId.get(csId);
          if (pid) ids.push(pid);
        }
        xiByTeam[team] = ids;
        if (ids.length) xisMapped++;
      }

      /* league participation */
      const eventName = (info.event && info.event.name) || '';
      const league = LEAGUE_BY_EVENT.find(([re]) => re.test(eventName));
      if (league) {
        const trait = league[1];
        (leaguePlayers[trait] ||= new Set());
        for (const ids of Object.values(xiByTeam)) for (const id of ids) leaguePlayers[trait].add(id);
      }

      /* tournament honours from the final */
      const stage = (info.event && info.event.stage) || '';
      if (/^final$/i.test(stage) && info.outcome && info.outcome.winner) {
        const honour = HONOUR_BY_EVENT.find(([re]) => re.test(eventName));
        if (honour) {
          (honourPlayers[honour[1]] ||= new Set());
          for (const id of xiByTeam[info.outcome.winner] || []) honourPlayers[honour[1]].add(id);
        }
      }

      /* co-appearance (only for reference players) */
      for (const ids of Object.values(xiByTeam)) {
        if (ids.length < 2) continue;
        for (const id of ids) {
          if (!refIds.has(id)) continue;
          const map = teammates[id] || (teammates[id] = new Map());
          for (const other of ids) {
            if (other === id) continue;
            map.set(other, (map.get(other) || 0) + 1);
          }
        }
      }
    }
    console.log(`  scanned ${dir.padEnd(6)} ${files.length} matches`);
  }

  /* write outputs --------------------------------------------------- */
  const leaguesOut = Object.fromEntries(Object.entries(leaguePlayers).map(([k, v]) => [k, [...v].sort()]));
  const honoursOut = Object.fromEntries(Object.entries(honourPlayers).map(([k, v]) => [k, [...v].sort()]));

  const coappear = {};
  let dropped = 0;
  for (const p of refs) {
    const map = teammates[p.id];
    const list = map ? [...map.keys()].filter((id) => playerById.has(id)) : [];
    // A reference is only useful if enough squares can be answered from it.
    if (list.length < 8) { dropped++; continue; }
    coappear[p.id] = {
      name: p.name,
      country: (p.traits || []).find((t) => ['india', 'pakistan', 'australia', 'england', 'southafrica', 'newzealand', 'srilanka', 'westindies', 'bangladesh', 'afghanistan', 'zimbabwe', 'ireland'].includes(t)) || null,
      teammates: list.sort(),
    };
  }

  fs.writeFileSync(path.join(CACHE, 'cricsheet-leagues.json'), JSON.stringify(leaguesOut));
  fs.writeFileSync(path.join(CACHE, 'cricsheet-honours.json'), JSON.stringify(honoursOut));
  fs.writeFileSync(path.join(CACHE, 'cricsheet-coappear.json'), JSON.stringify(coappear));

  /* diagnostics ----------------------------------------------------- */
  console.log(`\nmatches scanned            : ${matches}`);
  console.log(`team-innings mapped        : ${xisMapped}`);
  console.log('\nleague participation (from real matches):');
  for (const [k, v] of Object.entries(leaguesOut)) console.log(`  ${k.padEnd(12)} ${v.length}`);
  console.log('\nhonours (winners\' XIs from finals):');
  for (const [k, v] of Object.entries(honoursOut)) console.log(`  ${k.padEnd(18)} ${v.length}`);
  console.log(`\nco-appearance references kept: ${Object.keys(coappear).length} (dropped ${dropped})`);
  const sizes = Object.values(coappear).map((c) => c.teammates.length).sort((a, b) => b - a);
  console.log(`  teammates per reference: max ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}`);
  console.log(`  e.g. MS Dhoni -> ${coappear['ms-dhoni'] ? coappear['ms-dhoni'].teammates.length : 0} teammates`);
}

main().catch((err) => { console.error(err); process.exit(1); });
