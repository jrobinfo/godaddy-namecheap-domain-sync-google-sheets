const LIMITS = { NS:5, A:5, AAAA:5, CNAME:5, MX:5, TXT:5 };
const CORE_COL_NC = [
  'Domain','TLD','Created','OwnershipDate','Expires','AutoRenew','Status','Privacy',
  'Registrant First','Registrant Last','Registrant Email'
];

const CORE_COL_GD = [
  'Domain','TLD','Created','OwnershipDate','Expires','Locked',
  'AutoRenew','Status','Privacy',
  'Registrant First','Registrant Last','Registrant Email'
];

const CACHE_TTL   = 24 * 3600;        // seconds
const CALL_PAUSE  = 1500;             // 40 calls/min  (< Namecheap 50 cap)

const API_BASE_GD='https://api.godaddy.com/v1';
const LIST_PATH_GD='/domains?includes=contacts,nameServers';
const DETAIL_PATH_GD='/domains/';
const BATCH_SLEEP_GD=250; 