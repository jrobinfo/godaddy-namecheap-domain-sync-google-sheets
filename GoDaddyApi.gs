/** GoDaddy via API (primary). Script Properties: GODADDY_KEY, GODADDY_SECRET.
 *  Calls per run: 1 list call per 1000 domains (includes=nameServers, so no per-domain detail call).
 *  Per domain: 0 calls if NS came with the list or is in the 24h cache; else 1 DoH NS query (active only).
 *  No per-type /records calls. Every listed domain is returned with its status; Sync classifies active vs lapsed. */
const GD_API = 'https://api.godaddy.com/v1';
const GD_PAGE = 1000;
const NS_TTL_MS = 24 * 3600 * 1000;

function fetchGoDaddy_(props) {
  const key = props.getProperty('GODADDY_KEY'), sec = props.getProperty('GODADDY_SECRET');
  if (!key || !sec) fail_('Missing Script Property GODADDY_KEY / GODADDY_SECRET');
  const hdr = {Authorization: `sso-key ${key}:${sec}`, Accept: 'application/json'};

  const list = [];
  let marker = '';
  for (;;) {
    checkBudget_('GoDaddy list');
    const url = `${GD_API}/domains?limit=${GD_PAGE}&includes=nameServers` + (marker ? `&marker=${encodeURIComponent(marker)}` : '');
    const page = safeFetch_(url, hdr);
    if (!Array.isArray(page)) fail_('GoDaddy list returned non-array: ' + JSON.stringify(page).slice(0, 300));
    list.push(...page);
    if (page.length < GD_PAGE) break;
    marker = page[page.length - 1].domain;
  }

  const cache = nsCacheLoad_();
  const out = [];
  list.forEach(d => {
    const status = String(d.status || '');
    checkBudget_('GoDaddy ' + d.domain);
    let ns = (d.nameServers || []).map(s => String(s).toLowerCase());
    if (ns.length) cache[d.domain] = {t: Date.now(), ns};
    else if (LAPSED_STATUS.test(status)) ns = [];                 // no lookups for lapsed names
    else if (cache[d.domain] && Date.now() - cache[d.domain].t < NS_TTL_MS) ns = cache[d.domain].ns;
    else { ns = dohNS_(d.domain); cache[d.domain] = {t: Date.now(), ns}; }
    out.push({domain: d.domain.toLowerCase(), registrar: 'GoDaddy', status,
      expires: String(d.expires || '').slice(0, 10), autoRenew: d.renewAuto ? 'On' : 'Off',
      ns: ns.join(' ')});
  });
  nsCacheSave_(cache);
  return out;
}

/** 24h NS cache in PropertiesService (CacheService caps at 6h). One property, pruned. */
function nsCacheLoad_() {
  const raw = PropertiesService.getScriptProperties().getProperty('NS_CACHE');
  return raw ? JSON.parse(raw) : {};
}
function nsCacheSave_(c) {
  const now = Date.now();
  Object.keys(c).forEach(k => { if (now - c[k].t > NS_TTL_MS) delete c[k]; });
  const s = JSON.stringify(c);
  if (s.length > 9000) { console.warn('NS cache too large for one property; not saved'); return; }  // 9KB/value limit
  PropertiesService.getScriptProperties().setProperty('NS_CACHE', s);
}

function dohNS_(domain) {
  const body = safeFetch_(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=NS`, {});
  return (Array.isArray(body.Answer) ? body.Answer : []).map(a => String(a.data || '').replace(/\.$/, '').toLowerCase());
}

/** GET JSON with exponential backoff for 429/5xx and UrlFetch quota exceptions. Never returns silently on error. */
function safeFetch_(url, headers, attempt) {
  attempt = attempt || 0;
  const MAX = 5;
  const backoff = () => { const ms = Math.min(1000 * 2 ** attempt, 30000) + Math.floor(Math.random() * 500);
    checkBudget_('backoff ' + url); console.warn(`retry ${attempt + 1} in ${ms}ms: ${url}`); Utilities.sleep(ms);
    return safeFetch_(url, headers, attempt + 1); };
  let res;
  try {
    res = UrlFetchApp.fetch(url, {headers, muteHttpExceptions: true});
  } catch (e) {
    if (/quota|bandwidth|too many times|timeout|Address unavailable/i.test(String(e)) && attempt < MAX) return backoff();
    fail_(`Fetch failed for ${url.split('?')[0]}: ${e}`);
  }
  const code = res.getResponseCode();
  if ((code === 429 || code >= 500) && attempt < MAX) return backoff();
  if (code >= 300) fail_(`HTTP ${code} for ${url.split('?')[0]}: ${res.getContentText().slice(0, 300)}`);
  try { return JSON.parse(res.getContentText()); } catch (e) { fail_(`Bad JSON from ${url.split('?')[0]}: ${e}`); }
}
