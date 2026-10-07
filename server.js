const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./lib/store');
const flexpay = require('./lib/flexpay');

const PORT = process.env.PORT || 3000;
const PRICE = Number(process.env.TICKET_PRICE || 1000);
const CURRENCY = process.env.TICKET_CURRENCY || 'CDF';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD + '-secret';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

if (!process.env.FLEXPAY_TOKEN) console.warn('⚠ FLEXPAY_TOKEN manquant (voir .env.example)');
if (!ADMIN_PASSWORD) console.warn('⚠ ADMIN_PASSWORD manquant : la page admin est désactivée');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const baseUrl = req => BASE_URL || `${req.protocol}://${req.get('host')}`;

// ---------- Anti-abus simple ----------
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans un instant.' });
    arr.push(now); hits.set(k, arr); next();
  };
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (/^243\d{9}$/.test(d)) return d;
  if (/^0\d{9}$/.test(d)) return '243' + d.slice(1);
  if (/^\d{9}$/.test(d)) return '243' + d;
  return null;
}

// ---------- Client ----------
app.get('/api/info', (req, res) => {
  res.json({ price: PRICE, currency: CURRENCY, available: store.available() });
});

app.post('/api/pay', rateLimit(6, 60 * 1000), async (req, res) => {
  const method = req.body.method === 'card' ? 'card' : 'mobile';
  const phone = normalizePhone(req.body.phone);
  if (method === 'mobile' && !phone) return res.status(400).json({ error: 'Numéro invalide. Exemple : 0812345678' });
  if (store.available() <= 0) return res.status(409).json({ error: 'Plus de tickets disponibles pour le moment.' });

  const ref = 'WIFI' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
  const order = store.createOrder({
    ref, method, phone: phone || null, amount: PRICE, currency: CURRENCY,
    status: 'pending', orderNumber: null, code: null, createdAt: Date.now()
  });

  try {
    if (method === 'mobile') {
      const r = await flexpay.payMobile({
        phone, reference: ref, amount: PRICE, currency: CURRENCY,
        callbackUrl: baseUrl(req) + '/api/flexpay/callback'
      });
      if (String(r.code) !== '0') throw new Error(r.message || 'Paiement refusé');
      order.orderNumber = r.orderNumber;
      store.save();
      return res.json({ ref, method });
    }
    const r = await flexpay.payCard({
      reference: ref, amount: PRICE, currency: CURRENCY,
      description: 'Ticket WiFi 24h', baseUrl: baseUrl(req)
    });
    if (String(r.code) !== '0' || !r.url) throw new Error(r.message || 'Paiement carte indisponible');
    order.orderNumber = r.orderNumber || null;
    store.save();
    return res.json({ ref, method, url: r.url });
  } catch (e) {
    order.status = 'failed';
    store.save();
    return res.status(502).json({ error: String(e.message || e) });
  }
});

// Vérifie auprès de FlexPay puis délivre le code (jamais sur simple confiance au client)
async function refreshOrder(order) {
  if (order.status === 'pending' && order.orderNumber) {
    const s = await flexpay.checkOrder(order.orderNumber);
    if (s === 'paid') { order.status = 'paid'; order.paidAt = Date.now(); store.save(); }
    else if (s === 'failed') { order.status = 'failed'; store.save(); }
    else if (Date.now() - order.createdAt > 30 * 60 * 1000) { order.status = 'failed'; store.save(); }
  }
  if (order.status === 'paid' && !order.code) store.assignCode(order);
  return order;
}

app.get('/api/order/:ref', rateLimit(60, 60 * 1000), async (req, res) => {
  const order = store.findOrder(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  await refreshOrder(order);
  res.json({
    ref: order.ref, status: order.status, code: order.code,
    // payé mais stock vide: l'admin doit recharger des codes, le client garde sa référence
    waitingStock: order.status === 'paid' && !order.code
  });
});

app.all('/api/flexpay/callback', async (req, res) => {
  const b = Object.assign({}, req.query, req.body);
  const order = store.findOrder(b.reference) || store.findOrderByNumber(b.orderNumber);
  if (order) await refreshOrder(order);
  res.json({ ok: true });
});

// ---------- Admin ----------
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('hex'); }
function makeToken() { const exp = String(Date.now() + 12 * 3600 * 1000); return exp + '.' + sign(exp); }
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function auth(req, res, next) {
  if (!ADMIN_PASSWORD || !validToken(getCookie(req, 'adm'))) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

app.post('/api/admin/login', rateLimit(8, 10 * 60 * 1000), (req, res) => {
  const pw = String(req.body.password || '');
  const a = Buffer.from(pw), b = Buffer.from(ADMIN_PASSWORD);
  if (!ADMIN_PASSWORD || a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  res.setHeader('Set-Cookie', `adm=${encodeURIComponent(makeToken())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'adm=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/summary', auth, (req, res) => {
  const { db } = store;
  const paid = db.orders.filter(o => o.status === 'paid');
  res.json({
    unused: store.unusedCount(),
    used: db.codes.filter(c => c.status === 'used').length,
    pending: db.orders.filter(o => o.status === 'pending').length,
    paidWithoutCode: paid.filter(o => !o.code).length,
    revenue: paid.reduce((s, o) => s + o.amount, 0),
    currency: CURRENCY,
    codes: db.codes.slice().reverse().slice(0, 500),
    orders: db.orders.slice().reverse().slice(0, 200)
      .map(o => ({ ref: o.ref, phone: o.phone, method: o.method, status: o.status, code: o.code, createdAt: o.createdAt }))
  });
});

app.post('/api/admin/codes', auth, (req, res) => {
  const list = String(req.body.codes || '').split(/[\s,;]+/).filter(Boolean);
  if (!list.length) return res.status(400).json({ error: 'Aucun code' });
  const r = store.addCodes(list);
  // distribue d'éventuels codes aux clients déjà payés en attente de stock
  store.db.orders.filter(o => o.status === 'paid' && !o.code).forEach(o => store.assignCode(o));
  res.json(r);
});

app.delete('/api/admin/codes/:code', auth, (req, res) => {
  res.json({ ok: store.deleteUnusedCode(req.params.code) });
});

app.get('/api/admin/export', auth, (req, res) => {
  const rows = ['code;statut;commande'].concat(store.db.codes.map(c => `${c.code};${c.status};${c.orderRef || ''}`));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="codes.csv"');
  res.send(rows.join('\n'));
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => console.log(`Machine à tickets WiFi prête sur le port ${PORT}`));
