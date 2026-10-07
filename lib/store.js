const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { codes: [], orders: [] };
if (fs.existsSync(FILE)) {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.error('db.json illisible', e); process.exit(1); }
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

const PENDING_HOLD_MS = 15 * 60 * 1000;

function unusedCount() { return db.codes.filter(c => c.status === 'unused').length; }

function pendingRecent() {
  const limit = Date.now() - PENDING_HOLD_MS;
  return db.orders.filter(o => o.status === 'pending' && o.createdAt > limit).length;
}

// Codes réellement vendables (on retire ceux "réservés" par des paiements en cours)
function available() { return Math.max(0, unusedCount() - pendingRecent()); }

function addCodes(list) {
  const existing = new Set(db.codes.map(c => c.code));
  let added = 0, duplicates = 0;
  for (const raw of list) {
    const code = String(raw).trim();
    if (!code) continue;
    if (existing.has(code)) { duplicates++; continue; }
    existing.add(code);
    db.codes.push({ code, status: 'unused', addedAt: Date.now() });
    added++;
  }
  save();
  return { added, duplicates };
}

function deleteUnusedCode(code) {
  const i = db.codes.findIndex(c => c.code === code && c.status === 'unused');
  if (i < 0) return false;
  db.codes.splice(i, 1);
  save();
  return true;
}

// Attribue un code non utilisé à une commande payée (idempotent, synchrone => pas de doublon)
function assignCode(order) {
  if (order.code) return order.code;
  const c = db.codes.find(x => x.status === 'unused');
  if (!c) return null;
  c.status = 'used';
  c.orderRef = order.ref;
  c.assignedAt = Date.now();
  order.code = c.code;
  save();
  return c.code;
}

function createOrder(o) { db.orders.push(o); save(); return o; }
function findOrder(ref) { return db.orders.find(o => o.ref === ref); }
function findOrderByNumber(n) { return db.orders.find(o => o.orderNumber === n); }

module.exports = {
  db, save, available, unusedCount, addCodes, deleteUnusedCode,
  assignCode, createOrder, findOrder, findOrderByNumber
};
