/** Domain inventory sync. Bound to the inventory spreadsheet.
 *  Script Properties: GODADDY_KEY, GODADDY_SECRET, NC_API_USER, NC_API_KEY, NC_CLIENT_IP, PROXY_URL,
 *  optional PROXY_USER / PROXY_PASS. No domain list is hardcoded: both registrars are fully listed every run. */
const TAB_ACTIVE = 'Active Domains';
const TAB_LAPSED = 'Lapsed Domains';
const TAB_LOG    = 'Sync Log';
const ACTIVE_HEADER = ['Domain','Registrar','Status','Expires','Auto-renew','Nameservers','Renewal','First seen','Last seen'];
const LAPSED_HEADER = ['Domain','Registrar','Last status','Expires','Auto-renew','Nameservers','Reason','First seen','Last seen','Lapsed on'];
const LOG_HEADER    = ['Run at','Result','Active','Added','Lapsed','Restored','Seconds','Error'];
const LAPSED_STATUS = /expired|cancel|delet|redemption|transferred_out|revoked|suspended/i;
const NC_PAGE_SIZE = 100;
const NC_PAUSE_MS  = 1500;
const TIME_BUDGET_MS = 4 * 60 * 1000;   // abort (without writing) well before the 6-min limit
