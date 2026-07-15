/**
 * ═══════════════════════════════════════════════════════════
 *  RIFATECH — MOTOR COMPLETO v2
 *  + Galería de fotos del premio (hasta 4 imágenes)
 *  + Loterías colombianas con días de sorteo
 *  + Cuenta regresiva al sorteo
 *  + Ticket virtual con foto del premio
 *  + Compartir por WhatsApp
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────
   0. SUPABASE — CONFIGURACIÓN + MODO (real vs demo)

   SUPABASE_URL / SUPABASE_ANON_KEY se reemplazan en build time
   por el workflow de GitHub Actions ("Inyectar URL de Supabase
   en app.js"). Si tu deploy.yml usa otros tokens de reemplazo,
   ajusta esos dos placeholders para que coincidan.

   Si al desplegar estos placeholders NO fueron reemplazados
   (ej. estás abriendo el archivo local sin pasar por el
   workflow), la app cae automáticamente a MODO DEMO con datos
   simulados, igual que antes.
───────────────────────────────────────────────────────── */
const SUPABASE_URL      = '__SUPABASE_URL__';
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';

const SUPABASE_CONFIGURED =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL) &&
  SUPABASE_ANON_KEY.split('.').length === 3; // formato JWT válido

const supabaseClient = (SUPABASE_CONFIGURED && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

/** Slug de la rifa a mostrar, tomado de ?r=slug en la URL.
 *  Sin slug (ej. visitar index.html directo) → modo demo local. */
const RAFFLE_SLUG = new URLSearchParams(window.location.search).get('r');

const REAL_MODE = Boolean(supabaseClient && RAFFLE_SLUG);

/** Construye un link público a una rifa respetando el dominio
 *  real donde esté alojado el sitio (GitHub Pages, dominio propio, etc.)
 *  en vez de un dominio hardcodeado. */
function buildRaffleLink(slug) {
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
  return `${base}?r=${encodeURIComponent(slug)}`;
}

/* ─────────────────────────────────────────────────────────
   1. CATÁLOGO DE LOTERÍAS COLOMBIANAS
   Incluye día(s) de sorteo y frecuencia
───────────────────────────────────────────────────────── */
const LOTERIAS = [
  { id: 'bogota',       name: 'Lotería de Bogotá',       days: [4],    dayLabel: 'Jueves',           freq: 'semanal' },
  { id: 'medellin',     name: 'Lotería de Medellín',     days: [5],    dayLabel: 'Viernes',          freq: 'semanal' },
  { id: 'cruz-roja',    name: 'Cruz Roja Colombiana',    days: [1],    dayLabel: 'Lunes',            freq: 'semanal' },
  { id: 'cauca',        name: 'Lotería del Cauca',       days: [6],    dayLabel: 'Sábados',          freq: 'quincenal' },
  { id: 'cundinamarca', name: 'Lotería de Cundinamarca', days: [3],    dayLabel: 'Miércoles',        freq: 'semanal' },
  { id: 'tolima',       name: 'Lotería del Tolima',      days: [1],    dayLabel: 'Lunes',            freq: 'semanal' },
  { id: 'huila',        name: 'Lotería del Huila',       days: [6],    dayLabel: 'Sábados',          freq: 'quincenal' },
  { id: 'santander',   name: 'Lotería de Santander',    days: [5],    dayLabel: 'Viernes',          freq: 'quincenal' },
  { id: 'boyaca',       name: 'Lotería de Boyacá',       days: [3],    dayLabel: 'Miércoles',        freq: 'semanal' },
  { id: 'risaralda',    name: 'Lotería de Risaralda',    days: [5],    dayLabel: 'Viernes',          freq: 'quincenal' },
  { id: 'quindio',      name: 'Lotería del Quindío',     days: [2],    dayLabel: 'Martes',           freq: 'semanal' },
  { id: 'manizales',    name: 'Lotería de Manizales',    days: [3],    dayLabel: 'Miércoles',        freq: 'semanal' },
  { id: 'norte',        name: 'Lotería Norte de Stder.', days: [6],    dayLabel: 'Sábados',          freq: 'mensual'  },
  { id: 'nariño',       name: 'Lotería de Nariño',       days: [2],    dayLabel: 'Martes',           freq: 'quincenal' },
  { id: 'meta',         name: 'Lotería del Meta',        days: [0],    dayLabel: 'Domingos',         freq: 'semanal' },
  { id: 'baloto',       name: 'Baloto',                  days: [3, 6], dayLabel: 'Miérc. y Sábados', freq: 'semanal' },
  { id: 'chancia',      name: 'La Chancia',              days: [6],    dayLabel: 'Sábados',          freq: 'semanal' },
  { id: 'otro',         name: 'Otro / Sorteo propio',    days: [],     dayLabel: '—',                freq: 'único'    },
];

/* ─────────────────────────────────────────────────────────
   2. CONFIGURACIÓN DE LA RIFA
───────────────────────────────────────────────────────── */
const RAFFLE = {
  id:           'RIFA-2026-MT03',
  prizeName:    'MOTO YAMAHA MT-03 0KM',
  prizeValue:   18_500_000,
  ticketPrice:  30_000,
  totalNumbers: 100,
  // Lotería: clave del objeto en LOTERIAS
  lotteryId:    'bogota',
  // Fecha del sorteo específico (ISO): el día en que juega esta rifa
  drawDate:     '2026-07-31',
  // Fotos del premio: array de URLs o data URLs (máx. 4)
  prizePhotos:  [],
  // Reserva: TTL en ms
  reservationTtl: 15 * 60 * 1000,
  maxSelection:   10,
};

const FMT = new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 });

/* ─────────────────────────────────────────────────────────
   3. ESTADO
───────────────────────────────────────────────────────── */
const State = {
  tickets:          new Map(),
  selectedNumbers:  new Set(),
  reservationTimers: new Map(),
  ws:               null,
  wsReconnectDelay: 2000,
  filterAvailable:  false,
  // Foto activa en lightbox
  lightboxIndex:    0,
  // Última reserva confirmada (para el ticket)
  lastReservation:  null,
};

const STATUS = Object.freeze({ AVAILABLE:'available', RESERVED:'reserved', SOLD:'sold', SELECTED:'selected' });

/* ─────────────────────────────────────────────────────────
   4. INIT
───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  if (REAL_MODE) {
    const ok = await loadRaffleFromSupabase();
    if (!ok) return; // loadRaffleFromSupabase ya mostró el error en pantalla
  } else {
    loadDemoPhotos();
    if (RAFFLE_SLUG && !SUPABASE_CONFIGURED) {
      console.warn('[RIFATECH] Slug presente pero Supabase no está configurado. Usando modo demo.');
    }
  }

  renderPrizeGallery();
  renderRaffleHero();
  startCountdown();

  if (REAL_MODE) {
    await initTicketDataFromSupabase();
  } else {
    initTicketData();
  }

  renderGrid();
  updateStats();

  if (REAL_MODE) {
    connectRealtime();
  } else {
    connectWebSocket();
  }
});

/* ─────────────────────────────────────────────────────────
   0b. CARGA REAL DE LA RIFA DESDE SUPABASE
───────────────────────────────────────────────────────── */
async function loadRaffleFromSupabase() {
  const { data, error } = await supabaseClient
    .from('raffles')
    .select('*')
    .eq('slug', RAFFLE_SLUG)
    .maybeSingle();

  if (error || !data) {
    console.error('[RIFATECH] Error cargando rifa:', error);
    showRaffleNotFound();
    return false;
  }

  RAFFLE.id             = data.id;
  RAFFLE.prizeName      = data.prize_name;
  RAFFLE.prizeValue     = data.prize_value_cop;
  RAFFLE.ticketPrice    = data.ticket_price;
  RAFFLE.totalNumbers   = data.total_numbers;
  RAFFLE.drawDate       = data.draw_date;
  RAFFLE.reservationTtl = (data.reservation_ttl || 900) * 1000;
  RAFFLE.prizePhotos    = data.prize_image_url ? [data.prize_image_url] : [];

  // La lotería se guarda en la DB como texto (lottery_name);
  // se busca el catálogo local para día/frecuencia de sorteo.
  const match = LOTERIAS.find(l => l.name === data.lottery_name);
  RAFFLE.lotteryId = match ? match.id : 'otro';
  if (!match && data.lottery_name) {
    LOTERIAS.push({ id: 'otro', name: data.lottery_name, days: [], dayLabel: '—', freq: 'único' });
  }

  return true;
}

function showRaffleNotFound() {
  document.querySelector('main.main-content').innerHTML = `
    <div style="padding:60px 20px;text-align:center;color:var(--t2,#8a94a6)">
      <div style="font-size:48px;margin-bottom:12px">🔍</div>
      <h2 style="color:var(--t1,#fff);margin-bottom:8px">Rifa no encontrada</h2>
      <p>Este link no corresponde a ninguna rifa activa. Verifica el enlace o contacta al organizador.</p>
    </div>`;
  const bar = document.getElementById('sticky-bar');
  if (bar) bar.style.display = 'none';
}

async function initTicketDataFromSupabase() {
  const { data, error } = await supabaseClient
    .from('tickets')
    .select('number, status, expires_at')
    .eq('raffle_id', RAFFLE.id)
    .order('number');

  State.tickets.clear();
  if (error || !data) {
    console.error('[RIFATECH] Error cargando tickets:', error);
    return;
  }

  data.forEach(t => {
    State.tickets.set(t.number, {
      status: mapDbStatus(t.status),
      buyerName: null,
      expiresAt: t.expires_at ? new Date(t.expires_at).getTime() : null,
    });
    if (t.status === 'reserved' && t.expires_at) {
      scheduleLocalExpiry(t.number, new Date(t.expires_at).getTime());
    }
  });
}

/** Traduce el enum de la DB (available|reserved|paid|expired)
 *  al estado visual del frontend (available|reserved|sold). */
function mapDbStatus(dbStatus) {
  if (dbStatus === 'paid') return STATUS.SOLD;
  if (dbStatus === 'reserved') return STATUS.RESERVED;
  return STATUS.AVAILABLE; // available | expired
}

/* ─────────────────────────────────────────────────────────
   5. FOTOS DEL PREMIO
───────────────────────────────────────────────────────── */

/** Demo: carga imágenes de placeholder para la preview */
function loadDemoPhotos() {
  // En producción estas vienen del API. Para el demo usamos URLs de Unsplash.
  RAFFLE.prizePhotos = [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
    'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800&q=80',
    'https://images.unsplash.com/photo-1449426468159-d96dbf08f19f?w=800&q=80',
    'https://images.unsplash.com/photo-1609630875171-b1321377ee65?w=800&q=80',
  ];
}

function renderPrizeGallery() {
  const photos    = RAFFLE.prizePhotos;
  const mainEl    = document.getElementById('gallery-main');
  const mainImg   = document.getElementById('gallery-main-img');
  const thumbsEl  = document.getElementById('gallery-thumbs');

  if (!photos || photos.length === 0) {
    mainEl.classList.add('no-photo');
    mainEl.innerHTML = `
      <div class="gallery-no-photo-icon">📷</div>
      <div class="gallery-no-photo-text">Foto del premio no disponible</div>
      <div class="gallery-badge">PREMIO</div>`;
    thumbsEl.style.display = 'none';
    return;
  }

  // Imagen principal
  mainEl.classList.remove('no-photo');
  mainImg.src = photos[0];
  mainImg.alt = RAFFLE.prizeName;

  // Miniaturas (fotos 2..4)
  const extras = photos.slice(1, 4);
  if (extras.length === 0) {
    thumbsEl.style.display = 'none';
    return;
  }

  thumbsEl.innerHTML = extras.map((url, i) => `
    <button class="gallery-thumb" onclick="openLightbox(${i + 1})" aria-label="Ver foto ${i + 2}">
      <img src="${url}" alt="Foto ${i + 2} del premio" loading="lazy" />
    </button>`).join('');
}

/* ── LIGHTBOX ── */
function openLightbox(index) {
  const photos = RAFFLE.prizePhotos;
  if (!photos || photos.length === 0) return;
  State.lightboxIndex = index;
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = photos[index];
  document.getElementById('lightbox-counter').textContent = `${index + 1} / ${photos.length}`;
  // Ocultar flechas si solo hay 1 foto
  document.querySelector('.lightbox-prev').style.display = photos.length > 1 ? '' : 'none';
  document.querySelector('.lightbox-next').style.display = photos.length > 1 ? '' : 'none';
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

function lightboxNav(delta) {
  const photos = RAFFLE.prizePhotos;
  State.lightboxIndex = (State.lightboxIndex + delta + photos.length) % photos.length;
  document.getElementById('lightbox-img').src = photos[State.lightboxIndex];
  document.getElementById('lightbox-counter').textContent =
    `${State.lightboxIndex + 1} / ${photos.length}`;
}

// Teclado para lightbox
document.addEventListener('keydown', (e) => {
  const lb = document.getElementById('lightbox');
  if (!lb.classList.contains('open')) return;
  if (e.key === 'ArrowRight') lightboxNav(1);
  if (e.key === 'ArrowLeft')  lightboxNav(-1);
  if (e.key === 'Escape')     closeLightbox();
});

/* ─────────────────────────────────────────────────────────
   6. HERO DE LA RIFA (con datos de lotería y fecha)
───────────────────────────────────────────────────────── */
function renderRaffleHero() {
  const loteria = LOTERIAS.find(l => l.id === RAFFLE.lotteryId) || LOTERIAS[LOTERIAS.length - 1];

  document.getElementById('raffle-title').textContent       = RAFFLE.prizeName;
  document.getElementById('raffle-prize-value').textContent = FMT.format(RAFFLE.prizeValue);
  document.getElementById('raffle-lottery-name').textContent = loteria.name;
  document.getElementById('raffle-lottery-day').textContent  = loteria.dayLabel;
  document.getElementById('raffle-ticket-price').textContent = FMT.format(RAFFLE.ticketPrice);

  // Fecha formateada
  if (RAFFLE.drawDate) {
    const d = new Date(RAFFLE.drawDate + 'T12:00:00');
    document.getElementById('raffle-draw-date').textContent =
      d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}

/* ─────────────────────────────────────────────────────────
   7. CUENTA REGRESIVA AL SORTEO
───────────────────────────────────────────────────────── */
function startCountdown() {
  const el = document.getElementById('draw-countdown');
  if (!el || !RAFFLE.drawDate) return;

  function tick() {
    const now    = Date.now();
    const target = new Date(RAFFLE.drawDate + 'T00:00:00').getTime();
    const diff   = target - now;

    if (diff <= 0) {
      el.textContent = '¡HOY ES EL SORTEO! 🎉';
      return;
    }

    const days  = Math.floor(diff / 86_400_000);
    const hrs   = Math.floor((diff % 86_400_000) / 3_600_000);
    const mins  = Math.floor((diff % 3_600_000)  / 60_000);
    const secs  = Math.floor((diff % 60_000)     / 1_000);

    if (days > 0)
      el.textContent = `${days}d ${hrs}h ${mins}m`;
    else
      el.textContent = `${hrs}h ${mins}m ${secs}s`;
  }

  tick();
  setInterval(tick, 1000);
}

/* ─────────────────────────────────────────────────────────
   8. GRID DE NÚMEROS (sin cambios)
───────────────────────────────────────────────────────── */
function initTicketData() {
  for (let n = 1; n <= RAFFLE.totalNumbers; n++) {
    State.tickets.set(n, { status: STATUS.AVAILABLE, buyerName: null, expiresAt: null });
  }
  const sold     = [3, 7, 12, 17, 22, 25, 31, 44, 55, 63, 72, 88, 91, 99];
  const reserved = [8, 15, 33, 47, 60, 75, 82];
  sold.forEach(n => State.tickets.set(n, { status: STATUS.SOLD, buyerName: 'Demo', expiresAt: null }));
  reserved.forEach(n => {
    const expiresAt = Date.now() + 7 * 60 * 1000;
    State.tickets.set(n, { status: STATUS.RESERVED, buyerName: null, expiresAt });
    scheduleLocalExpiry(n, expiresAt);
  });
}

function renderGrid() {
  const grid = document.getElementById('numbers-grid');
  grid.innerHTML = '';
  for (let n = 1; n <= RAFFLE.totalNumbers; n++) {
    const btn = document.createElement('button');
    btn.id = `num-${n}`;
    btn.className = 'num-btn';
    btn.setAttribute('aria-label', `Número ${n}`);
    btn.textContent = String(n).padStart(2, '0');
    btn.addEventListener('click', () => handleNumberClick(n));
    grid.appendChild(btn);
  }
  State.tickets.forEach((data, num) => applyButtonState(num, data.status));
}

function applyButtonState(num, status) {
  const btn = document.getElementById(`num-${num}`);
  if (!btn) return;
  btn.classList.remove(STATUS.AVAILABLE, STATUS.RESERVED, STATUS.SOLD, STATUS.SELECTED, 'hidden');
  btn.classList.add(status);
  if (State.filterAvailable && status !== STATUS.AVAILABLE && status !== STATUS.SELECTED)
    btn.classList.add('hidden');
  btn.disabled = (status === STATUS.RESERVED || status === STATUS.SOLD);
  btn.setAttribute('aria-pressed', status === STATUS.SELECTED ? 'true' : 'false');
}

function handleNumberClick(num) {
  const ticket = State.tickets.get(num);
  if (!ticket) return;
  if (ticket.status === STATUS.RESERVED || ticket.status === STATUS.SOLD) {
    showToast('⚠️ Este número ya no está disponible'); return;
  }
  if (State.selectedNumbers.has(num)) {
    State.selectedNumbers.delete(num);
    applyButtonState(num, STATUS.AVAILABLE);
  } else {
    if (State.selectedNumbers.size >= RAFFLE.maxSelection) {
      showToast(`Máximo ${RAFFLE.maxSelection} números por compra`); return;
    }
    State.selectedNumbers.add(num);
    applyButtonState(num, STATUS.SELECTED);
  }
  updateStickyBar();
}

function updateStickyBar() {
  const bar   = document.getElementById('sticky-bar');
  const numEl = document.getElementById('sticky-numbers-display');
  const totEl = document.getElementById('total-amount');
  const sel   = [...State.selectedNumbers].sort((a,b) => a-b);
  const total = sel.length * RAFFLE.ticketPrice;

  if (sel.length === 0) { bar.classList.remove('visible'); return; }
  bar.classList.add('visible');

  const visible  = sel.slice(0, 5);
  const overflow = sel.length - visible.length;
  numEl.innerHTML =
    visible.map(n => `<span class="sticky-num-tag">${String(n).padStart(2,'0')}</span>`).join('') +
    (overflow > 0 ? `<span class="sticky-overflow">+${overflow} más</span>` : '');
  totEl.textContent = FMT.format(total);
}

function updateStats() {
  let sold = 0, reserved = 0;
  State.tickets.forEach(t => {
    if (t.status === STATUS.SOLD) sold++;
    if (t.status === STATUS.RESERVED) reserved++;
  });
  const available = RAFFLE.totalNumbers - sold - reserved;
  const pct       = Math.round(((sold + reserved) / RAFFLE.totalNumbers) * 100);
  const availEl   = document.getElementById('available-count');
  const fillEl    = document.getElementById('progress-fill');
  const pctEl     = document.getElementById('progress-pct');
  if (availEl) availEl.textContent = available;
  if (fillEl)  fillEl.style.width  = `${pct}%`;
  if (pctEl)   pctEl.textContent   = `${pct}%`;
}

function toggleFilterAvailable() {
  State.filterAvailable = !State.filterAvailable;
  document.getElementById('filter-available-btn').classList.toggle('active', State.filterAvailable);
  State.tickets.forEach((data, num) => {
    const btn = document.getElementById(`num-${num}`);
    if (!btn) return;
    const status = State.selectedNumbers.has(num) ? STATUS.SELECTED : data.status;
    if (State.filterAvailable && status !== STATUS.AVAILABLE && status !== STATUS.SELECTED)
      btn.classList.add('hidden');
    else
      btn.classList.remove('hidden');
  });
}

/* ─────────────────────────────────────────────────────────
   9. MODAL DE RESERVA
───────────────────────────────────────────────────────── */
function openReservationModal() {
  if (State.selectedNumbers.size === 0) return;
  const sel   = [...State.selectedNumbers].sort((a,b) => a-b);
  const total = sel.length * RAFFLE.ticketPrice;
  document.getElementById('modal-selected-preview').innerHTML =
    sel.map(n => `<span class="preview-num">${String(n).padStart(2,'0')}</span>`).join('');
  document.getElementById('modal-total').textContent = FMT.format(total);
  document.getElementById('reservation-modal').classList.add('open');
  document.getElementById('buyer-name').focus();
}

function closeModal() {
  document.getElementById('reservation-modal').classList.remove('open');
}

function closeModalOutside(event) {
  if (event.target === document.getElementById('reservation-modal')) closeModal();
}

/* ─────────────────────────────────────────────────────────
   10. CONFIRMAR RESERVA
───────────────────────────────────────────────────────── */
async function confirmReservation() {
  const name  = document.getElementById('buyer-name').value.trim();
  const phone = document.getElementById('buyer-phone').value.trim();

  if (!name || name.length < 3) { showToast('⚠️ Ingresa tu nombre completo'); return; }
  if (!phone || phone.replace(/\D/g,'').length < 7) { showToast('⚠️ Ingresa un WhatsApp válido'); return; }

  const numbers = [...State.selectedNumbers];
  const btn     = document.querySelector('.confirm-btn');
  btn.disabled  = true;
  btn.textContent = 'Procesando…';

  try {
    let ref, expiresAt;

    if (REAL_MODE) {
      const result = await reserveTicketsSupabase(numbers, name, phone);
      ref = result.serialRef;
      expiresAt = result.expiresAt;
    } else {
      await simulateApiReserve();
      ref = generateSerialRef();
      expiresAt = Date.now() + RAFFLE.reservationTtl;
    }

    numbers.forEach(n => {
      State.tickets.set(n, { status: STATUS.RESERVED, buyerName: name, expiresAt });
      applyButtonState(n, STATUS.RESERVED);
      scheduleLocalExpiry(n, expiresAt);
    });

    State.selectedNumbers.clear();
    updateStickyBar();
    updateStats();
    closeModal();

    State.lastReservation = { numbers, buyerName: name, buyerPhone: phone, serialRef: ref, expiresAt };

    showTicket(State.lastReservation);
    showToast('✅ ¡Números apartados por 15 minutos!');

  } catch (err) {
    if (err.code === 409) {
      showToast('⚡ Número tomado. Elige otro.');
      err.conflicted?.forEach(n => {
        State.tickets.set(n, { status: STATUS.SOLD });
        State.selectedNumbers.delete(n);
        applyButtonState(n, STATUS.SOLD);
      });
      updateStickyBar();
    } else {
      console.error('[RIFATECH] Error de reserva:', err);
      showToast('❌ Error de conexión. Intenta de nuevo.');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ CONFIRMAR RESERVA';
  }
}

function simulateApiReserve() {
  return new Promise(res => setTimeout(res, 800));
}

/** Llama al stored procedure reserve_tickets() de Postgres.
 *  Lanza { code:409, conflicted:[...] } si algún número ya no
 *  estaba disponible (mismo contrato de error que usaba el mock). */
async function reserveTicketsSupabase(numbers, name, phone) {
  const { data, error } = await supabaseClient.rpc('reserve_tickets', {
    p_raffle_id: RAFFLE.id,
    p_numbers: numbers,
    p_buyer_name: name,
    p_buyer_phone: phone,
    p_ttl_sec: RAFFLE.reservationTtl / 1000,
  });

  if (error) {
    if (error.code === '40001' || /CONFLICT/.test(error.message || '')) {
      const match = (error.message || '').match(/\{([\d,]+)\}/);
      const conflicted = match ? match[1].split(',').map(Number) : numbers;
      const e = new Error('conflict');
      e.code = 409;
      e.conflicted = conflicted;
      throw e;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    serialRef: row.serial_ref,
    expiresAt: Date.now() + RAFFLE.reservationTtl,
  };
}

/* ─────────────────────────────────────────────────────────
   11. EXPIRACIÓN LOCAL
───────────────────────────────────────────────────────── */
function scheduleLocalExpiry(num, expiresAt) {
  if (State.reservationTimers.has(num)) clearTimeout(State.reservationTimers.get(num));
  const delay = expiresAt - Date.now();
  if (delay <= 0) { expireReservation(num); return; }
  State.reservationTimers.set(num, setTimeout(() => expireReservation(num), delay));
}

function expireReservation(num) {
  const ticket = State.tickets.get(num);
  if (!ticket || ticket.status !== STATUS.RESERVED) return;
  State.tickets.set(num, { status: STATUS.AVAILABLE, buyerName: null, expiresAt: null });
  applyButtonState(num, STATUS.AVAILABLE);
  State.reservationTimers.delete(num);
  updateStats();
}

/* ─────────────────────────────────────────────────────────
   12. WEBSOCKET
───────────────────────────────────────────────────────── */
function connectWebSocket() {
  simulateRealtimeEvents();
}

/** Suscripción real a cambios en la tabla tickets para esta rifa. */
function connectRealtime() {
  supabaseClient
    .channel(`raffle:${RAFFLE.id}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'tickets',
      filter: `raffle_id=eq.${RAFFLE.id}`,
    }, (payload) => {
      const t = payload.new;
      const status = mapDbStatus(t.status);
      if (status === STATUS.RESERVED) {
        handleWsMessage({
          type: 'ticket_reserved',
          number: t.number,
          expiresAt: t.expires_at ? new Date(t.expires_at).getTime() : null,
        });
      } else if (status === STATUS.SOLD) {
        handleWsMessage({ type: 'ticket_sold', number: t.number });
      } else if (status === STATUS.AVAILABLE) {
        handleWsMessage({ type: 'ticket_expired', number: t.number });
      }
    })
    .subscribe();
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'ticket_reserved': {
      if (!State.selectedNumbers.has(msg.number)) {
        State.tickets.set(msg.number, { status: STATUS.RESERVED, buyerName: null, expiresAt: msg.expiresAt });
        applyButtonState(msg.number, STATUS.RESERVED);
        scheduleLocalExpiry(msg.number, msg.expiresAt);
        updateStats();
      }
      break;
    }
    case 'ticket_sold': {
      State.selectedNumbers.delete(msg.number);
      State.tickets.set(msg.number, { status: STATUS.SOLD, buyerName: null, expiresAt: null });
      applyButtonState(msg.number, STATUS.SOLD);
      updateStickyBar();
      updateStats();
      break;
    }
    case 'ticket_expired': { expireReservation(msg.number); break; }
  }
}

function simulateRealtimeEvents() {
  const available = () => [...State.tickets.entries()]
    .filter(([n, t]) => t.status === STATUS.AVAILABLE && !State.selectedNumbers.has(n))
    .map(([n]) => n);

  function next() {
    const delay = 9000 + Math.random() * 8000;
    setTimeout(() => {
      const pool = available();
      if (pool.length > 0) {
        const num = pool[Math.floor(Math.random() * pool.length)];
        handleWsMessage({ type:'ticket_reserved', number:num, expiresAt: Date.now() + RAFFLE.reservationTtl });
        if (Math.random() > 0.4)
          setTimeout(() => handleWsMessage({ type:'ticket_sold', number:num }), 3000);
      }
      next();
    }, delay);
  }
  next();
}

/* ─────────────────────────────────────────────────────────
   13. TICKET VIRTUAL — CON FOTO DEL PREMIO
───────────────────────────────────────────────────────── */
function showTicket({ numbers, buyerName, buyerPhone, serialRef, expiresAt }) {
  const area     = document.getElementById('ticket-render-area');
  const modal    = document.getElementById('ticket-modal');
  const loteria  = LOTERIAS.find(l => l.id === RAFFLE.lotteryId) || LOTERIAS[LOTERIAS.length - 1];
  const photos   = RAFFLE.prizePhotos;

  const maskedPhone = maskPhone(buyerPhone);
  const paidAmount  = FMT.format(numbers.length * RAFFLE.ticketPrice);
  const prizeValue  = FMT.format(RAFFLE.prizeValue);
  const drawDateFmt = RAFFLE.drawDate
    ? new Date(RAFFLE.drawDate + 'T12:00:00').toLocaleDateString('es-CO', { day:'numeric', month:'long', year:'numeric' })
    : '—';
  const qrUrl = REAL_MODE ? buildRaffleLink(RAFFLE_SLUG) : `${window.location.origin}/v/${serialRef}`;

  // Foto del premio en el ticket
  const photoHTML = (photos && photos.length > 0)
    ? `<div class="ticket-prize-image">
         <img src="${photos[0]}" alt="${escapeHtml(RAFFLE.prizeName)}" crossorigin="anonymous" />
       </div>`
    : `<div class="ticket-prize-image no-photo">
         <div class="ticket-prize-no-photo-icon">🏆</div>
         <div class="ticket-prize-no-photo-label">${escapeHtml(RAFFLE.prizeName)}</div>
       </div>`;

  // Números grandes
  const numsHTML = numbers
    .map(n => `<span class="ticket-num">${String(n).padStart(2,'0')}</span>`)
    .join(' ');

  area.innerHTML = `
    <div class="ticket" id="ticket-print">

      <!-- Cabecera del ticket -->
      <div class="ticket-header">
        <span class="ticket-logo">◈ RIFATECH</span>
        <span class="ticket-paid-seal">RESERVADO ✅</span>
      </div>

      <!-- Foto del premio -->
      ${photoHTML}

      <!-- Fila: lotería + día de sorteo -->
      <div class="ticket-draw-row">
        <span class="ticket-draw-badge">🎰 ${escapeHtml(loteria.name)}</span>
        <span class="ticket-draw-day">Sortea los ${escapeHtml(loteria.dayLabel)}</span>
      </div>

      <!-- Números del participante -->
      <div class="ticket-numbers-section">
        <div class="ticket-numbers-label">TUS NÚMEROS</div>
        <div class="ticket-numbers-display">${numsHTML}</div>
      </div>

      <!-- Detalles de la rifa -->
      <div class="ticket-body">
        <div class="ticket-detail-row">
          <span class="ticket-detail-label">Premio</span>
          <span class="ticket-detail-value">${escapeHtml(RAFFLE.prizeName)}</span>
        </div>
        <div class="ticket-detail-row">
          <span class="ticket-detail-label">Valor comercial</span>
          <span class="ticket-detail-value">${prizeValue}</span>
        </div>
        <div class="ticket-detail-row">
          <span class="ticket-detail-label">Fecha del sorteo</span>
          <span class="ticket-detail-value" style="color:#FFD700;font-weight:900">${drawDateFmt}</span>
        </div>
        <div class="ticket-detail-row">
          <span class="ticket-detail-label">Lotería</span>
          <span class="ticket-detail-value">${escapeHtml(loteria.name)}</span>
        </div>
        <div class="ticket-detail-row">
          <span class="ticket-detail-label">Día de sorteo</span>
          <span class="ticket-detail-value">${escapeHtml(loteria.dayLabel)}</span>
        </div>
        <div class="ticket-detail-row">
          <span class="ticket-detail-label">Total pagado</span>
          <span class="ticket-detail-value" style="color:var(--neon-green)">${paidAmount}</span>
        </div>
      </div>

      <!-- Separador perforado -->
      <div class="ticket-perforated">
        <div class="ticket-dashes"></div>
      </div>

      <!-- Pie: dueño + QR -->
      <div class="ticket-footer">
        <div class="ticket-owner-info">
          <div class="ticket-owner-name">${escapeHtml(buyerName)}</div>
          <div class="ticket-owner-phone">${maskedPhone}</div>
          <div class="ticket-serial">${serialRef}</div>
        </div>
        <div class="ticket-qr-block">
          <div class="ticket-qr-placeholder">${generateQRSVG(qrUrl)}</div>
          <div class="ticket-qr-label">VALIDAR</div>
        </div>
      </div>

    </div>`;

  modal.classList.add('open');
}

function closeTicketModal() {
  document.getElementById('ticket-modal').classList.remove('open');
}

function closeTicketModalOutside(event) {
  if (event.target === document.getElementById('ticket-modal')) closeTicketModal();
}

/* ── DESCARGAR TICKET COMO PNG ── */
async function downloadTicket() {
  const btn = document.querySelector('.download-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Generando imagen…';

  try {
    if (!window.html2canvas)
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');

    const ticket = document.getElementById('ticket-print');
    const canvas = await window.html2canvas(ticket, {
      backgroundColor: '#0D1B2A',
      scale: 3,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });

    const link    = document.createElement('a');
    link.download = `RifaTech-${State.lastReservation?.serialRef || Date.now()}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
    showToast('✅ Comprobante descargado');
  } catch (err) {
    console.error('[DOWNLOAD]', err);
    showToast('❌ Error al generar imagen');
  } finally {
    btn.disabled    = false;
    btn.textContent = '⬇ Descargar comprobante';
  }
}

/* ── COMPARTIR POR WHATSAPP ── */
function shareTicketWhatsApp() {
  const r = State.lastReservation;
  if (!r) return;

  const loteria  = LOTERIAS.find(l => l.id === RAFFLE.lotteryId) || LOTERIAS[LOTERIAS.length - 1];
  const drawFmt  = RAFFLE.drawDate
    ? new Date(RAFFLE.drawDate + 'T12:00:00').toLocaleDateString('es-CO', { day:'numeric', month:'long', year:'numeric' })
    : '—';

  const numsStr  = r.numbers.map(n => `*${String(n).padStart(2,'0')}*`).join(' · ');
  const total    = FMT.format(r.numbers.length * RAFFLE.ticketPrice);

  const msg = [
    `🎟️ *COMPROBANTE DE RIFA — RIFATECH*`,
    ``,
    `🏆 Premio: *${RAFFLE.prizeName}*`,
    `💰 Valor comercial: ${FMT.format(RAFFLE.prizeValue)}`,
    ``,
    `🎰 *Tus números: ${numsStr}*`,
    ``,
    `📅 Sorteo: *${drawFmt}*`,
    `🎲 Lotería: ${loteria.name}`,
    `📆 Día del sorteo: *${loteria.dayLabel}*`,
    ``,
    `💳 Total pagado: ${total}`,
    `🔖 Ref: ${r.serialRef}`,
    ``,
    `✅ Verifica tu boleta en: ${REAL_MODE ? buildRaffleLink(RAFFLE_SLUG) : window.location.href}`,
    ``,
    `_¡Mucha suerte! 🍀_`,
  ].join('\n');

  const phone = r.buyerPhone?.replace(/\D/g,'') || '';
  const url   = `https://wa.me/${phone ? '57' + phone : ''}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

/* ─────────────────────────────────────────────────────────
   14. UTILIDADES
───────────────────────────────────────────────────────── */
function generateSerialRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `#RT-${new Date().getFullYear()}-${s}`;
}

function maskPhone(phone) {
  const d = phone.replace(/\D/g,'');
  if (d.length < 7) return phone;
  return `${d.slice(0,3)}***${d.slice(-3)}`;
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showToast(message, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function generateQRSVG(url) {
  let cells = '';
  const size = 7;
  const seed = url.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (((seed ^ (r * 31 + c * 17)) % 3) !== 0)
        cells += `<rect x="${c*8}" y="${r*8}" width="7" height="7" fill="#000"/>`;
  const fp = (x,y) =>
    `<rect x="${x}" y="${y}" width="21" height="21" fill="#000"/>
     <rect x="${x+3}" y="${y+3}" width="15" height="15" fill="#fff"/>
     <rect x="${x+6}" y="${y+6}" width="9" height="9" fill="#000"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56" width="56" height="56">
    <rect width="56" height="56" fill="white"/>${cells}${fp(0,0)}${fp(35,0)}${fp(0,35)}</svg>`;
}
