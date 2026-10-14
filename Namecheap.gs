function fetchNamecheap_(props) {
  const p = k => props.getProperty(k);
  ['NC_API_USER','NC_API_KEY','NC_CLIENT_IP','PROXY_URL'].forEach(k => { if (!p(k)) fail_('Missing Script Property ' + k); });
  const ns = XmlService.getNamespace('http://api.namecheap.com/xml.response');
  const out = [];
  for (let page = 1; ; page++) {
    const xml = ncCall_(p, {Command: 'namecheap.domains.getList', ListType: 'ALL', PageSize: NC_PAGE_SIZE, Page: page});
    const res = xml.getRootElement().getChild('CommandResponse', ns);
    res.getChild('DomainGetListResult', ns).getChildren('Domain', ns).forEach(d => {
      const a = n => (d.getAttribute(n) || {getValue: () => ''}).getValue();
      const exp = a('Expires'); // MM/DD/YYYY
      const m = exp.match(/(\d+)\/(\d+)\/(\d+)/);
      out.push({domain: a('Name').toLowerCase(), registrar: 'Namecheap',
        status: a('IsExpired') === 'true' ? 'Expired' : 'Active',
        expires: m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : exp,
        autoRenew: a('AutoRenew') === 'true' ? 'On' : 'Off', ns: ''});
    });
    const paging = res.getChild('Paging', ns);
    const total = Number(paging.getChildText('TotalItems', ns));
    if (page * NC_PAGE_SIZE >= total) break;
    checkBudget_('Namecheap page ' + page);
    Utilities.sleep(NC_PAUSE_MS);
  }
  return out;
}

function ncCall_(p, params) {
  Object.assign(params, {ApiUser: p('NC_API_USER'), ApiKey: p('NC_API_KEY'), UserName: p('NC_API_USER'), ClientIp: p('NC_CLIENT_IP')});
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const headers = {};
  if (p('PROXY_USER') && p('PROXY_PASS')) headers.Authorization = 'Basic ' + Utilities.base64Encode(p('PROXY_USER') + ':' + p('PROXY_PASS'));
  const res = UrlFetchApp.fetch(p('PROXY_URL') + '?' + qs, {headers, muteHttpExceptions: true});
  const code = res.getResponseCode(), body = res.getContentText();
  if (code !== 200) fail_(`Namecheap proxy HTTP ${code}: ${body.slice(0, 300)}`);
  if (/Status="ERROR"/.test(body)) fail_('Namecheap API error (check IP allowlist / key): ' + body.slice(0, 500));
  return XmlService.parse(body);   // key never logged
}
