/**  CONFIG **************************************************************/
// const LIMITS = { NS:5, A:5, AAAA:5, CNAME:5, MX:5, TXT:5 };  // per-type columns // Moved to Config.gs
// const CORE   = [ // Moved to Config.gs as CORE_COL_GD
//  'Domain','TLD','Created','OwnershipDate','Expires','Locked',
//  'AutoRenew','Status','Privacy',
//  'Registrant First','Registrant Last','Registrant Email'
// ];
/*************************************************************************/

// const API_BASE='https://api.godaddy.com/v1'; // Moved to Config.gs as API_BASE_GD
// const LIST_PATH='/domains?includes=contacts,nameServers'; // Moved to Config.gs as LIST_PATH_GD
// const DETAIL_PATH='/domains/'; // Moved to Config.gs as DETAIL_PATH_GD
// const CACHE_TTL=24*3600; // Moved to Config.gs
// const BATCH_SLEEP=250; // Moved to Config.gs as BATCH_SLEEP_GD

/* ---------- build header row dynamically ---------- */
function buildHeaderGd(){ // Renamed from buildHeader to buildHeaderGd
  const hdr=[...CORE_COL_GD];
  Object.keys(LIMITS).forEach(t=>{
    for(let i=1;i<=LIMITS[t];i++) hdr.push(`${t}${i}`);
  });
  return hdr;
}

/* ---------- main entry ---------- */
function syncGoDaddySheet(){
  const props=PropertiesService.getScriptProperties(),
        key=props.getProperty('GODADDY_KEY'),
        sec=props.getProperty('GODADDY_SECRET');
  if(!key||!sec) throw new Error('Add GODADDY_KEY & GODADDY_SECRET.');

  const ss=SpreadsheetApp.getActiveSpreadsheet(),
        main=ensureSheet(ss,'GoDaddyDomains'),
        miss=ensureSheet(ss,'Missing-Data');
  main.clear(); main.appendRow(buildHeaderGd());

  const list=fetchJSON(API_BASE_GD+LIST_PATH_GD,key,sec),
        cache=CacheService.getScriptCache();
  let hits=0;

  list.forEach(d=>{
    /* detail (cached) */
    const det=getCached(cache,'det_',d.domain,
      ()=>safeFetch(`${API_BASE_GD}${DETAIL_PATH_GD}${d.domain}`,key,sec));

    /* nameservers (3-layer) */
    let ns=[...(det.nameServers||[]),...(d.nameServers||[])];
    if(!ns.length) ns=getCached(cache,'ns_',d.domain,
      ()=>safeFetch(`${API_BASE_GD}/domains/${d.domain}/nameServers`,key,sec));
    if(!ns.length) ns=zoneNS(d.domain,key,sec);
    if(!ns.length) ns=doh(domainNSQuery(d.domain));

    /* full DNS snapshot (cached) */
    const dns=getCached(cache,'dns_',d.domain,
      ()=>buildDNSForGoDaddy(d.domain,key,sec,ns.length));

    /* ---------- flatten to row ---------- */
    const reg=det.contactRegistrant||{},
          row=[ d.domain,
                d.domain.split('.').pop(),
                det.createdAt||d.createdAt||'',
                det.registrarCreatedAt||'',
                d.expires,d.locked,d.renewAuto,
                csv(d.status),d.privacy,
                reg.nameFirst||'',reg.nameLast||'',reg.email||'' ];

    Object.keys(LIMITS).forEach(t=>{
      for(let i=0;i<LIMITS[t];i++) row.push(dns[t][i]||'');
    });
    main.appendRow(row);

    /* ---------- gaps ---------- */
    const gaps=[];
    if(!ns.length) gaps.push('nameservers');
    if(!reg.email) gaps.push('registrant');
    if(!det.registrarCreatedAt) gaps.push('ownership');
    if(gaps.length) miss.appendRow([new Date(),d.domain,gaps.join(',')]);

    /* throttle */
    hits++; Utilities.sleep(BATCH_SLEEP_GD);
    if(hits%50===0) Utilities.sleep(1000);
  });
}

/* ---------- helpers ---------- */
function getCached(c,prefix,k,fn){
  const hit=c.get(prefix+k); if(hit) return JSON.parse(hit);
  const val=fn(); c.put(prefix+k,JSON.stringify(val),CACHE_TTL); return val;
}
function safeFetch(u,k,s,a=0){
  const res=UrlFetchApp.fetch(u,{headers:{'Authorization':`sso-key ${k}:${s}`,'Accept':'application/json'},muteHttpExceptions:true});
  const c=res.getResponseCode();
  if(c===429&&a<5){Utilities.sleep(500*(a+1));return safeFetch(u,k,s,a+1);}
  if(c>=300) return [];
  try{return JSON.parse(res.getContentText());}catch(e){return [];}
}
function zoneNS(d,k,s){
  const r=safeFetch(`${API_BASE_GD}/domains/${d}/records/NS/@`,k,s);
  return Array.isArray(r)?r.map(x=>x.data||x.value||x):[];
}
function doh(j){return j;}
function domainNSQuery(dom){return dohQuery(dom,'NS');}
function dohQuery(dom,t){
  const res=UrlFetchApp.fetch(`https://dns.google/resolve?name=${dom}&type=${t}`,{muteHttpExceptions:true});
  if(res.getResponseCode()>=300) return [];
  const body=JSON.parse(res.getContentText()),ans=Array.isArray(body.Answer)?body.Answer:[];
  return ans.map(a=>(a.data||'').replace(/\.$/,''));
}
function buildDNSForGoDaddy(dom,k,s,hasGD){
  const map={},types=Object.keys(LIMITS);types.forEach(t=>map[t]=[]);
  types.forEach(t=>{
    let arr=hasGD?safeFetch(`${API_BASE_GD}/domains/${dom}/records/${t}`,k,s):[];
    if(!Array.isArray(arr)||!arr.length) arr=dohQuery(dom,t);
    if(!Array.isArray(arr)) arr=[];
    map[t]=t==='MX'
      ?arr.map(r=>(r.data||r.exchange||'').replace(/\.$/,''))
      :arr.map(r=>(r.data||r.value||r).replace(/\.$/,''));
  });
  map.DMARC=map.TXT.filter(x=>/v=DMARC/i.test(x));
  map.DKIM =map.TXT.filter(x=>/v=DKIM/i.test(x)||/\bdomainkey\b/i.test(x));
  return map;
}
function fetchJSON(u,k,s){
  return JSON.parse(UrlFetchApp.fetch(u,{headers:{'Authorization':`sso-key ${k}:${s}`,'Accept':'application/json'}}));
}
function ensureSheet(ss,n){return ss.getSheetByName(n)||ss.insertSheet(n);}
function csv(v){return Array.isArray(v)?v.join(','):v||'';}

/* ---------- main entry point ---------- */
function main() {
  try {
    syncGoDaddySheet();
    console.log('GoDaddy sync completed successfully');
  } catch (error) {
    console.error('Error during GoDaddy sync:', error.toString());
    throw error;
  }
}