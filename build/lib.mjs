/**
 * CricToe data pipeline — shared helpers.
 *
 * A polite, rate-limit-aware client for the MediaWiki / Wikidata APIs.
 * Wikimedia throttles aggressive clients, so every request is spaced out,
 * retries on 429/5xx honouring Retry-After, and validates that the body is
 * actually JSON before parsing.
 */
export const UA = 'CricToe/1.0 (cricket trivia grid; https://github.com/your-username/crictoe)';

const MIN_GAP_MS = Number(process.env.CRICTOE_API_GAP_MS || 350);
let lastRequest = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serialises requests so we never exceed one call per MIN_GAP_MS. */
async function throttle() {
  const wait = lastRequest + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
}

/**
 * GETs JSON with throttling and exponential backoff.
 * @param {string} endpoint  absolute URL
 * @param {Record<string,string>} params query params
 */
export async function getJson(endpoint, params, attempt = 0) {
  const url = new URL(endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  await throttle();
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  } catch (err) {
    return retry(endpoint, params, attempt, `network: ${err.message}`);
  }

  // Rate limited / server error — back off and retry.
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    const wait = Math.max(retryAfter * 1000, 1500 * 2 ** attempt);
    console.warn(`  ! HTTP ${res.status} — backing off ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return retry(endpoint, params, attempt, `HTTP ${res.status}`);
  }

  const text = await res.text();
  if (/^\s*You are making too many requests/i.test(text)) {
    return retry(endpoint, params, attempt, 'throttled (text response)');
  }

  try {
    const json = JSON.parse(text);
    if (json.error) throw new Error(json.error.info || JSON.stringify(json.error));
    return json;
  } catch (err) {
    return retry(endpoint, params, attempt, `bad JSON: ${err.message}`);
  }
}

async function retry(endpoint, params, attempt, reason) {
  if (attempt >= 5) throw new Error(`Give up after ${attempt} retries (${reason})`);
  const wait = 1500 * 2 ** attempt;
  console.warn(`  ! ${reason} — retry ${attempt + 1} in ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  return getJson(endpoint, params, attempt + 1);
}

export const WIKI_API = 'https://en.wikipedia.org/w/api.php';
export const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

export const wiki = (params) => getJson(WIKI_API, { format: 'json', formatversion: '2', ...params });

/** Returns category sizes for a list of category titles (null when missing). */
export async function categorySizes(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const slice = titles.slice(i, i + 40);
    const j = await wiki({ action: 'query', prop: 'categoryinfo', titles: slice.join('|') });
    for (const t of slice) {
      const p = j.query.pages.find((x) => x.title === t);
      out.set(t, p && p.categoryinfo ? p.categoryinfo.size : null);
    }
  }
  return out;
}

/** Returns every article title in a category (following pagination). */
export async function categoryMembers(category) {
  const titles = [];
  let cont;
  do {
    const j = await wiki({
      action: 'query', list: 'categorymembers', cmtitle: category,
      cmlimit: '500', cmtype: 'page', ...(cont ? { cmcontinue: cont } : {}),
    });
    for (const m of j.query.categorymembers) {
      if (!/^List of /i.test(m.title)) titles.push(m.title);
    }
    cont = j.continue && j.continue.cmcontinue;
  } while (cont);
  return titles;
}
