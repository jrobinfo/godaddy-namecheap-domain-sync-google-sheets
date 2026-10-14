/** Daily entry point (one time-driven trigger). */
const START_MS = Date.now();
function checkBudget_(stage) {
  if (Date.now() - START_MS > TIME_BUDGET_MS) fail_('Time budget exceeded at ' + stage + '; nothing written');
}
function fail_(msg) { console.error(msg); throw new Error(msg); }   // no UI alerts: safe under triggers

function syncDomains() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('Another sync is still running');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const counts = syncAll_(ss);
    PropertiesService.getScriptProperties().setProperty('LAST_OK_MS', String(Date.now()));
    logRun_(ss, ['OK', counts.active, counts.added, counts.lapsed, counts.restored, '']);
  } catch (e) {
    try { logRun_(ss, ['FAILED', '', '', '', '', String(e)]); } catch (_) {}
    throw e;                                         // run shows as Failed in Executions
  } finally { lock.releaseLock(); }
}

function syncAll_(ss) {
  const props = PropertiesService.getScriptProperties();
  // 1) fetch everything first; any error throws and nothing is written
  const fetched = [...fetchNamecheap_(props), ...fetchGoDaddy_(props)];
  checkBudget_('before write');

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const activeSh = tab_(ss, TAB_ACTIVE), lapsedSh = tab_(ss, TAB_LAPSED);
  const prevActive = readTable_(activeSh, ACTIVE_HEADER.length);
  const prevLapsed = readTable_(lapsedSh, LAPSED_HEADER.length);

  const active = {}, lapsed = Object.assign({}, prevLapsed);
  let added = 0, lapsedNow = 0, restored = 0;

  fetched.forEach(r => {
    const d = r.domain;
    if (LAPSED_STATUS.test(r.status) || /^expired$/i.test(r.status)) {
      if (!lapsed[d]) { lapsedNow++; }
      const p = prevActive[d] || lapsed[d] || [];
      lapsed[d] = [d, r.registrar, r.status, r.expires, r.autoRenew, r.ns || p[5] || '',
                   'Status ' + r.status, p[7] || today, p[8] || today, (lapsed[d] && lapsed[d][9]) || today];
      return;
    }
    if (lapsed[d]) { restored++; delete lapsed[d]; }
    else if (!prevActive[d]) added++;
    const first = (prevActive[d] && prevActive[d][7]) || (prevLapsed[d] && prevLapsed[d][7]) || today;
    active[d] = [d, r.registrar, r.status, r.expires, r.autoRenew, r.ns, renewal_(r), first, today];
  });

  // domains that vanished from both registrar lists -> Lapsed with last-known data
  Object.keys(prevActive).forEach(d => {
    if (active[d] || lapsed[d]) return;
    const p = prevActive[d];
    lapsed[d] = [d, p[1], p[2], p[3], p[4], p[5], 'Not in registrar list', p[7], p[8], today];
    lapsedNow++;
  });

  // 2) one setValues per tab
  writeTable_(activeSh, ACTIVE_HEADER, Object.values(active), 'Last synced ' + new Date().toISOString());
  writeTable_(lapsedSh, LAPSED_HEADER, Object.values(lapsed), '');
  return {active: Object.keys(active).length, added, lapsed: lapsedNow, restored};
}

function renewal_(r) {
  return /^(on|true|yes)$/i.test(String(r.autoRenew)) ? 'Auto-renew' : 'Will lapse on ' + (r.expires || '?');
}

function tab_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function readTable_(sh, width) {
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues()
    .forEach(r => { const d = String(r[0]).trim().toLowerCase(); if (d) out[d] = r.map(String); });
  return out;   // keyed by domain = dedup
}

function writeTable_(sh, header, rows, note) {
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const data = [header, ...rows];
  sh.getRange(1, 1, sh.getMaxRows(), header.length + 2).clearContent();
  sh.getRange(1, 1, data.length, header.length).setValues(data);
  if (note) sh.getRange(1, header.length + 2).setValue(note);
  sh.setFrozenRows(1);
}

function logRun_(ss, vals) {
  const sh = tab_(ss, TAB_LOG);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]);
  const secs = Math.round((Date.now() - START_MS) / 1000);
  sh.getRange(sh.getLastRow() + 1, 1, 1, LOG_HEADER.length)
    .setValues([[new Date(), vals[0], vals[1], vals[2], vals[3], vals[4], secs, vals[5]]]);
}
