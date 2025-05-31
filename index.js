import express from 'express';
import fetch from 'node-fetch';
import helmet from 'helmet';
import auth from 'basic-auth';

const app  = express();
const PORT = process.env.PORT || 3000;

/* --- optional Basic-Auth gate ----------------------------- */
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
app.use((req, res, next) => {
  if (!PROXY_USER) return next();           // auth disabled
  const creds = auth(req);
  if (creds && creds.name === PROXY_USER && creds.pass === PROXY_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="NC Proxy"');
  res.status(401).send('Authentication required.');
});

/* --- security headers & rate-limit stub ------------------- */
app.use(helmet());

/* --- single endpoint -------------------------------------- */
app.all('/nc', async (req, res) => {
  try {
    const qs  = req.method === 'GET' ? req.url.split('?')[1] : await req.text();
    const url = 'https://api.namecheap.com/xml.response';
    const nc  = await fetch(`${url}?${qs}`, { method: 'GET' });
    const xml = await nc.text();
    res.status(nc.status).set('Content-Type', 'application/xml').send(xml);
  } catch (e) {
    console.error(e);
    res.status(502).send('Upstream error');
  }
});

app.listen(PORT, () => console.log(`NC proxy on ${PORT}`));