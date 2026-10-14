# Domain inventory sync (Google Apps Script)

A live inventory of all of Josh's domains at GoDaddy and Namecheap, refreshed daily from both registrar APIs. Nothing is hardcoded, so a newly bought domain shows up on the next run.

## Tabs (created automatically in the bound spreadsheet)
- **Active Domains**: every active domain, sorted, with columns Domain, Registrar, Status, Expires, Auto-renew, Nameservers, Renewal ("Auto-renew" or "Will lapse on <date>"), First seen and Last seen. The last-synced time is in cell K1. Written with one `setValues`.
- **Lapsed Domains**: a domain moves here when its status becomes expired or cancelled, or when it disappears from both registrar lists. It keeps its last-known data plus the reason and a "Lapsed on" date, with one row per domain (no duplicates). Rows stay until the domain shows up again (renewed or re-registered), at which point it moves back to Active.
- **Sync Log**: one row per run with the result, active count, added, lapsed, restored, seconds and any error.

## Why the old script failed
The Oct 14 run died with `Bandwidth quota exceeded … /domains/speedbump.ws/records/AAAA`. The old code made about 15 web requests per domain (details, NS calls, six `/records` types, and 6–7 public DNS lookups), lapsed domains included, and its 24h cache was capped at 6h by Apps Script. The old code also hid errors, appended rows one at a time, and used UI alerts that break under triggers.

## Fixes
- **GoDaddy:** paged `/v1/domains?includes=nameServers` call, so nameservers come with the list. No per-type `/records` calls.
- **Namecheap:** paged `getList` call with `ListType=ALL`.
- **NS lookups:** public DNS lookup for NS only, and only for active GoDaddy domains with none. Results are cached for 24h in Script Properties.
- **Errors:** exponential backoff on 429, 5xx and quota errors. Every other error is thrown (run shows Failed, Sync Log records it) and never swallowed. No UI alerts.
- **Writes and timing:** fetch first, then write, with a 4-minute budget, so a slow or failed run never leaves a half-written tab. A lock prevents overlapping runs.

## Install (about 5 minutes)
1. Open the existing Apps Script project. Delete the old `godaddy.gs`, `namecheap.gs` and `Config.gs`, then add `Config.gs`, `Sync.gs`, `GoDaddyApi.gs` and `Namecheap.gs` from this folder.
2. Project Settings → Script Properties: keep `GODADDY_KEY`, `GODADDY_SECRET`, `NC_API_USER`, `NC_API_KEY`, `NC_CLIENT_IP`, `PROXY_URL` (and `PROXY_USER`/`PROXY_PASS` if used).
3. Triggers: delete the old 5:25 and 5:30 AM triggers, then add one daily time-driven trigger for `syncDomains`.
4. Run `syncDomains` once from the editor to authorize, then check the three tabs.
5. Optional: delete the old `GoDaddyDomains`, `NamecheapDomains` and `Missing-Data*` tabs once the new tabs look right.

Note: the first run has no history, so Lapsed only fills with domains the registrars still list as expired or cancelled. Domains that drop off the lists are caught on later runs.

## Automated deploy (no editor needed)
`.clasp.json` targets the bound project. `.github/workflows/clasp-push.yml` runs `clasp push --force` on every push to `main` using the `CLASPRC_JSON` repo secret. `Bootstrap.gs` keeps the existing 5:25 and 5:30 AM triggers working through shim functions, so manual step 3 above isn't needed. Script Properties already exist and stay as they are. See `/workspace/udv/automation-plan.md`.

## Namecheap proxy
`index.js`, `package.json` and `Dockerfile` (the "Domains Proxy" on Coolify) are unchanged and are not pushed to Apps Script (`.claspignore`).
