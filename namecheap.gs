/***** CONFIG *****************************************************************/
const LIMITS   = { NS:5, A:5, AAAA:5, CNAME:5, MX:5, TXT:5 };
const CORE_COL = [
  'Domain','TLD','Created','OwnershipDate','Expires','AutoRenew','Status','Privacy',
  'Registrant First','Registrant Last','Registrant Email'
];
const CACHE_TTL   = 24 * 3600;        // seconds
const CALL_PAUSE  = 1500;             // 40 calls/min  (< Namecheap 50 cap)
/******************************************************************************/

/* ------------- dynamic header ----------- */
function headerRow(){
  const hdr=[...CORE_COL];
  for (const t in LIMITS) for (let i=1;i<=LIMITS[t];i++) hdr.push(`${t}${i}`);
  return hdr;
}

/* ------------- ENTRY -------------------- */
function syncNamecheapSheet(){
  const p        = PropertiesService.getScriptProperties();
  const NCU      = p.getProperty('NC_API_USER');
  const NCK      = p.getProperty('NC_API_KEY');
  const IP       = p.getProperty('NC_CLIENT_IP');
  const PROXY    = p.getProperty('PROXY_URL');
  const PUSER    = p.getProperty('PROXY_USER');
  const PPASS    = p.getProperty('PROXY_PASS');
  if (!NCU||!NCK||!IP||!PROXY) throw new Error('Missing required Script Properties.');

  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const main     = sheet(ss,'NamecheapDomains');
  const miss     = sheet(ss,'Missing-Data (NC)');
  main.clear(); main.appendRow(headerRow());

  /* 1️⃣  grab domain list */
  const listXML  = ncCall(PROXY,{ApiUser:NCU,ApiKey:NCK,UserName:NCU,ClientIp:IP,
                                 Command:'namecheap.domains.getList',PageSize:100},
                                 PUSER,PPASS);
  const domains  = xList(listXML,'DomainGetListResult','Domain');

  const cache    = CacheService.getScriptCache();
  let calls=0;

  domains.forEach(d=>{
    const name = attr(d,'Name'), parts=name.split('.');
    const SLD  = parts.slice(0,-1).join('.'), TLD=parts.slice(-1)[0];

    /* 2️⃣  registrar + contacts (cached) */
    const info   = cacheXML(cache,'i_'+name,()=>ncCall(PROXY,{
                     ApiUser:NCU,ApiKey:NCK,UserName:NCU,ClientIp:IP,
                     Command:'namecheap.domains.getInfo',DomainName:name
                   },PUSER,PPASS));

    const infoRes= xFirst(info,'DomainGetInfoResult');
    const regDet = infoRes.getChild('DomainDetails',ncNS());
    const nsArr  = xListText(regDet,'Nameservers','Nameserver');

    const cData  = infoRes.getChild('ContactData',ncNS());
    const regFirst = xText(cData,'RegFirstName'),
          regLast  = xText(cData,'RegLastName'),
          regEmail = xText(cData,'RegEmailAddress');

    /* 3️⃣  DNS zone (cached) */
    const zone   = cacheXML(cache,'z_'+name,()=>ncCall(PROXY,{
                     ApiUser:NCU,ApiKey:NCK,UserName:NCU,ClientIp:IP,
                     Command:'namecheap.domains.dns.getHosts',SLD:SLD,TLD:TLD
                   },PUSER,PPASS));
    const hosts  = xList(zone,'DomainDNSGetHostsResult','host');
    const dns    = buildDNS(nsArr,hosts);

    /* 4️⃣  write row */
    const row=[ name,TLD,
                xText(regDet,'CreatedDate'),
                xText(regDet,'CreatedDate'),                 // Namecheap has no transfer date
                xText(regDet,'ExpiredDate'),
                attr(d,'AutoRenew'), attr(d,'Status'),
                attr(d,'IsExpired')==='true'?'Expired':'Active',
                regFirst,regLast,regEmail ];
    for (const t in LIMITS){
      for(let i=0;i<LIMITS[t];i++) row.push(dns[t][i]||'');
    }
    main.appendRow(row);

    /* 5️⃣  gap log */
    const gaps=[];
    if(!dns.NS.length) gaps.push('nameservers');
    if(!regEmail)      gaps.push('registrant');
    if(gaps.length)    miss.appendRow([new Date(),name,gaps.join(',')]);

    Utilities.sleep(CALL_PAUSE); calls++;
  });
}

/* ======== helper: proxy call with Basic-Auth & HTTPS only ============== */
function ncCall(proxy,params,user,pass){
  const qs   = Object.keys(params).map(k=>k+'='+encodeURIComponent(params[k])).join('&');
  const url  = proxy+'?'+qs;                    // HTTPS enforced in property value
  const hdrs = { 'Authorization':'Basic '+Utilities.base64Encode(user+':'+pass),
                 'User-Agent':'AppsScript-NC-Proxy' };
  const res  = UrlFetchApp.fetch(url,{method:'get',followRedirects:true,headers:hdrs});
  return XmlService.parse(res.getContentText());
}

/* ======== XML convenience wrappers ==================================== */
function ncNS(){return XmlService.getNamespace('http://api.namecheap.com/xml.response');}
function xFirst(xml,tag){return xml.getRootElement().getChild('CommandResponse',ncNS())
                                             .getChild(tag,ncNS());}
function xList(xml,parentTag,itemTag){return xFirst(xml,parentTag).getChildren(itemTag,ncNS());}
function xListText(parent,parentTag,itemTag){
  const arr = parent.getChild(parentTag,ncNS()).getChildren(itemTag,ncNS());
  return arr.map(e=>e.getText());
}
function xText(parent,tag){const e=parent.getChild(tag,ncNS()); return e?e.getText():'';}
function attr(el,name){return el.getAttribute(name).getValue();}
function cacheXML(c,key,fn){const hit=c.get(key); if(hit)return XmlService.parse(hit);
  const xml=fn();c.put(key,XmlService.getRawFormat().format(xml),CACHE_TTL);return xml;}

/* ======== DNS array builder =========================================== */
function buildDNS(nsArr,hosts){
  const map={NS:nsArr.slice(0),A:[],AAAA:[],CNAME:[],MX:[],TXT:[]};
  hosts.forEach(h=>{
    const t = h.getAttribute('Type').getValue();
    const d = h.getAttribute('Address').getValue();
    if(t==='MX') map.MX.push(h.getAttribute('MXPref').getValue()+' '+d);
    else if(map[t]) map[t].push(d);
  });
  return map;
}

/* ======== sheet utility =============================================== */
function sheet(ss,n){return ss.getSheetByName(n)||ss.insertSheet(n);}