(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const MONTHS = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const STATUS = { pending: 'في انتظار التأكيد', confirmed: 'مؤكد', done: 'منجز', cancelled: 'ملغى' };
  const ICONS = { injection: 'cpu', carburetor: 'cog', maintenance: 'wrench', tank: 'tank' };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const icon = (name, cls) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    if (cls) svg.setAttribute('class', cls);
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  };

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
    const all = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
    all('[data-wa]', (a) => { a.href = waLink('السلام عليكم، أريد الاستفسار عن تركيب السيرغاز'); a.target = '_blank'; a.rel = 'noopener'; });
    all('[data-phone]', (n) => { n.textContent = w.phone; });
    all('[data-phone-link]', (a) => { a.href = 'tel:' + w.phone.replace(/\s/g, ''); });
    all('[data-address]', (n) => { n.textContent = w.address; });
    all('[data-city]', (n) => { n.textContent = w.city; });
    all('[data-email]', (n) => { n.textContent = w.email; });
    for (const net of ['tiktok', 'facebook', 'instagram']) {
      all(`[data-social=${net}]`, (a) => {
        if (w[net]) { a.href = w[net]; a.classList.remove('hidden'); } else a.classList.add('hidden');
      });
    }
    all('[data-email-link]', (a) => { a.href = 'mailto:' + w.email; });
    all('[data-hours]', (n) => { n.textContent = state.config.hoursText; });
    const q = encodeURIComponent(w.mapsQuery || w.address);
    all('[data-maps]', (a) => { a.href = 'https://www.google.com/maps/search/?api=1&query=' + q; });
    const frame = $('#mapFrame');
    if (frame) frame.src = `https://maps.google.com/maps?q=${q}&z=15&output=embed`;
  }

  function renderServices() {
    const grid = $('#servicesGrid');
    const picker = $('#servicePicker');
    for (const s of state.config.services) {
      grid.append(el('div', { class: 'card service reveal' }, [
        el('div', { class: 'icon' }, icon(ICONS[s.id] || 'wrench')),
        el('h3', { text: s.title }),
        el('p', { text: s.desc }),
        el('div', { class: 'meta' }, [
          el('span', {}, [icon('clock', 'ico'), s.duration]),
          el('b', { text: s.price }),
        ]),
        el('a', {
          class: 'go', href: '#booking',
          onclick: () => { const r = $('#svc-' + s.id); r.checked = true; state.service = s.id; updateSummary(); },
        }, ['احجز هذه الخدمة', icon('arrow', 'ico')]),
      ]));
      picker.append(el('div', { class: 'choice' }, [
        el('input', {
          type: 'radio', name: 'service', id: 'svc-' + s.id, value: s.id,
          onchange: () => { state.service = s.id; updateSummary(); },
        }),
        el('label', { for: 'svc-' + s.id }, [
          el('span', { class: 'ci' }, icon(ICONS[s.id] || 'wrench')),
          el('span', {}, [el('b', { text: s.title }), el('small', { text: s.duration })]),
        ]),
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

  // ---------- أقرب موعد متاح ----------
  async function findNextSlot() {
    const box = $('#nextSlot');
    const { today, maxDaysAhead, workDays, holidays } = state.config;
    for (let i = 0; i <= Math.min(maxDaysAhead, 14); i++) {
      const date = addDays(today, i);
      if (!workDays.includes(weekday(date)) || holidays.includes(date)) continue;
      try {
        const { slots } = await api('/api/slots?date=' + date);
        const free = slots.filter((s) => s.available);
        if (!free.length) continue;
        box.replaceChildren(
          el('small', { text: i === 0 ? 'اليوم' : i === 1 ? 'غداً' : 'قريباً' }),
          el('b', { text: formatDate(date) }),
          el('div', { class: 'times-mini' }, free.map((s) => el('span', { text: s.time }))),
        );
        return;
      } catch { break; }
    }
    box.replaceChildren(el('small', { text: 'اتصل بنا لمعرفة أقرب موعد' }));
  }

  // ---------- حاسبة التوفير ----------
  function setupCalc() {
    const km = $('#km'), cons = $('#cons'), pP = $('#pPetrol'), pL = $('#pLpg');
    if (!km) return;
    pP.value = state.config.fuelPrices.petrol;
    pL.value = state.config.fuelPrices.lpg;
    const fmt = (n) => Math.round(n).toLocaleString('en-US') + ' دج';
    const calc = () => {
      const liters = (Number(km.value) * Number(cons.value)) / 100;
      const petrol = liters * (Number(pP.value) || 0);
      const lpg = liters * 1.2 * (Number(pL.value) || 0);
      const save = Math.max(0, petrol - lpg);
      $('#kmOut').textContent = Number(km.value).toLocaleString('en-US') + ' كم';
      $('#consOut').textContent = cons.value + ' ل';
      $('#costPetrol').textContent = fmt(petrol);
      $('#costLpg').textContent = fmt(lpg);
      $('#saveMonth').textContent = fmt(save);
      $('#saveYear').textContent = 'أي حوالي ' + fmt(save * 12) + ' في السنة';
    };
    [km, cons, pP, pL].forEach((i) => i.addEventListener('input', calc));
    calc();
  }

  // ---------- ظهور تدريجي للأقسام ----------
  function setupReveal() {
    const els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
  }

  // ---------- بدء التشغيل ----------
  setupReveal();
  api('/api/config').then((cfg) => {
    state.config = cfg;
    fillContact();
    renderServices();
    renderDays();
    setupCalc();
    setupReveal();
    findNextSlot();
  }).catch(() => {
    $('#servicesGrid').append(el('div', { class: 'alert err', text: 'تعذر تحميل المعلومات، أعد تحميل الصفحة.' }));
  });
})();
