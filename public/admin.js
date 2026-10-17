(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const STATUS = { pending: 'في انتظار التأكيد', confirmed: 'مؤكد', done: 'منجز', cancelled: 'ملغى' };
  const FUEL = { injection: 'حقن', carburetor: 'كاربيراتور' };
  let services = [];
  let today = '';

  const api = async (url, opts = {}) => {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error(data.error); }
    if (!res.ok) throw new Error(data.error || 'خطأ');
    return data;
  };

  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c != null) n.append(c);
    return n;
  };

  const addDays = (s, n) => {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dayLabel = (s) => `${DAY_NAMES[new Date(s + 'T00:00:00Z').getUTCDay()]} ${s.split('-').reverse().join('/')}`;
  const intlPhone = (p) => p.startsWith('0') ? '213' + p.slice(1) : p.replace(/^\+/, '');

  function showLogin() {
    $('#app').classList.add('hidden');
    $('#loginBox').classList.remove('hidden');
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#loginErr');
    err.classList.add('hidden');
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) });
      e.target.reset();
      $('#loginBox').classList.add('hidden');
      $('#app').classList.remove('hidden');
      setRange('upcoming');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  const filters = $('#filters');
  filters.addEventListener('submit', (e) => { e.preventDefault(); markQuick(null); load(); });

  function markQuick(range) {
    document.querySelectorAll('#quick [data-range]').forEach((b) => b.classList.toggle('active', b.dataset.range === range));
  }

  function setRange(range) {
    const t = today || new Date().toISOString().slice(0, 10);
    const f = filters.elements;
    f.status.value = '';
    f.q.value = '';
    if (range === 'today') { f.from.value = t; f.to.value = t; }
    else if (range === 'tomorrow') { f.from.value = f.to.value = addDays(t, 1); }
    else if (range === 'week') { f.from.value = t; f.to.value = addDays(t, 7); }
    else if (range === 'upcoming') { f.from.value = t; f.to.value = ''; }
    else { f.from.value = ''; f.to.value = ''; }
    markQuick(range);
    load();
  }
  document.querySelectorAll('#quick [data-range]').forEach((b) => b.addEventListener('click', () => setRange(b.dataset.range)));

  async function load() {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(filters)) if (v) params.set(k, v);
    const data = await api('/api/admin/bookings?' + params);
    services = data.services;
    today = data.today;
    $('#stToday').textContent = data.stats.today || 0;
    $('#stPending').textContent = data.stats.pending || 0;
    $('#stUpcoming').textContent = data.stats.upcoming || 0;
    $('#stDone').textContent = data.stats.done || 0;
    render(data.bookings);
  }

  async function setStatus(id, status) {
    try { await api('/api/admin/bookings/' + id, { method: 'PATCH', body: JSON.stringify({ status }) }); }
    catch (e) { alert(e.message); }
    load();
  }

  async function remove(b) {
    if (!confirm(`حذف حجز ${b.name} (${b.ref}) نهائياً؟`)) return;
    try { await api('/api/admin/bookings/' + b.id, { method: 'DELETE' }); }
    catch (e) { alert(e.message); }
    load();
  }

  function render(list) {
    const tbody = $('#rows');
    tbody.innerHTML = '';
    if (!list.length) {
      tbody.append(el('tr', {}, el('td', { colspan: 8, class: 'empty', text: 'لا توجد مواعيد' })));
      return;
    }
    let lastDate = null;
    for (const b of list) {
      if (b.date !== lastDate) {
        lastDate = b.date;
        const count = list.filter((x) => x.date === b.date && x.status !== 'cancelled').length;
        tbody.append(el('tr', { class: 'day-row' }, el('td', {
          colspan: 8, text: `${dayLabel(b.date)}${b.date === today ? ' — اليوم' : ''} (${count} سيارة)`,
        })));
      }
      const svc = services.find((s) => s.id === b.service);
      const select = el('select', { onchange: (e) => setStatus(b.id, e.target.value) },
        Object.entries(STATUS).map(([v, t]) => {
          const o = el('option', { value: v, text: t });
          if (v === b.status) o.selected = true;
          return o;
        }));
      const waText = `السلام عليكم ${b.name}، نؤكد موعدكم في ورشة فاست غاز يوم ${dayLabel(b.date)} على الساعة ${b.time}. رقم الحجز: ${b.ref}`;
      tbody.append(el('tr', {}, [
        el('td', {}, el('b', { text: b.time })),
        el('td', { dir: 'ltr', style: 'text-align:right;white-space:nowrap', text: b.ref }),
        el('td', {}, [b.name, el('a', { class: 'sub', href: 'tel:' + b.phone, dir: 'ltr', style: 'text-align:right', text: b.phone })]),
        el('td', {}, [`${b.car_brand} ${b.car_model}`, el('span', { class: 'sub', text: [b.car_year, FUEL[b.fuel_system]].filter(Boolean).join(' — ') })]),
        el('td', { text: svc ? svc.title : b.service }),
        el('td', { text: b.notes || '—', style: 'max-width:200px' }),
        el('td', {}, el('span', { class: 'status ' + b.status, text: STATUS[b.status] })),
        el('td', { class: 'actions' }, [
          select,
          el('a', { class: 'icon-btn', title: 'واتساب', target: '_blank', rel: 'noopener', href: `https://wa.me/${intlPhone(b.phone)}?text=${encodeURIComponent(waText)}`, text: '💬' }),
          el('a', { class: 'icon-btn', title: 'اتصال', href: 'tel:' + b.phone, text: '📞' }),
          el('button', { class: 'icon-btn', title: 'حذف', onclick: () => remove(b), text: '🗑' }),
        ]),
      ]));
    }
  }

  // محاولة الدخول بالجلسة الحالية
  api('/api/admin/bookings?from=9999-01-01').then((d) => {
    today = d.today;
    $('#app').classList.remove('hidden');
    setRange('upcoming');
  }).catch(() => {});

  // تحديث تلقائي كل دقيقة
  setInterval(() => { if (!$('#app').classList.contains('hidden')) load().catch(() => {}); }, 60000);
})();
