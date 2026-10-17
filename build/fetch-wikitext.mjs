/**
 * CricToe data pipeline — stage 1
 * ---------------------------------------------------------------
 * Enumerates international cricketers for the major nations from
 * Wikipedia category pages, then downloads the wikitext of each
 * article in batches (the wikitext contains the {{Infobox cricketer}}
 * with per-format career statistics).
 *
 *   node build/fetch-wikitext.mjs
 *
 * Output (cached, safe to delete and re-run):
 *   build/cache/titles.json      — unique article titles
 *   build/cache/wikitext/NNN.json — raw wikitext batches
 *
 * Data source: Wikipedia (CC BY-SA 4.0). See build/README.md for attribution.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const WIKITEXT_DIR = path.join(CACHE, 'wikitext');

const UA = 'CricToe/1.0 (https://github.com/your-username/crictoe; cricket trivia grid)';
const API = 'https://en.wikipedia.org/w/api.php';

/** The nations we cover and the three international formats. */
export const NATIONS = [
  'India', 'Pakistan', 'Australia', 'England', 'South Africa', 'New Zealand',
  'Sri Lanka', 'West Indies', 'Bangladesh', 'Afghanistan', 'Zimbabwe', 'Ireland',
];
const FORMATS = [
  'Test cricketers',
  'One Day International cricketers',
  'Twenty20 International cricketers',
];

/** Politeness delay between requests (ms). */
const THROTTLE_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params, attempt = 0) {
  const url = new URL(API);
  Object.entries({ format: 'json', formatversion: '2', maxlag: '5', ...params })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.info || JSON.stringify(json.error));
    return json;
  } catch (err) {
    if (attempt >= 4) throw err;
    const backoff = 1000 * 2 ** attempt;
    console.warn(`  ! ${err.message} — retrying in ${backoff}ms`);
    await sleep(backoff);
    return api(params, attempt + 1);
  }
}

/* ------------------------------------------------------------------ *
 * Step 1 — enumerate article titles from category pages
 * ------------------------------------------------------------------ */
async function enumerateTitles() {
  const titles = new Set();
  for (const nation of NATIONS) {
    for (const format of FORMATS) {
      const category = `Category:${nation} ${format}`;
      let cont;
      let count = 0;
      do {
        const json = await api({
          action: 'query',
          list: 'categorymembers',
          cmtitle: category,
          cmlimit: '500',
          cmtype: 'page',
          ...(cont ? { cmcontinue: cont } : {}),
        });
        for (const m of json.query.categorymembers) {
          // Skip list/overview articles — we only want people.
          if (/^List of /i.test(m.title)) continue;
          titles.add(m.title);
          count++;
        }
        cont = json.continue && json.continue.cmcontinue;
        await sleep(THROTTLE_MS);
      } while (cont);
      console.log(`  ${category.padEnd(52)} ${String(count).padStart(4)} titles`);
    }
  }
  return [...titles].sort();
}

/* ------------------------------------------------------------------ *
 * Step 2 — download wikitext for every title (50 pages per request)
 * ------------------------------------------------------------------ */
async function fetchWikitext(titles) {
  fs.mkdirSync(WIKITEXT_DIR, { recursive: true });
  const BATCH = 50;
  const batches = Math.ceil(titles.length / BATCH);

  let downloaded = 0;
  for (let i = 0; i < batches; i++) {
    const file = path.join(WIKITEXT_DIR, `${String(i).padStart(4, '0')}.json`);
    if (fs.existsSync(file)) continue; // resumable

    const slice = titles.slice(i * BATCH, (i + 1) * BATCH);
    const json = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: slice.join('|'),
      redirects: '1',
    });

    // Normalise redirects back onto the titles we asked for.
    const redirectMap = new Map((json.query.redirects || []).map((r) => [r.to, r.from]));
    const normalMap = new Map((json.query.normalized || []).map((n) => [n.to, n.from]));

    const pages = json.query.pages.map((p) => {
      const original = redirectMap.get(p.title) || normalMap.get(p.title) || p.title;
      const content = p.revisions && p.revisions[0]
        ? p.revisions[0].slots.main.content
        : null;
      return { title: original, finalTitle: p.title, missing: !!p.missing, wikitext: content };
    });

    fs.writeFileSync(file, JSON.stringify(pages));
    downloaded++;
    if (i % 10 === 0 || i === batches - 1) {
      console.log(`  batch ${i + 1}/${batches} (${downloaded} written)`);
    }
    await sleep(THROTTLE_MS);
  }
  return WIKITEXT_DIR;
}

/* ------------------------------------------------------------------ */
async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const titlesFile = path.join(CACHE, 'titles.json');

  let titles;
  if (fs.existsSync(titlesFile)) {
    titles = JSON.parse(fs.readFileSync(titlesFile, 'utf8'));
    console.log(`Enumerated titles (cached): ${titles.length}`);
  } else {
    console.log('Enumerating categories…');
    titles = await enumerateTitles();
    fs.writeFileSync(titlesFile, JSON.stringify(titles, null, 0));
    console.log(`Unique article titles: ${titles.length}`);
  }

  console.log('Downloading wikitext…');
  await fetchWikitext(titles);
  console.log('Done. Next: node build/parse-wikitext.mjs');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('fetch-wikitext.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

export { api, UA };
