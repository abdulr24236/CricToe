/**
 * CricToe data pipeline — stage 3
 * ---------------------------------------------------------------
 * Collects traits that live in Wikipedia *categories* rather than in
 * the infobox:
 *
 *   • captain          — every nation's Test/ODI/T20I captain categories
 *   • commentator      — cricket commentator categories by nationality
 *   • honours          — worldcup / t20worldcup / champions_trophy /
 *                        asia_cup / wtc_final, derived from the
 *                        "Cricketers at the YYYY <tournament>" squad
 *                        categories intersected with the winning nation
 *
 *   node build/fetch-categories.mjs
 *
 * Output: build/cache/category-traits.json
 * Source: Wikipedia (CC BY-SA 4.0).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorySizes, categoryMembers } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');

/* ------------------------------------------------------------------ *
 * Captaincy — Wikipedia naming is inconsistent, so try several forms.
 * ------------------------------------------------------------------ */
const NATIONS = {
  India: 'Indian',
  Pakistan: 'Pakistani',
  Australia: 'Australian',
  England: 'English',
  'South Africa': 'South African',
  'New Zealand': 'New Zealand',
  'Sri Lanka': 'Sri Lankan',
  'West Indies': 'West Indian',
  Bangladesh: 'Bangladeshi',
  Afghanistan: 'Afghan',
  Zimbabwe: 'Zimbabwean',
  Ireland: 'Irish',
};

function captainCandidates() {
  const out = [];
  for (const [nation, demonym] of Object.entries(NATIONS)) {
    for (const base of [nation, demonym]) {
      out.push(
        `Category:${base} cricket captains`,
        `Category:${base} Test cricket captains`,
        `Category:${base} One Day International captains`,
        `Category:${base} Twenty20 International captains`,
      );
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Commentators — a parent category plus national sub-categories.
 * ------------------------------------------------------------------ */
const COMMENTATOR_CATEGORIES = [
  'Category:Cricket commentators',
  'Category:Indian cricket commentators',
  'Category:Pakistani cricket commentators',
  'Category:English cricket commentators',
  'Category:Australian cricket commentators',
  'Category:South African cricket commentators',
  'Category:New Zealand cricket commentators',
  'Category:Sri Lankan cricket commentators',
  'Category:West Indian cricket commentators',
  'Category:Bangladeshi cricket commentators',
  'Category:Afghan cricket commentators',
  'Category:Zimbabwean cricket commentators',
  'Category:Irish cricket commentators',
];

/* ------------------------------------------------------------------ *
 * Honours — squad category + winning nation per edition.
 * Each entry lists candidate category titles (first that exists wins).
 * ------------------------------------------------------------------ */
const TOURNAMENTS = [
  // trait, year, winner(s), candidate category names
  ...['1975', '1979', '1983', '1987', '1992', '1996', '1999', '2003', '2007', '2011', '2015', '2019', '2023']
    .map((year) => ({
      trait: 'worldcup',
      label: `${year} World Cup`,
      winners: {
        1975: ['westindies'], 1979: ['westindies'], 1983: ['india'], 1987: ['australia'],
        1992: ['pakistan'], 1996: ['srilanka'], 1999: ['australia'], 2003: ['australia'],
        2007: ['australia'], 2011: ['india'], 2015: ['australia'], 2019: ['england'],
        2023: ['australia'],
      }[year],
      candidates: [
        `Category:Cricketers at the ${year} Cricket World Cup`,
        `Category:${year} Cricket World Cup cricketers`,
      ],
    })),
  ...['2007', '2009', '2010', '2012', '2014', '2016', '2021', '2022', '2024']
    .map((year) => ({
      trait: 't20worldcup',
      label: `${year} T20 World Cup`,
      winners: {
        2007: ['india'], 2009: ['pakistan'], 2010: ['england'], 2012: ['westindies'],
        2014: ['srilanka'], 2016: ['westindies'], 2021: ['australia'], 2022: ['england'],
        2024: ['india'],
      }[year],
      candidates: [
        `Category:Cricketers at the ${year} ICC World Twenty20`,
        `Category:Cricketers at the ${year} ICC Men's T20 World Cup`,
        `Category:Cricketers at the ${year} ICC World T20`,
      ],
    })),
  ...['1998', '2000', '2002', '2004', '2006', '2009', '2013', '2017', '2025']
    .map((year) => ({
      trait: 'champions_trophy',
      label: `${year} Champions Trophy`,
      winners: {
        1998: ['southafrica'], 2000: ['newzealand'], 2002: ['india', 'srilanka'],
        2004: ['westindies'], 2006: ['australia'], 2009: ['australia'], 2013: ['india'],
        2017: ['pakistan'], 2025: ['india'],
      }[year],
      candidates: [
        `Category:Cricketers at the ${year} ICC Champions Trophy`,
        `Category:Cricketers at the ${year} ICC KnockOut Trophy`,
      ],
    })),
  ...['1984', '1986', '1988', '1990', '1995', '1997', '2000', '2004', '2008', '2010', '2012', '2014', '2016', '2018', '2022', '2023']
    .map((year) => ({
      trait: 'asia_cup',
      label: `${year} Asia Cup`,
      winners: {
        1984: ['india'], 1986: ['srilanka'], 1988: ['india'], 1990: ['india'],
        1995: ['india'], 1997: ['srilanka'], 2000: ['pakistan'], 2004: ['srilanka'],
        2008: ['srilanka'], 2010: ['india'], 2012: ['pakistan'], 2014: ['srilanka'],
        2016: ['india'], 2018: ['india'], 2022: ['srilanka'], 2023: ['india'],
      }[year],
      candidates: [
        `Category:Cricketers at the ${year} Asia Cup`,
        `Category:${year} Asia Cup cricketers`,
      ],
    })),
  ...['2021', '2023', '2025'].map((year) => ({
    trait: 'wtc_final',
    label: `${year} WTC Final`,
    winners: { 2021: ['newzealand'], 2023: ['australia'], 2025: ['southafrica'] }[year],
    candidates: [
      `Category:Cricketers at the ${year} ICC World Test Championship Final`,
      `Category:${year} ICC World Test Championship Final cricketers`,
    ],
  })),
];

/* ------------------------------------------------------------------ */

const report = [];

async function collectCategoryTraits() {
  /* captain ------------------------------------------------------- */
  const capCandidates = captainCandidates();
  const capSizes = await categorySizes(capCandidates);
  const capCats = [...capSizes].filter(([, size]) => size != null).map(([t]) => t);
  report.push(`captain categories found: ${capCats.length}/${capCandidates.length}`);
  const captain = new Set();
  for (const cat of capCats) {
    for (const t of await categoryMembers(cat)) captain.add(t);
  }
  report.push(`captain members: ${captain.size}`);

  /* commentator --------------------------------------------------- */
  const comSizes = await categorySizes(COMMENTATOR_CATEGORIES);
  const comCats = [...comSizes].filter(([, size]) => size != null).map(([t]) => t);
  report.push(`commentator categories found: ${comCats.length}/${COMMENTATOR_CATEGORIES.length}`);
  const commentator = new Set();
  for (const cat of comCats) {
    for (const t of await categoryMembers(cat)) commentator.add(t);
  }
  report.push(`commentator members: ${commentator.size}`);

  /* honours ------------------------------------------------------- */
  // title -> nation trait, so we can keep only the winning nation's players.
  const players = JSON.parse(fs.readFileSync(path.join(CACHE, 'players-parsed.json'), 'utf8'));
  const COUNTRY_TRAITS = ['india', 'pakistan', 'australia', 'england', 'southafrica', 'newzealand',
    'srilanka', 'westindies', 'bangladesh', 'afghanistan', 'zimbabwe', 'ireland'];
  const titleNation = new Map();
  for (const p of players) {
    const nat = p.traits.find((t) => COUNTRY_TRAITS.includes(t));
    if (nat) titleNation.set(p.title, nat);
  }

  const allCandidates = TOURNAMENTS.flatMap((t) => t.candidates);
  const sizes = await categorySizes(allCandidates);

  const honours = { worldcup: new Set(), t20worldcup: new Set(), champions_trophy: new Set(), asia_cup: new Set(), wtc_final: new Set() };
  let used = 0, skipped = 0;
  for (const t of TOURNAMENTS) {
    const cat = t.candidates.find((c) => sizes.get(c) != null);
    if (!cat) { skipped++; report.push(`  SKIP ${t.label} (no category)`); continue; }
    used++;
    const members = await categoryMembers(cat);
    let kept = 0;
    for (const title of members) {
      const nation = titleNation.get(title);
      if (nation && t.winners.includes(nation)) { honours[t.trait].add(title); kept++; }
    }
    report.push(`  ${t.label.padEnd(18)} ${cat.replace('Category:', '')} -> ${kept} winner${kept === 1 ? '' : 's'}`);
  }
  report.push(`tournaments used: ${used}, skipped: ${skipped}`);

  return {
    captain: [...captain].sort(),
    commentator: [...commentator].sort(),
    honours: Object.fromEntries(Object.entries(honours).map(([k, v]) => [k, [...v].sort()])),
    _report: report,
  };
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = await collectCategoryTraits();
  fs.writeFileSync(path.join(CACHE, 'category-traits.json'), JSON.stringify(out, null, 0));
  console.log(out._report.join('\n'));
  console.log('\nHonour totals:');
  for (const [k, v] of Object.entries(out.honours)) console.log(`  ${k.padEnd(18)} ${v.length}`);
  console.log('\nWrote build/cache/category-traits.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
