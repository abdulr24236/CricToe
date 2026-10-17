/**
 * CricToe data pipeline — stage 4
 * ---------------------------------------------------------------
 * Enriches every player with data that only Wikidata has:
 *
 *   • P18   image            -> free (Commons) photo for the player
 *   • P2697 Cricinfo player  -> join key to the Cricsheet register,
 *                               which is how we later build the
 *                               "played alongside X" relationship
 *
 *   node build/fetch-wikidata.mjs
 *
 * Output: build/cache/wikidata.json  (title -> { qid, image, cricinfo })
 * Source: Wikidata (CC0 — no attribution required, but we credit it anyway).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wiki, getJson, WIKIDATA_SPARQL } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const TITLES_FILE = path.join(CACHE, 'titles.json');
const QID_CACHE = path.join(CACHE, 'wikidata-qids.json');
const OUT_FILE = path.join(CACHE, 'wikidata.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Step 1 — article title -> Wikidata QID
 * ------------------------------------------------------------------ */
async function titleToQid(titles) {
  if (fs.existsSync(QID_CACHE)) {
    const cached = JSON.parse(fs.readFileSync(QID_CACHE, 'utf8'));
    if (Object.keys(cached).length >= titles.length * 0.95) return cached;
  }

  const map = {};
  const BATCH = 50;
  for (let i = 0; i < titles.length; i += BATCH) {
    const slice = titles.slice(i, i + BATCH);
    const j = await wiki({
      action: 'query', prop: 'pageprops', ppprop: 'wikibase_item',
      titles: slice.join('|'), redirects: '1',
    });
    const redirects = new Map((j.query.redirects || []).map((r) => [r.to, r.from]));
    const normalized = new Map((j.query.normalized || []).map((n) => [n.to, n.from]));
    for (const p of j.query.pages) {
      const original = redirects.get(p.title) || normalized.get(p.title) || p.title;
      const qid = p.pageprops && p.pageprops.wikibase_item;
      if (qid) map[original] = qid;
    }
    if (i % 500 === 0) console.log(`  qid lookup ${i + slice.length}/${titles.length}`);
  }
  fs.writeFileSync(QID_CACHE, JSON.stringify(map));
  return map;
}

/* ------------------------------------------------------------------ *
 * Step 2 — QID -> image + cricinfo id (batched SPARQL VALUES)
 * ------------------------------------------------------------------ */
async function qidToDetails(qids) {
  const out = {};
  const BATCH = 250;
  for (let i = 0; i < qids.length; i += BATCH) {
    const slice = qids.slice(i, i + BATCH);
    const values = slice.map((q) => `wd:${q}`).join(' ');
    const query = `SELECT ?item ?image ?cricinfo WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item wdt:P18 ?image . }
      OPTIONAL { ?item wdt:P2697 ?cricinfo . }
    }`;
    const j = await getJson(WIKIDATA_SPARQL, { query, format: 'json' });
    for (const b of j.results.bindings) {
      const qid = b.item.value.split('/').pop();
      const rec = out[qid] || (out[qid] = {});
      if (b.image && !rec.image) rec.image = decodeURIComponent(b.image.value.split('/').pop().replace(/_/g, ' '));
      if (b.cricinfo && !rec.cricinfo) rec.cricinfo = b.cricinfo.value;
    }
    console.log(`  sparql ${i + slice.length}/${qids.length} (found ${Object.keys(out).length})`);
    await sleep(250);
  }
  return out;
}

/* ------------------------------------------------------------------ */

async function main() {
  const titles = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8'));
  console.log(`Resolving ${titles.length} articles to Wikidata items…`);
  const titleQid = await titleToQid(titles);
  console.log(`  resolved: ${Object.keys(titleQid).length}/${titles.length}`);

  const qids = [...new Set(Object.values(titleQid))];
  console.log(`Fetching images + cricinfo ids for ${qids.length} items…`);
  const details = await qidToDetails(qids);

  const result = {};
  let images = 0, cricinfo = 0;
  for (const [title, qid] of Object.entries(titleQid)) {
    const d = details[qid] || {};
    // Special:FilePath redirects to the actual file and resizes server-side.
    const image = d.image
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(d.image)}?width=240`
      : null;
    if (image) images++;
    if (d.cricinfo) cricinfo++;
    result[title] = { qid, image, cricinfo: d.cricinfo || null };
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 0));
  console.log(`\nplayers with Commons image : ${images}`);
  console.log(`players with cricinfo id   : ${cricinfo}`);
  console.log('Wrote build/cache/wikidata.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
