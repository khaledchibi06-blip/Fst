'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD غير محددة — كلمة المرور الافتراضية هي admin123، غيّرها قبل النشر.');
}

// ---------- قاعدة البيانات ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'fastgaz.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ref         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    car_brand   TEXT NOT NULL,
    car_model   TEXT NOT NULL,
    car_year    INTEGER,
    fuel_system TEXT,
    service     TEXT NOT NULL,
    date        TEXT NOT NULL,
    time        TEXT NOT NULL,
    notes       TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, time);
  CREATE TABLE IF NOT EXISTS closed_days (
    date   TEXT PRIMARY KEY,
    reason TEXT
  );
`);

const ACTIVE_STATUSES = ['pending', 'confirmed'];
const ALL_STATUSES = ['pending', 'confirmed', 'done', 'cancelled'];

// ---------- أدوات التاريخ ----------
function todayInTz() {
  // en-CA يعطي الصيغة YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

function nowTimeInTz() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date());
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// العطل من config.js + الأيام المغلقة من لوحة الإدارة
function closedDays() {
  const fromDb = db.prepare('SELECT date FROM closed_days').all().map((r) => r.date);
  return [...new Set([...config.holidays, ...fromDb])];
}

function dayIsOpen(dateStr) {
  const today = todayInTz();
  if (dateStr < today || dateStr > addDays(today, config.maxDaysAhead)) return false;
  if (closedDays().includes(dateStr)) return false;
  const weekday = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return config.workDays.includes(weekday);
}

function slotsFor(dateStr) {
  const open = dayIsOpen(dateStr);
  const counts = {};
  for (const row of db.prepare(
    `SELECT time, COUNT(*) AS n FROM bookings WHERE date = ? AND status IN ('pending','confirmed') GROUP BY time`
  ).all(dateStr)) counts[row.time] = row.n;

  const isToday = dateStr === todayInTz();
  const now = nowTimeInTz();
  return config.slots.map((time) => {
    const taken = counts[time] || 0;
    const remaining = Math.max(0, config.capacityPerSlot - taken);
    const past = isToday && time <= now;
    return { time, remaining, available: open && !past && remaining > 0 };
  });
}

// ---------- جلسة الإدارة ----------
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

function makeToken() {
  const exp = String(Date.now() + 12 * 60 * 60 * 1000);
  return exp + '.' + sign(exp);
}

function isAdmin(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)fg_admin=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig) return false;
  const expected = sign(exp);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) && Number(exp) > Date.now();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- حدّ بسيط لعدد الطلبات ----------
const hits = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > limit;
}

// ---------- أدوات HTTP ----------
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20_000) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function clean(v, max = 100) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function normalizePhone(p) {
  return clean(p, 30).replace(/[\s.\-()]/g, '');
}

function genRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(6)) s += alphabet[b % alphabet.length];
  return 'FG-' + s;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('الصفحة غير موجودة');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- منطق الحجز ----------
function validateBooking(b) {
  const data = {
    name: clean(b.name, 80),
    phone: normalizePhone(b.phone),
    car_brand: clean(b.car_brand, 40),
    car_model: clean(b.car_model, 40),
    car_year: b.car_year ? Number(b.car_year) : null,
    fuel_system: clean(b.fuel_system, 20),
    service: clean(b.service, 40),
    date: clean(b.date, 10),
    time: clean(b.time, 5),
    notes: clean(b.notes, 500),
  };
  const errors = [];
  if (data.name.length < 2) errors.push('الرجاء إدخال الاسم الكامل');
  if (!/^(\+?213|0)[5-7]\d{8}$/.test(data.phone)) errors.push('رقم الهاتف غير صحيح (مثال: 0555123456)');
  if (!data.car_brand) errors.push('الرجاء إدخال نوع السيارة');
  if (!data.car_model) errors.push('الرجاء إدخال طراز السيارة');
  const maxYear = new Date().getFullYear() + 1;
  if (data.car_year !== null && (!Number.isInteger(data.car_year) || data.car_year < 1970 || data.car_year > maxYear)) {
    errors.push('سنة الصنع غير صحيحة');
  }
  if (!config.services.some((s) => s.id === data.service)) errors.push('الرجاء اختيار الخدمة');
  if (!isValidDate(data.date)) errors.push('التاريخ غير صحيح');
  if (!config.slots.includes(data.time)) errors.push('الرجاء اختيار وقت الموعد');
  return { data, errors };
}

// force: حجز من لوحة الإدارة يتجاوز التحقق من الأماكن المتاحة
function createBooking(data, { force = false, status = 'pending' } = {}) {
  // معاملة واحدة لمنع حجز نفس المكان مرتين
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!force) {
      const slot = slotsFor(data.date).find((s) => s.time === data.time);
      if (!slot || !slot.available) {
        db.exec('ROLLBACK');
        return { error: 'هذا الموعد لم يعد متاحاً، الرجاء اختيار وقت آخر' };
      }
      const dup = db.prepare(
        `SELECT ref FROM bookings WHERE phone = ? AND date = ? AND status IN ('pending','confirmed')`
      ).get(data.phone, data.date);
      if (dup) {
        db.exec('ROLLBACK');
        return { error: `لديك حجز مسبق في هذا اليوم (رقم الحجز ${dup.ref})` };
      }
    }
    const ref = genRef();
    db.prepare(`
      INSERT INTO bookings (ref, name, phone, car_brand, car_model, car_year, fuel_system, service, date, time, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ref, data.name, data.phone, data.car_brand, data.car_model, data.car_year,
      data.fuel_system, data.service, data.date, data.time, data.notes, status);
    db.exec('COMMIT');
    return { ref };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function publicBooking(row) {
  const service = config.services.find((s) => s.id === row.service);
  return {
    ref: row.ref, name: row.name, date: row.date, time: row.time, status: row.status,
    service: service ? service.title : row.service,
    car: `${row.car_brand} ${row.car_model}${row.car_year ? ' ' + row.car_year : ''}`,
  };
}

// ---------- الموجّه ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const ip = (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())
    || req.socket.remoteAddress || '';

  if (req.method === 'GET' && p === '/api/config') {
    const { workshop, services, slots, hoursText, workDays, maxDaysAhead } = config;
    return send(res, 200, {
      workshop, services, slots, hoursText, workDays, maxDaysAhead, holidays: closedDays(), today: todayInTz(),
    });
  }

  if (req.method === 'GET' && p === '/api/slots') {
    const date = url.searchParams.get('date') || '';
    if (!isValidDate(date)) return send(res, 400, { error: 'التاريخ غير صحيح' });
    return send(res, 200, { date, open: dayIsOpen(date), slots: slotsFor(date) });
  }

  if (req.method === 'POST' && p === '/api/bookings') {
    if (rateLimited('book:' + ip, 10, 60 * 60 * 1000)) {
      return send(res, 429, { error: 'محاولات كثيرة، الرجاء المحاولة لاحقاً أو الاتصال بنا' });
    }
    const { data, errors } = validateBooking(await readBody(req));
    if (errors.length) return send(res, 400, { error: errors.join('، ') });
    const result = createBooking(data);
    if (result.error) return send(res, 409, result);
    const row = db.prepare('SELECT * FROM bookings WHERE ref = ?').get(result.ref);
    return send(res, 201, { booking: publicBooking(row) });
  }

  if (req.method === 'POST' && p === '/api/bookings/lookup') {
    if (rateLimited('lookup:' + ip, 20, 15 * 60 * 1000)) return send(res, 429, { error: 'محاولات كثيرة' });
    const body = await readBody(req);
    const ref = clean(body.ref, 12).toUpperCase();
    const phone = normalizePhone(body.phone);
    const row = db.prepare('SELECT * FROM bookings WHERE ref = ? AND phone = ?').get(ref, phone);
    if (!row) return send(res, 404, { error: 'لم يتم العثور على حجز بهذه المعلومات' });
    return send(res, 200, { booking: publicBooking(row) });
  }

  if (req.method === 'POST' && p === '/api/bookings/cancel') {
    if (rateLimited('lookup:' + ip, 20, 15 * 60 * 1000)) return send(res, 429, { error: 'محاولات كثيرة' });
    const body = await readBody(req);
    const ref = clean(body.ref, 12).toUpperCase();
    const phone = normalizePhone(body.phone);
    const row = db.prepare('SELECT * FROM bookings WHERE ref = ? AND phone = ?').get(ref, phone);
    if (!row) return send(res, 404, { error: 'لم يتم العثور على حجز بهذه المعلومات' });
    if (!ACTIVE_STATUSES.includes(row.status)) return send(res, 400, { error: 'لا يمكن إلغاء هذا الحجز' });
    db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(row.id);
    return send(res, 200, { booking: publicBooking({ ...row, status: 'cancelled' }) });
  }

  // ----- الإدارة -----
  if (req.method === 'POST' && p === '/api/admin/login') {
    if (rateLimited('login:' + ip, 10, 15 * 60 * 1000)) return send(res, 429, { error: 'محاولات كثيرة' });
    const body = await readBody(req);
    if (!safeEqual(body.password || '', ADMIN_PASSWORD)) return send(res, 401, { error: 'كلمة المرور غير صحيحة' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `fg_admin=${encodeURIComponent(makeToken())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`,
    });
  }

  if (req.method === 'POST' && p === '/api/admin/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'fg_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'غير مصرح' });

    if (req.method === 'GET' && p === '/api/admin/bookings') {
      const where = [];
      const args = [];
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const status = url.searchParams.get('status');
      const q = url.searchParams.get('q');
      if (from && isValidDate(from)) { where.push('date >= ?'); args.push(from); }
      if (to && isValidDate(to)) { where.push('date <= ?'); args.push(to); }
      if (status && ALL_STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
      if (q) {
        where.push('(name LIKE ? OR phone LIKE ? OR ref LIKE ? OR car_brand LIKE ? OR car_model LIKE ?)');
        const like = '%' + q.slice(0, 40) + '%';
        args.push(like, like, like, like, like);
      }
      const sql = `SELECT * FROM bookings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY date ASC, time ASC, id ASC LIMIT 500`;
      const rows = db.prepare(sql).all(...args);
      const today = todayInTz();
      const stats = db.prepare(`
        SELECT
          SUM(CASE WHEN date = ? AND status IN ('pending','confirmed') THEN 1 ELSE 0 END) AS today,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN date >= ? AND status = 'confirmed' THEN 1 ELSE 0 END) AS upcoming,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
          MAX(id) AS lastId
        FROM bookings
      `).get(today, today);
      return send(res, 200, { bookings: rows, stats, services: config.services, today });
    }

    const m = p.match(/^\/api\/admin\/bookings\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      const body = await readBody(req);
      if (!ALL_STATUSES.includes(body.status)) return send(res, 400, { error: 'حالة غير صحيحة' });
      const r = db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(body.status, Number(m[1]));
      if (!r.changes) return send(res, 404, { error: 'الحجز غير موجود' });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/admin/bookings') {
      const body = await readBody(req);
      const { data, errors } = validateBooking(body);
      if (errors.length) return send(res, 400, { error: errors.join('، ') });
      const status = ALL_STATUSES.includes(body.status) ? body.status : 'confirmed';
      const result = createBooking(data, { force: !!body.force, status });
      if (result.error) return send(res, 409, result);
      return send(res, 201, { ref: result.ref });
    }

    if (req.method === 'GET' && p === '/api/admin/closed') {
      const rows = db.prepare('SELECT date, reason FROM closed_days WHERE date >= ? ORDER BY date').all(todayInTz());
      return send(res, 200, { closed: rows, holidays: config.holidays });
    }
    if (req.method === 'POST' && p === '/api/admin/closed') {
      const body = await readBody(req);
      const date = clean(body.date, 10);
      if (!isValidDate(date)) return send(res, 400, { error: 'التاريخ غير صحيح' });
      db.prepare('INSERT OR REPLACE INTO closed_days (date, reason) VALUES (?, ?)').run(date, clean(body.reason, 100));
      const active = db.prepare(
        `SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND status IN ('pending','confirmed')`
      ).get(date).n;
      return send(res, 200, { ok: true, activeBookings: active });
    }
    const cm = p.match(/^\/api\/admin\/closed\/(\d{4}-\d{2}-\d{2})$/);
    if (cm && req.method === 'DELETE') {
      db.prepare('DELETE FROM closed_days WHERE date = ?').run(cm[1]);
      return send(res, 200, { ok: true });
    }

    if (m && req.method === 'DELETE') {
      const r = db.prepare('DELETE FROM bookings WHERE id = ?').run(Number(m[1]));
      if (!r.changes) return send(res, 404, { error: 'الحجز غير موجود' });
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'غير موجود' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (e) {
    if (e.message === 'bad json' || e.message === 'too large') return send(res, 400, { error: 'طلب غير صالح' });
    console.error(e);
    return send(res, 500, { error: 'حدث خطأ في الخادم' });
  }
});

server.listen(PORT, () => {
  console.log(`✅ موقع ${config.workshop.name} يعمل على http://localhost:${PORT}`);
  console.log(`   لوحة الإدارة: http://localhost:${PORT}/admin`);
});
