'use strict';

// مزامنة الحجوزات مع قاعدة بيانات Notion (اختيارية)
// تعمل فقط عند تحديد NOTION_TOKEN و NOTION_DATABASE_ID
const API = process.env.NOTION_API_URL || 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

const STATUS = {
  pending: { name: 'في انتظار التأكيد', color: 'yellow' },
  confirmed: { name: 'مؤكد', color: 'blue' },
  done: { name: 'منجز', color: 'green' },
  cancelled: { name: 'ملغى', color: 'red' },
};
const FUEL = { injection: 'حقن', carburetor: 'كاربيراتور' };

function createNotionSync({ db, config }) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = (process.env.NOTION_DATABASE_ID || '').replace(/-/g, '').match(/[0-9a-f]{32}/i)?.[0];
  const enabled = Boolean(token && databaseId);

  let titleProp = null;
  let schemaPromise = null;
  let lastError = null;

  async function call(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Notion ${res.status}: ${data.message || res.statusText}`);
    return data;
  }

  // يضيف الأعمدة الناقصة إلى قاعدة بيانات Notion مرة واحدة
  function ensureSchema() {
    // وعد واحد مشترك حتى لا تكرر الحجوزات المتزامنة نفس الإعداد
    schemaPromise = schemaPromise || setupSchema().catch((e) => { schemaPromise = null; throw e; });
    return schemaPromise;
  }

  async function setupSchema() {
    const database = await call('GET', `/databases/${databaseId}`);
    titleProp = Object.entries(database.properties).find(([, p]) => p.type === 'title')[0];
    await call('PATCH', `/databases/${databaseId}`, {
      properties: {
        'رقم الحجز': { rich_text: {} },
        'الهاتف': { phone_number: {} },
        'السيارة': { rich_text: {} },
        'الخدمة': { select: { options: config.services.map((s) => ({ name: s.title.slice(0, 100) })) } },
        'الموعد': { date: {} },
        'الحالة': { select: { options: Object.values(STATUS) } },
        'ملاحظات': { rich_text: {} },
      },
    });
  }

  const text = (s) => ({ rich_text: s ? [{ text: { content: String(s).slice(0, 2000) } }] : [] });

  function properties(row) {
    const service = config.services.find((s) => s.id === row.service);
    const car = [row.car_brand, row.car_model, row.car_year, FUEL[row.fuel_system]].filter(Boolean).join(' — ');
    return {
      [titleProp]: { title: [{ text: { content: row.name } }] },
      'رقم الحجز': text(row.ref),
      'الهاتف': { phone_number: row.phone },
      'السيارة': text(car),
      'الخدمة': { select: { name: (service ? service.title : row.service).slice(0, 100) } },
      'الموعد': { date: { start: `${row.date}T${row.time}:00`, time_zone: config.timezone } },
      'الحالة': { select: { name: (STATUS[row.status] || STATUS.pending).name } },
      'ملاحظات': text(row.notes),
    };
  }

  async function syncNow(id) {
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!row) return;
    await ensureSchema();
    if (row.notion_page_id) {
      await call('PATCH', `/pages/${row.notion_page_id}`, { properties: properties(row) });
    } else {
      const page = await call('POST', '/pages', { parent: { database_id: databaseId }, properties: properties(row) });
      db.prepare('UPDATE bookings SET notion_page_id = ? WHERE id = ?').run(page.id, id);
    }
  }

  // لا ننتظر Notion حتى لا يتأخر الحجز إذا كان Notion بطيئاً أو متوقفاً
  function sync(id) {
    if (!enabled) return;
    syncNow(id).then(() => { lastError = null; }).catch((e) => {
      lastError = e.message;
      console.error('Notion sync failed:', e.message);
    });
  }

  function archive(pageId) {
    if (!enabled || !pageId) return;
    call('PATCH', `/pages/${pageId}`, { archived: true }).catch((e) => console.error('Notion archive failed:', e.message));
  }

  async function syncAll() {
    if (!enabled) throw new Error('Notion غير مفعّل');
    const ids = db.prepare('SELECT id FROM bookings ORDER BY id').all().map((r) => r.id);
    let done = 0;
    for (const id of ids) {
      await syncNow(id);
      done++;
      await new Promise((r) => setTimeout(r, 350)); // حد Notion: 3 طلبات في الثانية
    }
    lastError = null;
    return done;
  }

  return { enabled, sync, archive, syncAll, status: () => ({ enabled, lastError }) };
}

module.exports = { createNotionSync };
