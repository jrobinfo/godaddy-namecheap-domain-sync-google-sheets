/** Zero-touch migration. Josh's existing installable triggers call syncNamecheapSheet (5:25 AM ET)
 *  and syncGoDaddySheet (5:30 AM ET). After `clasp push` replaces the old files, these shims keep
 *  those triggers working, so no editor visit, no new trigger and no new OAuth scope is needed.
 *  (Creating or deleting triggers would need the script.scriptapp scope, which forces a re-consent.) */
function syncNamecheapSheet() { syncDomains(); }

function syncGoDaddySheet() {
  // The 5:25 run already synced both registrars; only run again if it didn't succeed in the last 2h.
  const last = Number(PropertiesService.getScriptProperties().getProperty('LAST_OK_MS') || 0);
  if (Date.now() - last < 2 * 3600 * 1000) { console.log('Skipping: synced at ' + new Date(last)); return; }
  syncDomains();
}
