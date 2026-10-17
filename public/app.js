(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const MONTHS = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const STATUS = { pending: 'في انتظار التأكيد', confirmed: 'مؤكد', done: 'منجز', cancelled: 'ملغى' };
  const ICONS = { injection: '⚙️', carburetor: '🔩', maintenance: '🛠️', tank: '🛢️' };

  const state = { config: null, service: null, date: null, time: null };

  const api = async (url, opts = {}) => {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'حدث خطأ، حاول مرة أخرى');
    return data;
  };

  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) n.append(c);
    return n;
  };

  const addDays = (s, n) => {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekday = (s) => new Date(s + 'T00:00:00Z').getUTCDay();
  const formatDate = (s) => {
    const d = new Date(s + 'T00:00:00Z');
    return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  const waLink = (text) => `https://wa.me/${state.config.workshop.whatsapp}${text ? '?text=' + encodeURIComponent(text) : ''}`;

  // ---------- عام ----------
  $('#menuBtn').addEventListener('click', () => $('#nav').classList.toggle('open'));
  $('#nav').addEventListener('click', (e) => { if (e.target.tagName === 'A') $('#nav').classList.remove('open'); });
  $('#year').textContent = new Date().getFullYear();

  function fillContact() {
    const w = state.config.workshop;
    document.querySelectorAll('[data-wa]').forEach((a) => { a.href = waLink('السلام عليكم، أريد الاستفسار عن تركيب السيرغاز'); a.target = '_blank'; });
    document.querySelectorAll('[data-phone]').forEach((a) => { a.textContent = w.phone; a.href = 'tel:' + w.phone.replace(/\s/g, ''); });
    document.querySelectorAll('[data-address]').forEach((p) => { p.textContent = w.address; });
    document.querySelectorAll('[data-maps]').forEach((a) => { a.href = w.mapsUrl; });
    document.querySelectorAll('[data-hours]').forEach((p) => { p.textContent = state.config.hoursText; });
  }

  function renderServices() {
    const grid = $('#servicesGrid');
    const picker = $('#servicePicker');
    for (const s of state.config.services) {
      grid.append(el('div', { class: 'card service' }, [
        el('div', { class: 'icon', text: ICONS[s.id] || '🔧' }),
        el('h3', { text: s.title }),
        el('p', { text: s.desc }),
        el('div', { class: 'meta' }, [
          el('span', { text: '⏱ ' + s.duration }),
          el('b', { text: s.price }),
        ]),
      ]));
      picker.append(el('div', { class: 'choice' }, [
        el('input', {
          type: 'radio', name: 'service', id: 'svc-' + s.id, value: s.id,
          onchange: () => { state.service = s.id; updateSummary(); },
        }),
        el('label', { for: 'svc-' + s.id }, [el('b', { text: s.title }), el('small', { text: s.duration })]),
      ]));
    }
  }

  // ---------- الأيام والأوقات ----------
  function renderDays() {
    const box = $('#days');
    box.innerHTML = '';
    const { today, maxDaysAhead, workDays, holidays } = state.config;
    for (let i = 0; i <= maxDaysAhead; i++) {
      const date = addDays(today, i);
      const d = new Date(date + 'T00:00:00Z');
      const closed = !workDays.includes(weekday(date)) || holidays.includes(date);
      box.append(el('button', {
        type: 'button', class: 'day' + (state.date === date ? ' active' : ''), disabled: closed,
        title: closed ? 'مغلق' : formatDate(date),
        onclick: () => selectDate(date),
      }, [
        el('small', { text: i === 0 ? 'اليوم' : i === 1 ? 'غداً' : DAY_NAMES[d.getUTCDay()] }),
        el('b', { text: String(d.getUTCDate()) }),
        el('small', { text: MONTHS[d.getUTCMonth()] }),
      ]));
    }
  }

  async function selectDate(date) {
    state.date = date;
    state.time = null;
    renderDays();
    updateSummary();
    const times = $('#times');
    const hint = $('#timesHint');
    times.innerHTML = '';
    hint.textContent = 'جاري تحميل الأوقات...';
    try {
      const data = await api('/api/slots?date=' + date);
      if (state.date !== date) return;
      let any = false;
      for (const s of data.slots) {
        any = any || s.available;
        times.append(el('button', {
          type: 'button', class: 'time', disabled: !s.available,
          onclick: (e) => {
            state.time = s.time;
            times.querySelectorAll('.time').forEach((b) => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            updateSummary();
          },
        }, [s.time, el('small', { text: s.available ? `متاح (${s.remaining})` : 'محجوز' })]));
      }
      hint.textContent = any ? 'الرقم بين القوسين = عدد الأماكن المتبقية.' : 'لا توجد أوقات متاحة في هذا اليوم، اختر يوماً آخر.';
    } catch (err) {
      hint.textContent = err.message;
    }
  }

  function updateSummary() {
    const svc = state.config.services.find((s) => s.id === state.service);
    $('#sumService').textContent = svc ? svc.title : '—';
    $('#sumDate').textContent = state.date ? formatDate(state.date) : '—';
    $('#sumTime').textContent = state.time || '—';
  }

  // ---------- إرسال الحجز ----------
  const form = $('#bookingForm');
  const errBox = $('#formError');
  const showError = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); errBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    const fd = new FormData(form);
    if (!state.service) return showError('الرجاء اختيار الخدمة');
    if (!state.date || !state.time) return showError('الرجاء اختيار اليوم والوقت');
    for (const [id, label] of [['car_brand', 'نوع السيارة'], ['car_model', 'طراز السيارة'], ['name', 'الاسم'], ['phone', 'رقم الهاتف']]) {
      if (!String(fd.get(id) || '').trim()) { $('#' + id).focus(); return showError('الرجاء إدخال ' + label); }
    }
    const body = Object.fromEntries(fd.entries());
    Object.assign(body, { service: state.service, date: state.date, time: state.time });

    const btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = 'جاري الحجز...';
    try {
      const { booking } = await api('/api/bookings', { method: 'POST', body: JSON.stringify(body) });
      showSuccess(booking);
    } catch (err) {
      showError(err.message);
      if (state.date) selectDate(state.date);
    } finally {
      btn.disabled = false;
      btn.textContent = 'تأكيد الحجز';
    }
  });

  function showSuccess(b) {
    $('#bookingWrap').classList.add('hidden');
    $('#successBox').classList.remove('hidden');
    $('#refCode').textContent = b.ref;
    $('#successDetails').textContent = `${b.service} — ${formatDate(b.date)} على الساعة ${b.time} — ${b.car}`;
    $('#waConfirm').href = waLink(
      `السلام عليكم، حجزت موعد في فاست غاز\nرقم الحجز: ${b.ref}\nالاسم: ${b.name}\nالخدمة: ${b.service}\nالموعد: ${formatDate(b.date)} - ${b.time}\nالسيارة: ${b.car}`
    );
    $('#booking').scrollIntoView({ behavior: 'smooth' });
  }

  $('#newBooking').addEventListener('click', () => {
    form.reset();
    Object.assign(state, { service: null, date: null, time: null });
    $('#times').innerHTML = '';
    $('#timesHint').textContent = 'اختر يوماً لعرض الأوقات المتاحة.';
    renderDays();
    updateSummary();
    $('#successBox').classList.add('hidden');
    $('#bookingWrap').classList.remove('hidden');
  });

  // ---------- تتبع الحجز ----------
  const trackForm = $('#trackForm');
  const trackResult = $('#trackResult');

  function renderTrack(b) {
    trackResult.innerHTML = '';
    const canCancel = b.status === 'pending' || b.status === 'confirmed';
    trackResult.append(el('div', { class: 'card' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
        el('b', { text: b.ref, dir: 'ltr' }),
        el('span', { class: 'status ' + b.status, text: STATUS[b.status] || b.status }),
      ]),
      el('p', { text: `${b.name} — ${b.car}` }),
      el('p', { text: `${b.service} — ${formatDate(b.date)} على الساعة ${b.time}` }),
      canCancel ? el('button', { class: 'btn btn-outline btn-sm', type: 'button', text: 'إلغاء الحجز', onclick: cancelBooking }) : '',
    ]));
  }

  async function cancelBooking() {
    if (!confirm('هل أنت متأكد من إلغاء الحجز؟')) return;
    try {
      const { booking } = await api('/api/bookings/cancel', {
        method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(trackForm))),
      });
      renderTrack(booking);
    } catch (err) {
      alert(err.message);
    }
  }

  trackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    trackResult.innerHTML = '';
    try {
      const { booking } = await api('/api/bookings/lookup', {
        method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(trackForm))),
      });
      renderTrack(booking);
    } catch (err) {
      trackResult.append(el('div', { class: 'alert err', text: err.message }));
    }
  });

  // ---------- بدء التشغيل ----------
  api('/api/config').then((cfg) => {
    state.config = cfg;
    fillContact();
    renderServices();
    renderDays();
  }).catch(() => {
    $('#servicesGrid').append(el('div', { class: 'alert err', text: 'تعذر تحميل المعلومات، أعد تحميل الصفحة.' }));
  });
})();
