/***** CONFIG *****************************************************************/
// const LIMITS   = { NS:5, A:5, AAAA:5, CNAME:5, MX:5, TXT:5 }; // Moved to Config.gs
// const CORE_COL = [ // Moved to Config.gs as CORE_COL_NC
//  'Domain','TLD','Created','OwnershipDate','Expires','AutoRenew','Status','Privacy',
//  'Registrant First','Registrant Last','Registrant Email'
// ];
// const CACHE_TTL   = 24 * 3600;        // seconds // Moved to Config.gs
// const CALL_PAUSE  = 1500;             // 40 calls/min  (< Namecheap 50 cap) // Moved to Config.gs
/******************************************************************************/

/* ------------- dynamic header ----------- */
function headerRowNc(){ // Fixed: was headerRow, but called as headerRowNc
  const hdr=[...CORE_COL_NC];
  for (const t in LIMITS) for (let i=1;i<=LIMITS[t];i++) hdr.push(`${t}${i}`);
  return hdr;
}

/* ------------- ENTRY -------------------- */
function syncNamecheapSheet(){
  Logger.log('Starting syncNamecheapSheet');
  const p        = PropertiesService.getScriptProperties();
  const NCU      = p.getProperty('NC_API_USER');
  const NCK      = p.getProperty('NC_API_KEY');
  const IP       = p.getProperty('NC_CLIENT_IP');
  const PROXY    = p.getProperty('PROXY_URL');
  const PUSER    = p.getProperty('PROXY_USER');
  const PPASS    = p.getProperty('PROXY_PASS');

  Logger.log(`NCU: ${NCU}, NCK: exists=${!!NCK}, IP: ${IP}, PROXY: ${PROXY}, PUSER: ${PUSER}, PPASS: exists=${!!PPASS}`);

  if (!NCU||!NCK||!IP||!PROXY) { // Removed PUSER and PPASS from required check
    const errMsg = 'Missing required Script Properties. Ensure NC_API_USER, NC_API_KEY, NC_CLIENT_IP, and PROXY_URL are set.';
    Logger.log(errMsg);
    SpreadsheetApp.getUi().alert(errMsg);
    throw new Error(errMsg);
  }

  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('getActiveSpreadsheet successful.');
  const main     = sheet(ss,'NamecheapDomains');
  Logger.log("Main sheet 'NamecheapDomains' object: " + (main ? main.getName() : 'null'));
  const miss     = sheet(ss,'Missing-Data (NC)');
  Logger.log("Miss sheet 'Missing-Data (NC)' object: " + (miss ? miss.getName() : 'null'));

  main.clear(); 
  main.appendRow(headerRowNc());
  Logger.log('Main sheet cleared and header row appended.');

  /* 1️⃣  grab domain list */
  Logger.log('Calling ncCall for domain list...');
  const listXML  = ncCall(PROXY,{ApiUser:NCU,ApiKey:NCK,UserName:NCU,ClientIp:IP,
                                 Command:'namecheap.domains.getList',PageSize:100},
                                 PUSER,PPASS);
  
  if (!listXML) {
    Logger.log('ncCall returned null or undefined. Aborting.');
    return;
  }
  Logger.log('ncCall for domain list completed.');

  const domains  = xList(listXML,'DomainGetListResult','Domain');
  Logger.log(`Found ${domains.length} domains.`);

  if (domains.length === 0) {
    Logger.log('No domains found. Check ncCall logs and API response. Script will exit.');
    return;
  }

  const cache    = CacheService.getScriptCache();
  let calls=0;

  domains.forEach(d=>{
    Logger.log(`Processing domain: ${attr(d,'Name')}`);
    const name = attr(d,'Name'), parts=name.split('.');
    const SLD  = parts.slice(0,-1).join('.'), TLD=parts.slice(-1)[0];

    /* 2️⃣  registrar + contacts (cached) */
    Logger.log(`Getting info for domain ${name}...`);
    const info   = cacheXML(cache,'i_'+name,()=>{
      Logger.log(`Making API call for domain info: ${name}`);
      return ncCall(PROXY,{
        ApiUser:NCU,ApiKey:NCK,UserName:NCU,ClientIp:IP,
        Command:'namecheap.domains.getInfo',DomainName:name
      },PUSER,PPASS);
    });

    if (!info) {
      Logger.log(`Failed to get info for domain ${name}. Skipping.`);
      miss.appendRow([new Date(),name,'Failed to get domain info']);
      return; // Skip this domain
    }

    Logger.log(`Got info response for ${name}, parsing...`);
    const infoRes= xFirst(info,'DomainGetInfoResult');
    if (!infoRes) {
      Logger.log(`Invalid info response structure for domain ${name}. Skipping.`);
      // Log the raw XML structure to debug
      try {
        const root = info.getRootElement();
        Logger.log(`Root element: ${root.getName()}`);
        const children = root.getChildren();
        Logger.log(`Root children: ${children.map(c => c.getName()).join(', ')}`);
      } catch(e) {
        Logger.log(`Error inspecting XML: ${e.toString()}`);
      }
      miss.appendRow([new Date(),name,'Invalid info response']);
      return; // Skip this domain
    }

    // Debug: log structure of DomainGetInfoResult
    try {
      const infoChildren = infoRes.getChildren();
      Logger.log(`DomainGetInfoResult children for ${name}: ${infoChildren.map(c => c.getName()).join(', ')}`);
      
      // Check if Whoisguard has the contact info
      const whoisguard = infoRes.getChild('Whoisguard', ncNS());
      if (whoisguard) {
        const wgChildren = whoisguard.getChildren();
        Logger.log(`Whoisguard children: ${wgChildren.map(c => c.getName()).join(', ')}`);
      }
      
      // Check if contact info is at a different level
      const modContact = infoRes.getChild('Modcontact', ncNS());
      if (modContact) {
        Logger.log(`Found Modcontact element`);
      }
    } catch(e) {
      Logger.log(`Error debugging XML structure: ${e.toString()}`);
    }

    const regDet = infoRes.getChild('DomainDetails',ncNS());
    if (!regDet) {
      Logger.log(`No DomainDetails found for ${name}`);
    } else {
      // Debug: Check for nameservers in DomainDetails
      const detChildren = regDet.getChildren();
      Logger.log(`DomainDetails children: ${detChildren.map(c => c.getName()).join(', ')}`);
    }
    
    const nsArr  = regDet ? xListText(regDet,'Nameservers','Nameserver') : [];
    Logger.log(`Nameservers for ${name}: ${nsArr.join(', ') || 'none'}`);
    
    // If no nameservers found in DomainDetails, check other locations
    let finalNsArr = nsArr;
    if (!finalNsArr.length) {
      // Try directly under DomainGetInfoResult
      const dnsDetails = infoRes.getChild('DnsDetails', ncNS());
      if (dnsDetails) {
        Logger.log(`Found DnsDetails element for ${name}`);
        finalNsArr = xListText(dnsDetails, 'Nameservers', 'Nameserver');
        if (!finalNsArr.length) {
          // Try without parent wrapper
          const nsElements = dnsDetails.getChildren('Nameserver', ncNS());
          finalNsArr = nsElements.map(e => e.getText());
        }
      }
      
      // Also check if using default DNS
      const providerType = dnsDetails ? xText(dnsDetails, 'ProviderType') : '';
      const isUsingNC = dnsDetails ? xText(dnsDetails, 'IsUsingOurDNS') : '';
      Logger.log(`DNS Provider for ${name}: ${providerType}, Using NC DNS: ${isUsingNC}`);
    }

    // Fetch contacts using the new dedicated function
    Logger.log(`Fetching contacts for ${name} using getDomainContacts...`);
    const contactsXml = getDomainContacts(cache, name, PROXY, NCU, NCK, IP, PUSER, PPASS);
    let regFirst = '', regLast = '', regEmail = '';

    if (contactsXml) {
      const contactsRes = xFirst(contactsXml, 'DomainContactsGetResult');
      if (contactsRes) {
        const registrant = contactsRes.getChild('Registrant', ncNS());
        if (registrant) {
          regFirst = xText(registrant, 'FirstName');
          regLast  = xText(registrant, 'LastName');
          regEmail = xText(registrant, 'EmailAddress');
        } else {
          Logger.log(`No Registrant found in DomainContactsGetResult for ${name}`);
        }
      } else {
        Logger.log(`No DomainContactsGetResult found for ${name}`); 
      }
    } else {
      Logger.log(`Failed to get contacts XML for domain ${name}.`);
      miss.appendRow([new Date(), name, 'Failed to get domain contacts']);
      // Decide if you want to return or continue with empty contact details
    }
    Logger.log(`Registrant for ${name}: ${regFirst} ${regLast} <${regEmail}>`);

    /* 3️⃣  DNS zone (cached) */
    Logger.log(`Getting DNS zone for domain ${name} (SLD: ${SLD}, TLD: ${TLD})...`);
    const zone   = cacheXML(cache,'z_'+name,()=>{
      Logger.log(`Making API call for DNS hosts: ${name}`);
      return ncCall(PROXY,{
        ApiUser:NCU,ApiKey:NCK,UserName:NCU,ClientIp:IP,
        Command:'namecheap.domains.dns.getHosts',SLD:SLD,TLD:TLD
      },PUSER,PPASS);
    });
    
    const hosts  = zone ? xList(zone,'DomainDNSGetHostsResult','host') : [];
    Logger.log(`DNS hosts for ${name}: ${hosts.length} records found`);
    const dns    = buildDNSWithFallback(name, finalNsArr, hosts);

    /* 4️⃣  write row */
    const row=[ name,TLD,
                xText(regDet,'CreatedDate'),
                xText(regDet,'CreatedDate'),                 // Namecheap has no transfer date
                xText(regDet,'ExpiredDate'),
                attr(d,'AutoRenew'), 
                attr(d,'IsExpired')==='true'?'Expired':'Active',  // Status
                attr(d,'WhoisGuard')==='ENABLED'?'Enabled':'Disabled',  // Privacy (WhoisGuard)
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
  Logger.log(`ncCall: Requesting URL: ${url}`)
  Logger.log(`ncCall: Query params: ${JSON.stringify(params)}`);
  
  const hdrs = { 'User-Agent':'AppsScript-NC-Proxy' };
  
  // Only add Authorization header if credentials are provided
  if (user && pass) {
    hdrs['Authorization'] = 'Basic '+Utilities.base64Encode(user+':'+pass);
  }
  
  Logger.log(`ncCall: Headers: ${JSON.stringify(hdrs)}`);
  
  let res;
  try {
    res = UrlFetchApp.fetch(url,{method:'get',followRedirects:true,headers:hdrs, muteHttpExceptions: true}); // Added muteHttpExceptions
    const responseCode = res.getResponseCode();
    const responseText = res.getContentText();
    Logger.log(`ncCall: Response Code: ${responseCode}`);
    Logger.log(`ncCall: Response Text: ${responseText}`);

    if (responseCode !== 200) {
      Logger.log(`ncCall: Error - received HTTP ${responseCode}. Check proxy logs and Namecheap API documentation.`);
      SpreadsheetApp.getUi().alert(`Error calling Namecheap proxy: HTTP ${responseCode}. Response: ${responseText.substring(0,500)}`);
      return null; // Indicate failure
    }
    return XmlService.parse(responseText);
  } catch (e) {
    Logger.log(`ncCall: Exception during fetch or XML parsing: ${e.toString()}`);
    Logger.log(`ncCall: URL attempted: ${url}`);
    if(res) { // if res exists, log details even in catch
        Logger.log(`ncCall: Exception Response Code (if available): ${res.getResponseCode()}`);
        Logger.log(`ncCall: Exception Response Text (if available): ${res.getContentText().substring(0,1000)}`);
    }
    SpreadsheetApp.getUi().alert(`Exception during Namecheap call: ${e.toString()}. Check logs.`);
    return null; // Indicate failure
  }
}

/* ======== XML convenience wrappers ==================================== */
function ncNS(){return XmlService.getNamespace('http://api.namecheap.com/xml.response');}
function xFirst(xml,tag){
  try {
    return xml.getRootElement().getChild('CommandResponse',ncNS())
                                .getChild(tag,ncNS());
  } catch(e) {
    Logger.log(`xFirst error for tag ${tag}: ${e.toString()}`);
    return null;
  }
}
function xList(xml,parentTag,itemTag){
  const parent = xFirst(xml,parentTag);
  return parent ? parent.getChildren(itemTag,ncNS()) : [];
}
function xListText(parent,parentTag,itemTag){
  const parentEl = parent.getChild(parentTag,ncNS());
  if (!parentEl) {
    Logger.log(`xListText: Parent element '${parentTag}' not found`);
    return [];
  }
  const arr = parentEl.getChildren(itemTag,ncNS());
  return arr.map(e=>e.getText());
}
function xText(parent,tag){const e=parent.getChild(tag,ncNS()); return e?e.getText():'';}
function attr(el,name){
  const attribute = el.getAttribute(name);
  return attribute ? attribute.getValue() : '';
}
function cacheXML(c,key,fn){
  const hit=c.get(key); 
  if(hit) return XmlService.parse(hit);
  
  const xml=fn();
  if (!xml) {
    Logger.log(`cacheXML: Function returned null for key ${key}`);
    return null; // Don't cache null results
  }
  
  c.put(key,XmlService.getRawFormat().format(xml),CACHE_TTL);
  return xml;
}

/* ======== helper: get domain contacts =============================== */
function getDomainContacts(cache, name, PROXY, NCU, NCK, IP, PUSER, PPASS) {
  Logger.log(`getDomainContacts: Fetching contacts for ${name}`);
  return cacheXML(cache, 'c_' + name, () => {
    Logger.log(`getDomainContacts: Making API call for contacts: ${name}`);
    return ncCall(PROXY, {
      ApiUser: NCU,
      ApiKey:  NCK,
      UserName: NCU, // Assuming UserName is the same as ApiUser for this call
      ClientIp: IP,
      Command: 'namecheap.domains.getContacts',
      DomainName: name
    }, PUSER, PPASS);
  });
}

/* ======== DNS array builder =========================================== */
function buildDNS(nsArr, hosts) {
  const map = { NS: nsArr.slice(0), A: [], AAAA: [], CNAME: [], MX: [], TXT: [] };

  for (var i = 0; i < (hosts ? hosts.length : 0); i++) {
    const h = hosts[i];
    const t = h.getAttribute('Type').getValue();
    const d = h.getAttribute('Address').getValue();
    if (t === 'MX') {
      map.MX.push(h.getAttribute('MXPref').getValue() + ' ' + d);
    } else if (map[t]) {
      map[t].push(d);
    }
  }

  return map;
}

/* ======== DNS over HTTPS (DoH) queries ================================ */
function dohQuery(domain, recordType) {
  try {
    Logger.log(`DoH query for ${domain} type ${recordType}`);
    const res = UrlFetchApp.fetch(
      `https://dns.google/resolve?name=${domain}&type=${recordType}`,
      {muteHttpExceptions: true}
    );
    
    if (res.getResponseCode() >= 300) {
      Logger.log(`DoH query failed with status ${res.getResponseCode()}`);
      return [];
    }
    
    const body = JSON.parse(res.getContentText());
    const answers = Array.isArray(body.Answer) ? body.Answer : [];
    
    if (recordType === 'NS') {
      return answers.map(a => (a.data || '').replace(/\.$/, ''));
    } else if (recordType === 'MX') {
      return answers.map(a => `${a.preference || '10'} ${(a.exchange || a.data || '').replace(/\.$/, '')}`);
    } else {
      return answers.map(a => (a.data || '').replace(/\.$/, ''));
    }
  } catch(e) {
    Logger.log(`DoH query error: ${e.toString()}`);
    return [];
  }
}

/* ======== Enhanced DNS builder with DoH fallback ====================== */
function buildDNSWithFallback(domain, nsArr, hosts) {
  const map = { NS: nsArr.slice(0), A: [], AAAA: [], CNAME: [], MX: [], TXT: [] };

  // First, process hosts from Namecheap API
  for (var i = 0; i < (hosts ? hosts.length : 0); i++) {
    const h = hosts[i];
    try {
      if (i === 0) {
        const attrs = h.getAttributes();
        Logger.log(`Host element attributes: ${attrs.map(a => a.getName()).join(', ')}`);
      }

      const type = attr(h, 'Type') || attr(h, 'RecordType') || '';
      const address = attr(h, 'Address') || attr(h, 'Value') || attr(h, 'Data') || '';
      const mxPref = attr(h, 'MXPref') || attr(h, 'Priority') || '10';
      const hostName = attr(h, 'Name') || attr(h, 'HostName') || '';

      Logger.log(`Host record: Type=${type}, Address=${address}, Name=${hostName}`);

      if (type === 'MX' && address) {
        map.MX.push(`${mxPref} ${address}`);
      } else if (type === 'CNAME' && address) {
        map.CNAME.push(address);
      } else if (type && map[type] && address) {
        map[type].push(address);
      }
    } catch (e) {
      Logger.log(`Error processing host record: ${e.toString()}`);
    }
  }
  
  // If no nameservers from API, query via DoH
  if (!map.NS.length) {
    Logger.log(`No NS records from API for ${domain}, querying via DoH`);
    map.NS = dohQuery(domain, 'NS');
  }
  
  // For each record type, if empty, try DoH
  const recordTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'];
  recordTypes.forEach(type => {
    if (!map[type].length) {
      Logger.log(`No ${type} records from API for ${domain}, querying via DoH`);
      map[type] = dohQuery(domain, type);
    }
  });
  
  return map;
}

/* ======== sheet utility =============================================== */
function sheet(ss,n){return ss.getSheetByName(n)||ss.insertSheet(n);}
