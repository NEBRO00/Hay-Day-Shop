/* ===================================================================
   ฟาร์มมี่ช็อป — Hay Day Shop Manager
   Vanilla JS, Supabase-backed cloud database (real-time sync)
   ฟังก์ชัน load()/save()/DB_KEYS/uid() มาจาก db.js (โหลดก่อนไฟล์นี้)
=================================================================== */
function uid(prefix) { return dbUid(prefix); }
 
// ย่อ/บีบอัดรูปก่อนแปลงเป็น base64 — กันไฟล์รูปจากกล้องมือถือ (มักหลายเมกะไบต์) ทำให้
// เบราว์เซอร์กินแรมพุ่งจนแท็บ crash/รีโหลดเอง (อาการ "เด้งออกต้องรีเฟรช" ตอนอัปโหลดรูป)
function compressImageFile(file, maxDim = 900, quality = 0.85, mime = 'image/png') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('เปิดไฟล์รูปไม่สำเร็จ'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('บีบอัดรูปไม่สำเร็จ')); return; }
          resolve(blob);
        }, mime, quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// อัปโหลดไฟล์รูปที่บีบอัดแล้วขึ้น Supabase Storage แล้วคืน URL สาธารณะ
// (เก็บแค่ URL สั้นๆ ไว้ในฐานข้อมูล แทนการฝังรูปทั้งก้อนเป็น base64 — กัน error 500 ตอนข้อมูลใหญ่เกิน)
async function uploadProductPhoto(blob, mime = 'image/webp') {
  // ใช้ชนิดไฟล์จริงของ blob (บางเบราว์เซอร์เช่น Safari เข้ารหัส WebP ไม่ได้ จะคืนเป็น PNG)
  const realMime = (blob && blob.type) || mime;
  const ext = realMime === 'image/webp' ? 'webp' : (realMime === 'image/png' ? 'png' : 'jpg');
  const path = `${dbUid('img')}.${ext}`;
  // cacheControl 1 ปี: ชื่อไฟล์สุ่มใหม่ทุกครั้ง (ไม่ overwrite) เบราว์เซอร์/CDN จึงเก็บรูปไว้ ไม่โหลดซ้ำ → ลด Egress
  const { error } = await supabaseClient.storage.from('product-photos').upload(path, blob, { contentType: realMime, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  const { data } = supabaseClient.storage.from('product-photos').getPublicUrl(path);
  return data.publicUrl;
}
 
/* ---------------------- SECTION LOCK (per-view, not whole-app) ---------------------- */
/* ระบบ Login Admin จริงผ่าน Supabase Auth (Email/Password) — ข้อ 8
   Session เก็บในเบราว์เซอร์นี้เท่านั้น (localStorage/sessionStorage ของ Supabase client)
   จึงไม่มีทางแชร์ไปหาลูกค้าคนอื่นที่เปิดเว็บจากเครื่อง/เบราว์เซอร์อื่น — ข้อ 1 */
const LOCKED_VIEWS = ['dashboard', 'orders', 'customers', 'products', 'reports', 'settings'];
let pendingUnlockView = null;
let currentSession = null; // Supabase session ปัจจุบัน, null = ยังไม่ได้ login เป็น admin
 
function isAuthed() {
  return !!currentSession;
}
function applyUnlockedUI(unlocked) {
  document.body.classList.toggle('admin-unlocked', unlocked);
  document.getElementById('logoutBtn').classList.toggle('hidden', !unlocked);
}
function openUnlockModal(viewToOpen) {
  pendingUnlockView = viewToOpen;
  document.getElementById('unlockEmail').value = '';
  document.getElementById('unlockPassword').value = '';
  document.getElementById('unlockError').classList.add('hidden');
  document.getElementById('unlockBackdrop').classList.remove('hidden');
  setTimeout(() => document.getElementById('unlockEmail')?.focus(), 50);
}
function closeUnlockModal() {
  document.getElementById('unlockBackdrop').classList.add('hidden');
  pendingUnlockView = null;
}
 
document.getElementById('unlockForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('unlockEmail').value.trim();
  const pw = document.getElementById('unlockPassword').value;
  const remember = document.getElementById('unlockRemember').checked;
  localStorage.setItem('hd_admin_remember', remember ? '1' : '0');
 
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pw });
  submitBtn.disabled = false;
 
  if (error || !data.session) {
    document.getElementById('unlockError').classList.remove('hidden');
    return;
  }
  currentSession = data.session;
  applyUnlockedUI(true);
  const target = pendingUnlockView;
  closeUnlockModal();
  if (target) goToView(target);
});
document.getElementById('unlockCancelBtn').addEventListener('click', closeUnlockModal);
 
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!confirm('ล็อกส่วนหลังบ้านอีกครั้งใช่หรือไม่? คุณจะกลับไปหน้า "ขายสินค้า"')) return;
  await supabaseClient.auth.signOut();
  currentSession = null;
  applyUnlockedUI(false);
  closeSidebarMobile();
  goToView('pos');
});
 
/* ให้ทุกที่ในแอปรู้ทันทีเมื่อสถานะ login เปลี่ยน (ครอบคลุมตอนโหลดหน้าครั้งแรกที่ยังมี
   session ค้างอยู่ด้วย — Admin ไม่ต้อง login ซ้ำถ้ายังไม่ logout ตามข้อ 8) */
supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session;
  applyUnlockedUI(!!session);
});
 
/* ---------------------- STATE ---------------------- */
const state = {
  cart: [],                 // [{productId, name, image, price, qty}]
  view: 'dashboard',
  posCategoryFilter: '',
  posSepCat: null,          // id ของหมวด "โหมดแยก" ที่เปิดอยู่ (null = โหมดปกติ)
  booking: { date: '', time: '' }, // วัน/เวลาที่วนเหรียญ (หมวดที่ติ๊ก "ต้องเลือกวัน/เวลา")
  posSearch: '',
  editingProductId: null,
  reportRange: 'day',
  matchedCustomer: null,
  pendingProductPhoto: null, // base64 dataURL for product form
};
 
/* ---------------------- IMAGE HELPERS ---------------------- */
// Returns HTML for a product/cart-item thumbnail: real photo if present, else emoji.
function thumbHtml(item, cls) {
  if (item && item.photo) return `<img class="${cls}" src="${item.photo}" alt="${esc(item.name || '')}" loading="lazy" decoding="async">`;
  return `<span class="${cls === 'prod-thumb-img' ? 'p-emoji' : (cls === 'cart-thumb-img' ? 'c-emoji' : '')}">${(item && item.image) || '📦'}</span>`;
}
// Emoji/text-safe glyph for auto-generated text messages (can't embed photos in plain text).
function textGlyph(item) { return (item && item.image) || '📦'; }
 
/* ---------------------- UTILS ---------------------- */
function money(n) { return `${Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`; }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtDateTime(iso) { return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function isSameDay(a, b) { const A = new Date(a), B = new Date(b); return A.toDateString() === B.toDateString(); }
function categoryById(id) { return load(DB_KEYS.categories, []).find(c => c.id === id); }
function esc(str) { const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML; }
 
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
 
/* ---------------------- THEME ---------------------- */
function initTheme() {
  const theme = localStorage.getItem(DB_KEYS.theme) || 'light';
  document.body.classList.toggle('dark', theme === 'dark');
  updateThemeLabel();
}
function updateThemeLabel() {
  const isDark = document.body.classList.contains('dark');
  document.getElementById('themeIcon').textContent = isDark ? '☀️' : '🌙';
  document.getElementById('themeLabel').textContent = isDark ? 'โหมดกลางวัน' : 'โหมดกลางคืน';
}
document.getElementById('themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem(DB_KEYS.theme, document.body.classList.contains('dark') ? 'dark' : 'light');
  updateThemeLabel();
});
 
/* ---------------------- NAVIGATION ---------------------- */
const viewTitles = {
  dashboard: 'แดชบอร์ด', pos: 'ขายสินค้า', orders: 'ประวัติคำสั่งซื้อ',
  customers: 'ลูกค้า', products: 'จัดการสินค้า', reports: 'รายงาน', settings: 'ตั้งค่า',
};
 
function switchView(view) {
  if (LOCKED_VIEWS.includes(view) && !isAuthed() && !document.body.classList.contains('admin-unlocked')) {
    openUnlockModal(view);
    return;
  }
  goToView(view);
}
 
function goToView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('pageTitle').textContent = viewTitles[view];
  closeSidebarMobile();
  renderView(view);
}
 
function renderView(view) {
  if (view === 'dashboard') renderDashboard();
  else if (view === 'pos') renderPOS();
  else if (view === 'orders') renderOrders();
  else if (view === 'customers') renderCustomers();
  else if (view === 'products') renderProductsAdmin();
  else if (view === 'reports') renderReports();
  else if (view === 'settings') renderSettings();
}
 
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
document.getElementById('enterAdminBtn').addEventListener('click', () => openUnlockModal('dashboard'));
 
/* Mobile sidebar */
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('scrim');
document.getElementById('hamburger').addEventListener('click', () => {
  sidebar.classList.toggle('open');
  scrim.classList.toggle('show');
});
scrim.addEventListener('click', closeSidebarMobile);
function closeSidebarMobile() { sidebar.classList.remove('open'); scrim.classList.remove('show'); }
 
/* =====================================================================
   DASHBOARD
===================================================================== */
function renderDashboard() {
  const orders = load(DB_KEYS.orders, []);
  const customers = load(DB_KEYS.customers, []);
  const today = new Date();
 
  const todayOrders = orders.filter(o => isSameDay(o.createdAt, today));
  const todaySales = todayOrders.reduce((s, o) => s + o.totalPrice, 0);
 
  document.getElementById('statTodaySales').textContent = money(todaySales);
  document.getElementById('statTodayOrders').textContent = todayOrders.length;
  document.getElementById('statTotalCustomers').textContent = customers.length;
 
  // best seller overall
  const qtyMap = {};
  orders.forEach(o => o.items.forEach(it => { qtyMap[it.name] = (qtyMap[it.name] || 0) + it.qty; }));
  const best = Object.entries(qtyMap).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('statBestSeller').textContent = best ? best[0] : '-';
 
  // monthly chart, last 6 months
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('th-TH', { month: 'short' }), value: 0 });
  }
  orders.forEach(o => {
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const m = months.find(m => m.key === key);
    if (m) m.value += o.totalPrice;
  });
  renderBars('monthChart', months);
 
  // recent orders
  const recent = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const tbody = document.querySelector('#recentOrdersTable tbody');
  tbody.innerHTML = recent.length ? recent.map(o => `
    <tr>
      <td>${fmtDate(o.createdAt)}</td>
      <td>${esc(o.customerName)}</td>
      <td>${o.totalItems}</td>
      <td>${money(o.totalPrice)}</td>
      <td><span class="status-badge status-${o.status}">${o.status}</span></td>
    </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--sub-ink)">ยังไม่มีออเดอร์</td></tr>`;
}
 
function renderBars(containerId, data) {
  const el = document.getElementById(containerId);
  if (!data.length || data.every(d => d.value === 0)) {
    el.innerHTML = `<p class="empty-hint">ยังไม่มีข้อมูลยอดขาย 🌱</p>`;
    return;
  }
  const max = Math.max(...data.map(d => d.value), 1);
  el.innerHTML = data.map(d => `
    <div class="bar-col">
      <span class="bar-value">${d.value ? Math.round(d.value) : ''}</span>
      <div class="bar" style="height:${Math.max((d.value / max) * 100, 2)}%"></div>
      <span class="bar-label">${esc(d.label)}</span>
    </div>`).join('');
}
 
/* =====================================================================
   POS — ขายสินค้า
===================================================================== */
/* ---- หมวด "โหมดแยก" (มีปุ่มของตัวเอง, กดทีละ 1 ชิ้น, ไม่ตัดสต็อก) ----
   ตั้งค่าที่หน้าตั้งค่า: โหมดแยก / อยู่ใน "เพิ่มเติม" / ต้องเลือกวัน/เวลา */
const UPGRADE_CAT_ID = 'cat_upgrade_special';
function isSeparateCat(catId) { const c = categoryById(catId); return !!(c && c.separate); }
function isBookingCat(catId) { const c = categoryById(catId); return !!(c && c.separate && c.booking); }
function getSeparateCats() { return load(DB_KEYS.categories, []).filter(c => c.separate); }

// ย้ายข้อมูลเก่า (special:'upgrade') มาเป็น separate:true
function normalizeCategories() {
  const cats = load(DB_KEYS.categories, []);
  let changed = false;
  cats.forEach(c => { if (c.special === 'upgrade') { c.separate = true; delete c.special; changed = true; } });
  if (changed) save(DB_KEYS.categories, cats);
}
// สร้างหมวดของอัพเกรดให้ครั้งเดียว (หลังจากนั้นแอดมินลบ/เปลี่ยนชื่อได้อิสระ ไม่สร้างซ้ำ)
function ensureUpgradeCategory() {
  normalizeCategories();
  const settings = load(DB_KEYS.settings, {});
  if (settings.upgradeCatInit) return;
  const cats = load(DB_KEYS.categories, []);
  if (!cats.some(c => c.id === UPGRADE_CAT_ID)) {
    cats.push({ id: UPGRADE_CAT_ID, emoji: '⚒️', name: 'ของอัพเกรด', separate: true });
    save(DB_KEYS.categories, cats);
  }
  settings.upgradeCatInit = true;
  save(DB_KEYS.settings, settings);
}

function renderPOS() {
  // ถ้าหมวดโหมดแยกถูกลบ/ปิดไปแล้ว ให้กลับโหมดปกติ
  if (state.posSepCat && !isSeparateCat(state.posSepCat)) state.posSepCat = null;
  renderPosHead();
  renderCategoryChips();
  populateCategorySelect(document.getElementById('posCategoryFilter'), true, true);
  renderPosProducts();
  renderCart();
}

// แถวปุ่มหมวด: "ขนม&วัตถุดิบ" (กลับหน้าปกติ) + ปุ่มหมวดโหมดแยกหลัก + "เพิ่มเติม ▾"
function renderPosHead() {
  const seps = getSeparateCats();
  const main = seps.filter(c => !c.more);
  const more = seps.filter(c => c.more);
  const act = state.posSepCat;
  const btn = (c) => `<button type="button" class="signpost small signpost-btn ${act === c.id ? 'active' : ''}" data-sep="${c.id}"><span>${esc(c.emoji)} ${esc(c.name)}</span></button>`;
  const wrap = document.getElementById('posCatButtons');
  wrap.innerHTML = main.map(btn).join('') +
    (more.length ? `<button type="button" class="signpost small signpost-btn ${more.some(c => c.id === act) ? 'active' : ''}" id="posMoreBtn"><span>เพิ่มเติม ▾</span></button>` : '');
  wrap.querySelectorAll('[data-sep]').forEach(b => b.addEventListener('click', () => enterSepMode(b.dataset.sep)));
  const moreBtn = document.getElementById('posMoreBtn');
  const menu = document.getElementById('posMoreMenu');
  if (moreBtn) moreBtn.addEventListener('click', () => menu.classList.toggle('hidden'));
  menu.innerHTML = more.map(c => `<button type="button" class="more-item ${act === c.id ? 'active' : ''}" data-sep="${c.id}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('');
  menu.querySelectorAll('[data-sep]').forEach(b => b.addEventListener('click', () => enterSepMode(b.dataset.sep)));
  if (!more.length) menu.classList.add('hidden');

  document.getElementById('posBackBtn').classList.toggle('active', !act);
  document.getElementById('posCategoryFilter').classList.toggle('hidden', !!act);
  document.getElementById('catChips').classList.toggle('hidden', !!act);
  const ac = act ? categoryById(act) : null;
  const title = document.getElementById('posModeTitle');
  title.classList.toggle('hidden', !ac);
  if (ac) title.textContent = `${ac.emoji} ${ac.name}`;
}

function enterSepMode(catId) {
  if (!isSeparateCat(catId)) return;
  state.posSepCat = catId;
  state.posCategoryFilter = '';
  document.getElementById('posMoreMenu').classList.add('hidden');
  renderPOS();
}
function exitSepMode() {
  state.posSepCat = null;
  state.posCategoryFilter = '';
  document.getElementById('posMoreMenu').classList.add('hidden');
  renderPOS();
}

/* ---- วัน/เวลาที่วนเหรียญ (หมวดที่ติ๊ก "ต้องเลือกวัน/เวลา") ---- */
function fmtBooking(b) {
  if (!b || !b.date) return '';
  const d = new Date(b.date + 'T00:00:00');
  const day = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  return `${day}${b.time ? ' ' + b.time : ''}`;
}
function renderBookingBoxes() {
  const needsCart = state.cart.some(c => isBookingCat(c.category));
  const needsPos = !!(state.posSepCat && isBookingCat(state.posSepCat));
  [['bookingBoxCart', needsCart], ['bookingBoxPos', needsPos]].forEach(([id, show]) => {
    const box = document.getElementById(id);
    box.classList.toggle('hidden', !show);
    if (!show) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="booking-title">🗓️ เลือกวัน/เวลาที่วนเหรียญ</div>
      <div class="booking-row">
        <input type="date" class="booking-date" value="${esc(state.booking.date)}">
        <input type="time" class="booking-time" value="${esc(state.booking.time)}">
      </div>`;
    box.querySelector('.booking-date').addEventListener('change', e => { state.booking.date = e.target.value; renderBookingBoxes(); });
    box.querySelector('.booking-time').addEventListener('change', e => { state.booking.time = e.target.value; renderBookingBoxes(); });
  });
}
 
function renderCategoryChips() {
  const cats = load(DB_KEYS.categories, []).filter(c => !c.separate);
  const wrap = document.getElementById('catChips');
  wrap.innerHTML = `<button class="chip ${state.posCategoryFilter === '' ? 'active' : ''}" data-cat="">ทั้งหมด</button>` +
    cats.map(c => `<button class="chip ${state.posCategoryFilter === c.id ? 'active' : ''}" data-cat="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join('');
  wrap.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.posCategoryFilter = chip.dataset.cat;
      document.getElementById('posCategoryFilter').value = chip.dataset.cat;
      renderPosProducts();
    });
  });
}
 
function populateCategorySelect(select, withAll, excludeSpecial) {
  const cats = load(DB_KEYS.categories, []).filter(c => !(excludeSpecial && c.separate));
  const current = select.value;
  select.innerHTML = (withAll ? `<option value="">ทุกหมวดหมู่</option>` : '') +
    cats.map(c => `<option value="${c.id}">${c.emoji} ${esc(c.name)}</option>`).join('');
  if (current) select.value = current;
}
 
document.getElementById('posBackBtn').addEventListener('click', exitSepMode);

document.getElementById('posSearch').addEventListener('input', e => {
  state.posSearch = e.target.value.trim().toLowerCase();
  renderPosProducts();
});
document.getElementById('posCategoryFilter').addEventListener('change', e => {
  state.posCategoryFilter = e.target.value;
  renderCategoryChips();
  renderPosProducts();
});
 
/* ยอดขายสะสมต่อสินค้า (นับจากประวัติออเดอร์ทั้งหมด) ใช้จัดลำดับความนิยม — ข้อ 5 */
function getProductSalesMap() {
  const orders = load(DB_KEYS.orders, []);
  const map = {};
  orders.forEach(o => {
    (o.items || []).forEach(it => {
      map[it.productId] = (map[it.productId] || 0) + (it.qty || 0);
    });
  });
  return map;
}

function renderPosProducts() {
  const products = load(DB_KEYS.products, []);
  const categories = load(DB_KEYS.categories, []);
  const catOrder = {};
  categories.forEach((c, i) => { catOrder[c.id] = i; });
  const salesMap = getProductSalesMap();

  const sepIds = new Set(categories.filter(c => c.separate).map(c => c.id));
  const act = state.posSepCat;
  let list = products.filter(p =>
    (act
      ? p.category === act
      : !sepIds.has(p.category) && (!state.posCategoryFilter || p.category === state.posCategoryFilter)) &&
    (!state.posSearch || p.name.toLowerCase().includes(state.posSearch))
  );

  // ข้อ 6: จัดกลุ่มสินค้าหมวดเดียวกันไว้ติดกัน (เรียงตามลำดับหมวดหมู่ที่ตั้งไว้)
  // ข้อ 5: ภายในหมวดเดียวกัน เรียงจากสินค้าที่ลูกค้าเลือก/สั่งมากไปน้อย
  list = list.slice().sort((a, b) => {
    const catA = catOrder[a.category] ?? 999;
    const catB = catOrder[b.category] ?? 999;
    if (catA !== catB) return catA - catB;
    return (salesMap[b.id] || 0) - (salesMap[a.id] || 0);
  });

  const grid = document.getElementById('posProductGrid');
  grid.innerHTML = list.length ? list.map(p => {
    const cat = categoryById(p.category);
    const isSep = sepIds.has(p.category);
    const out = !isSep && p.stock <= 0;
    return `
    <div class="product-card ${out ? 'out' : ''}" data-id="${p.id}" title="${out ? 'สินค้าหมด' : 'เพิ่มลงตะกร้า'}">
      ${thumbHtml(p, 'prod-thumb-img')}
      <span class="p-name">${esc(p.name)}</span>
      <span class="p-price">${money(p.price)}</span>
      <span class="p-stock">${isSep ? '' : (out ? 'สินค้าหมด' : `คงเหลือ ${p.stock} · `)}${cat ? cat.emoji : ''}</span>
    </div>`;
  }).join('') : `<p class="empty-hint">ไม่พบสินค้า</p>`;
 
  grid.querySelectorAll('.product-card:not(.out)').forEach(card => {
    card.addEventListener('click', () => addToCart(card.dataset.id));
  });
}
 
function stepForCategory(catId) { return isSeparateCat(catId) ? 1 : 10; }

function addToCart(productId) {
  const product = load(DB_KEYS.products, []).find(p => p.id === productId);
  if (!product) return;
  const existing = state.cart.find(c => c.productId === productId);
  const inCartQty = existing ? existing.qty : 0;
  const STEP = stepForCategory(product.category); // ปกติกดเพิ่ม 1 ครั้ง = 10 ชิ้น / ของอัพเกรด = 1 ชิ้น
  if (!isSeparateCat(product.category) && inCartQty + STEP > product.stock) { toast('⚠️ สินค้าคงเหลือไม่พอ'); return; }
  if (existing) existing.qty += STEP;
  else state.cart.push({ productId, name: product.name, image: product.image, photo: product.photo, price: product.price, category: product.category, qty: STEP });
  renderCart();
  toast(`เพิ่ม ${product.image || ''} ${product.name} ลงตะกร้าแล้ว`);
}
 
function renderCart() {
  const list = document.getElementById('cartList');
  if (!state.cart.length) {
    list.innerHTML = `<p class="empty-hint">ยังไม่มีสินค้าในตะกร้า 🧺</p>`;
  } else {
    // ข้อ 2: จัดกลุ่มตามหมวดหมู่เดิมของร้าน (ติดกัน) แล้วในหมวดเดียวกันเรียงจากสั่งมาก -> น้อย
    // เท่ากัน: คงลำดับเดิมของสินค้าตามที่ตั้งไว้ในร้าน แล้วตามด้วยชื่อ เพื่อให้เรียงสม่ำเสมอ
    const products = load(DB_KEYS.products, []);
    const categories = load(DB_KEYS.categories, []);
    const catOrder = {};
    categories.forEach((c, i) => { catOrder[c.id] = i; });
    const productOrder = {};
    products.forEach((p, i) => { productOrder[p.id] = i; });

    const sortedCart = state.cart.slice().sort((a, b) => {
      const prodA = products.find(p => p.id === a.productId);
      const prodB = products.find(p => p.id === b.productId);
      const catA = catOrder[prodA?.category] ?? 999;
      const catB = catOrder[prodB?.category] ?? 999;
      if (catA !== catB) return catA - catB;
      if (b.qty !== a.qty) return b.qty - a.qty;
      const origA = productOrder[a.productId] ?? 999;
      const origB = productOrder[b.productId] ?? 999;
      if (origA !== origB) return origA - origB;
      return a.name.localeCompare(b.name, 'th');
    });

    list.innerHTML = sortedCart.map(c => `
      <div class="cart-row" data-id="${c.productId}">
        ${thumbHtml(c, 'cart-thumb-img')}
        <div class="c-info">
          <div class="c-name">${esc(c.name)}</div>
          <div class="c-price">${money(c.price)} / ชิ้น</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-minus" aria-label="ลดจำนวน">−</button>
          <input type="number" min="1" value="${c.qty}" class="qty-input">
          <button class="qty-plus" aria-label="เพิ่มจำนวน">+</button>
        </div>
        <button class="remove-btn" aria-label="ลบออกจากตะกร้า">✕</button>
      </div>`).join('');

    list.querySelectorAll('.cart-row').forEach(row => {
      const pid = row.dataset.id;
      const idx = state.cart.findIndex(c => c.productId === pid);
      const step = stepForCategory(state.cart[idx].category);
      row.querySelector('.qty-minus').addEventListener('click', () => changeQty(idx, -step));
      row.querySelector('.qty-plus').addEventListener('click', () => changeQty(idx, step));
      row.querySelector('.qty-input').addEventListener('change', e => setQty(idx, Number(e.target.value)));
      row.querySelector('.remove-btn').addEventListener('click', () => { state.cart.splice(idx, 1); renderCart(); });
    });
  }

  // ข้อ 3: สรุปท้ายรายการ 2 บรรทัด — "รวมทั้งหมด X รายการ | Y ชิ้น" และ "ยอดรวม Z บาท"
  const totalLines = state.cart.length;
  const totalItems = state.cart.reduce((s, c) => s + c.qty, 0);
  const totalPrice = state.cart.reduce((s, c) => s + c.qty * c.price, 0);
  document.getElementById('cartTotalLines').textContent = totalLines;
  document.getElementById('cartTotalItems').textContent = totalItems;
  document.getElementById('cartTotalPrice').textContent =
    totalPrice.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  renderBookingBoxes();
}
 
function changeQty(idx, delta) { setQty(idx, state.cart[idx].qty + delta); }
function setQty(idx, qty) {
  const item = state.cart[idx];
  const product = load(DB_KEYS.products, []).find(p => p.id === item.productId);
  const max = (product && !isSeparateCat(product.category)) ? product.stock : 9999;
  if (qty < 1) { state.cart.splice(idx, 1); renderCart(); return; }
  if (qty > max) { toast('⚠️ สินค้าคงเหลือไม่พอ'); qty = max; }
  item.qty = qty;
  renderCart();
}
 
/* ---- Customer autofill ---- */
const custNameInput = document.getElementById('custName');
custNameInput.addEventListener('input', () => {
  const q = custNameInput.value.trim().toLowerCase();
  const box = document.getElementById('custAutofill');
  document.getElementById('custHistoryHint').innerHTML = '';
  state.matchedCustomer = null;
  if (!q) { box.innerHTML = ''; return; }
  const matches = load(DB_KEYS.customers, []).filter(c => c.name.toLowerCase().includes(q)).slice(0, 5);
  box.innerHTML = matches.map(c => `<div class="af-item" data-id="${c.id}">${esc(c.name)} <small style="color:var(--sub-ink)">${esc(c.farmTag || '')}</small></div>`).join('');
  box.querySelectorAll('.af-item').forEach(item => {
    item.addEventListener('click', () => selectCustomer(item.dataset.id));
  });
});
 
function selectCustomer(customerId) {
  const c = load(DB_KEYS.customers, []).find(x => x.id === customerId);
  if (!c) return;
  document.getElementById('custName').value = c.name;
  document.getElementById('custTag').value = c.farmTag || '';
  const phoneInput = document.getElementById('custPhone');
  if (phoneInput) phoneInput.value = c.phone || '';
  const noteInput = document.getElementById('custNote');
  if (noteInput) noteInput.value = c.note || '';
  document.getElementById('custAutofill').innerHTML = '';
  state.matchedCustomer = c;
  showCustomerHint(c);
}
 
function showCustomerHint(customer) {
  const stats = computeCustomerStats(customer.id);
  const hint = document.getElementById('custHistoryHint');
  if (!stats.count) { hint.innerHTML = ''; return; }
  const freq = stats.frequentItems.slice(0, 3).map(f => f.name).join(', ');
  hint.innerHTML = `👋 ลูกค้าเก่า! เคยซื้อ <strong>${stats.count}</strong> ครั้ง ยอดรวม <strong>${money(stats.totalSpent)}</strong>${freq ? ` · สินค้าที่ซื้อบ่อย: ${esc(freq)}` : ''}`;
}
 
function computeCustomerStats(customerId) {
  const orders = load(DB_KEYS.orders, []).filter(o => o.customerId === customerId);
  const count = orders.length;
  const totalItems = orders.reduce((s, o) => s + o.totalItems, 0);
  const totalSpent = orders.reduce((s, o) => s + o.totalPrice, 0);
  const lastOrder = orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const qtyMap = {};
  orders.forEach(o => o.items.forEach(it => { qtyMap[it.name] = (qtyMap[it.name] || 0) + it.qty; }));
  const frequentItems = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).map(([name, qty]) => ({ name, qty }));
  return { count, totalItems, totalSpent, lastOrder, frequentItems, orders };
}
 
/* ---- Confirm order ---- */
document.getElementById('confirmOrderBtn').addEventListener('click', confirmOrder);
 
function confirmOrder() {
  const name = document.getElementById('custName').value.trim();
  if (!name) { toast('⚠️ กรุณากรอกชื่อลูกค้า'); custNameInput.focus(); return; }
  if (!state.cart.length) { toast('⚠️ ตะกร้าสินค้าว่างเปล่า'); return; }
  const needsBooking = state.cart.some(c => isBookingCat(c.category));
  if (needsBooking && (!state.booking.date || !state.booking.time)) { toast('⚠️ กรุณาเลือกวัน/เวลาที่วนเหรียญ'); return; }
 
  const farmTag = document.getElementById('custTag').value.trim();
  const phoneInput = document.getElementById('custPhone');
  const noteInput = document.getElementById('custNote');
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const note = noteInput ? noteInput.value.trim() : '';
 
  const customers = load(DB_KEYS.customers, []);
  let customer = state.matchedCustomer || customers.find(c => c.name.toLowerCase() === name.toLowerCase() && (farmTag ? c.farmTag === farmTag : true));
  if (!customer) {
    customer = { id: uid('c'), name, farmTag, createdAt: new Date().toISOString() };
    if (phone) customer.phone = phone;
    if (note) customer.note = note;
    customers.push(customer);
  } else {
    customer.farmTag = farmTag || customer.farmTag;
    if (phone) customer.phone = phone;
    if (note) customer.note = note;
  }
  save(DB_KEYS.customers, customers);
 
  const products = load(DB_KEYS.products, []);
  const items = state.cart.map(c => ({ productId: c.productId, name: c.name, image: c.image, photo: c.photo, price: c.price, category: c.category, qty: c.qty }));
  items.forEach(it => {
    const p = products.find(p => p.id === it.productId);
    if (p && !isSeparateCat(p.category)) p.stock = Math.max(0, p.stock - it.qty);
  });
  save(DB_KEYS.products, products);
 
  const totalItems = items.reduce((s, i) => s + i.qty, 0);
  const totalPrice = items.reduce((s, i) => s + i.qty * i.price, 0);
 
  const order = {
    id: uid('o'), customerId: customer.id, customerName: customer.name, farmTag: customer.farmTag,
    items, totalItems, totalPrice, status: 'รอชำระ', createdAt: new Date().toISOString(),
  };
  if (needsBooking) order.booking = { date: state.booking.date, time: state.booking.time };
  const orders = load(DB_KEYS.orders, []);
  orders.push(order);
  save(DB_KEYS.orders, orders);
 
  showOrderMessage(order);
 
  state.cart = [];
  state.booking = { date: '', time: '' };
  renderCart();
  document.getElementById('custAutofill').innerHTML = '';
  document.getElementById('custHistoryHint').innerHTML = '';
  state.matchedCustomer = null;
  renderPosProducts();
}
 
function buildOrderMessageText(order) {
  const lines = [];
  lines.push(`ชื่อ : ${order.customerName}`);
  lines.push(`แท็กฟาร์ม : ${order.farmTag || '-'}`);
  lines.push('====================');
  lines.push('รายการสินค้า');

  const categories = load(DB_KEYS.categories, []);
  const catOrder = {};
  categories.forEach((c, i) => { catOrder[c.id] = i; });

  const groups = {};
  order.items.forEach(it => {
    const key = it.category || '__none__';
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  });

  const groupKeys = Object.keys(groups).sort((a, b) => (catOrder[a] ?? 999) - (catOrder[b] ?? 999));

  groupKeys.forEach(key => {
    const cat = key === '__none__' ? null : categoryById(key);
    const catName = cat ? (cat.summaryTitle || cat.name) : null;
    if (catName) lines.push(`${catName} :`);
    const sortedItems = groups[key].slice().sort((a, b) => b.qty - a.qty);
    sortedItems.forEach(it => lines.push(`${textGlyph(it)} ${it.name} x${it.qty}`));
    if (cat && cat.separate && cat.booking && order.booking) lines.push(`🗓️ เวลาวน : ${fmtBooking(order.booking)}`);
  });

  lines.push('====================');
  lines.push(`รวมทั้งหมด ${order.totalItems} ชิ้น  ${order.items.length} รายการ`);
  lines.push(`ยอดรวม ${order.totalPrice.toLocaleString('th-TH')} บาท`);
  lines.push('');
  lines.push(`🗓️ ${fmtDateTime(order.createdAt)}`);
  lines.push(`เลขที่ออเดอร์ : ${order.id}`);
  return lines.join('\n');
}
 
let lastOrderMessage = '';
function showOrderMessage(order) {
  lastOrderMessage = buildOrderMessageText(order);
  document.getElementById('orderMessageText').textContent = lastOrderMessage;
  const settings = load(DB_KEYS.settings, {});
  const qrBox = document.getElementById('promptpayPreview');
  if (settings.promptpayQr) {
    document.getElementById('promptpayImg').src = settings.promptpayQr;
    qrBox.classList.remove('hidden');
  } else {
    qrBox.classList.add('hidden');
  }
  document.getElementById('msgModalBackdrop').classList.remove('hidden');
}
document.getElementById('closeMsgBtn').addEventListener('click', () => {
  document.getElementById('msgModalBackdrop').classList.add('hidden');
  renderView(state.view);
});
document.getElementById('copyMsgBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(lastOrderMessage); toast('📋 คัดลอกแล้ว'); }
  catch { toast('⚠️ คัดลอกไม่สำเร็จ'); }
});
document.getElementById('shareMsgBtn').addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({ text: lastOrderMessage, title: 'ใบสั่งซื้อฟาร์มมี่ช็อป' }); }
    catch { /* cancelled */ }
  } else {
    try { await navigator.clipboard.writeText(lastOrderMessage); toast('📋 อุปกรณ์นี้แชร์ไม่ได้ คัดลอกให้แล้ว'); }
    catch { toast('⚠️ แชร์ไม่สำเร็จ'); }
  }
});
 
/* =====================================================================
   ORDERS HISTORY
===================================================================== */
let orderFilters = { search: '', status: '' };
document.getElementById('orderSearch').addEventListener('input', e => { orderFilters.search = e.target.value.trim().toLowerCase(); renderOrders(); });
document.getElementById('orderStatusFilter').addEventListener('change', e => { orderFilters.status = e.target.value; renderOrders(); });
 
function renderOrders() {
  const orders = load(DB_KEYS.orders, []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const filtered = orders.filter(o =>
    (!orderFilters.status || o.status === orderFilters.status) &&
    (!orderFilters.search || o.customerName.toLowerCase().includes(orderFilters.search) || (o.farmTag || '').toLowerCase().includes(orderFilters.search))
  );
  const tbody = document.querySelector('#ordersTable tbody');
  tbody.innerHTML = filtered.length ? filtered.map(o => `
    <tr>
      <td>${fmtDate(o.createdAt)}</td>
      <td>${esc(o.customerName)}</td>
      <td>${esc(o.farmTag || '-')}</td>
      <td>${o.totalItems}</td>
      <td>${money(o.totalPrice)}</td>
      <td>
        <select class="status-select" data-id="${o.id}">
          ${['รอชำระ', 'ชำระแล้ว', 'ส่งของแล้ว', 'เสร็จสิ้น'].map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><button class="row-btn ghost" data-detail="${o.id}">ดูรายละเอียด</button></td>
    </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:var(--sub-ink)">ไม่พบออเดอร์</td></tr>`;
 
  tbody.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const orders = load(DB_KEYS.orders, []);
      const o = orders.find(x => x.id === sel.dataset.id);
      if (o) { o.status = sel.value; save(DB_KEYS.orders, orders); toast('อัปเดตสถานะแล้ว'); renderDashboard(); }
    });
  });
  tbody.querySelectorAll('[data-detail]').forEach(btn => {
    btn.addEventListener('click', () => showOrderDetail(btn.dataset.detail));
  });
}
 
function showOrderDetail(orderId) {
  const o = load(DB_KEYS.orders, []).find(x => x.id === orderId);
  if (!o) return;
  document.getElementById('orderDetailBody').innerHTML = `
    <p><strong>ลูกค้า:</strong> ${esc(o.customerName)} · <strong>Tag:</strong> ${esc(o.farmTag || '-')}</p>
    <p><strong>วันที่:</strong> ${fmtDateTime(o.createdAt)} · <strong>สถานะ:</strong> <span class="status-badge status-${o.status}">${o.status}</span></p>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>สินค้า</th><th>จำนวน</th><th>ราคา/ชิ้น</th><th>รวม</th></tr></thead>
      <tbody>${o.items.map(it => `<tr><td>${thumbHtml(it, 'table-thumb-img')}</td><td>${esc(it.name)}</td><td>${it.qty}</td><td>${money(it.price)}</td><td>${money(it.qty * it.price)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${o.booking ? `<p><strong>🗓️ เวลาวนเหรียญ:</strong> ${esc(fmtBooking(o.booking))}</p>` : ''}
    <p style="text-align:right;margin-top:10px"><strong>รวมทั้งหมด ${o.totalItems} ชิ้น — ${money(o.totalPrice)}</strong></p>`;
  document.getElementById('orderDetailBackdrop').classList.remove('hidden');
}
document.getElementById('closeOrderDetailBtn').addEventListener('click', () => document.getElementById('orderDetailBackdrop').classList.add('hidden'));
 
/* =====================================================================
   CUSTOMERS
===================================================================== */
document.getElementById('customerSearch').addEventListener('input', renderCustomers);
 
function renderCustomers() {
  const q = document.getElementById('customerSearch').value.trim().toLowerCase();
  const customers = load(DB_KEYS.customers, []);
  const filtered = customers.filter(c => !q || c.name.toLowerCase().includes(q) || (c.farmTag || '').toLowerCase().includes(q));
  const grid = document.getElementById('customerGrid');
  grid.innerHTML = filtered.length ? filtered.map(c => {
    const stats = computeCustomerStats(c.id);
    return `
    <div class="customer-card" data-id="${c.id}">
      <div class="cc-name">${esc(c.name)}</div>
      <div class="cc-tag">${esc(c.farmTag || 'ไม่มี Tag')}</div>
      <div class="cc-stats">
        <div><strong>${stats.count}</strong><span>ครั้ง</span></div>
        <div><strong>${money(stats.totalSpent)}</strong><span>ยอดรวม</span></div>
        <div><strong>${stats.lastOrder ? fmtDate(stats.lastOrder.createdAt) : '-'}</strong><span>ล่าสุด</span></div>
      </div>
    </div>`;
  }).join('') : `<p class="empty-hint">ไม่พบลูกค้า</p>`;
 
  grid.querySelectorAll('.customer-card').forEach(card => {
    card.addEventListener('click', () => showCustomerDetail(card.dataset.id));
  });
}
 
function showCustomerDetail(customerId) {
  const c = load(DB_KEYS.customers, []).find(x => x.id === customerId);
  if (!c) return;
  const stats = computeCustomerStats(customerId);
  document.getElementById('customerDetailBody').innerHTML = `
    <p><strong>${esc(c.name)}</strong> · ${esc(c.farmTag || 'ไม่มี Tag')} ${c.phone ? `· 📞 ${esc(c.phone)}` : ''}</p>
    ${c.note ? `<p style="color:var(--sub-ink)">📝 ${esc(c.note)}</p>` : ''}
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin:14px 0">
      <div class="stat-card sky"><span class="stat-emoji">🧾</span><div><small>ซื้อทั้งหมด</small><strong>${stats.count} ครั้ง</strong></div></div>
      <div class="stat-card grass"><span class="stat-emoji">📦</span><div><small>ซื้อสินค้า</small><strong>${stats.totalItems} ชิ้น</strong></div></div>
      <div class="stat-card sun"><span class="stat-emoji">💰</span><div><small>ยอดรวม</small><strong>${money(stats.totalSpent)}</strong></div></div>
    </div>
    <div class="signpost small"><span>สินค้าที่ซื้อบ่อย</span></div>
    <ol class="ranked-list">${stats.frequentItems.slice(0, 5).map(f => `<li>${esc(f.name)} — ${f.qty} ชิ้น</li>`).join('') || '<li>ไม่มีข้อมูล</li>'}</ol>
    <div class="signpost small"><span>ประวัติการสั่งซื้อ</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>วันที่</th><th>จำนวน</th><th>ยอดเงิน</th><th>สถานะ</th></tr></thead>
      <tbody>${stats.orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(o => `<tr><td>${fmtDate(o.createdAt)}</td><td>${o.totalItems}</td><td>${money(o.totalPrice)}</td><td><span class="status-badge status-${o.status}">${o.status}</span></td></tr>`).join('') || `<tr><td colspan="4" style="text-align:center">ไม่มีประวัติ</td></tr>`}</tbody>
    </table></div>`;
  document.getElementById('customerDetailBackdrop').classList.remove('hidden');
}
document.getElementById('closeCustomerDetailBtn').addEventListener('click', () => document.getElementById('customerDetailBackdrop').classList.add('hidden'));
 
/* =====================================================================
   PRODUCTS ADMIN
===================================================================== */
function renderProductsAdmin() {
  populateCategorySelect(document.getElementById('prodCategory'), false);
  populateCategorySelect(document.getElementById('importCategory'), false);
  populateCategorySelect(document.getElementById('adminCategoryFilter'), true);
  renderProductsTable();
}
 
document.getElementById('adminProductSearch').addEventListener('input', renderProductsTable);
document.getElementById('adminCategoryFilter').addEventListener('change', renderProductsTable);
 
function renderProductsTable() {
  const q = document.getElementById('adminProductSearch').value.trim().toLowerCase();
  const catFilter = document.getElementById('adminCategoryFilter').value;
  const products = load(DB_KEYS.products, []).filter(p =>
    (!q || p.name.toLowerCase().includes(q)) && (!catFilter || p.category === catFilter)
  );
  const tbody = document.querySelector('#productsTable tbody');
  tbody.innerHTML = products.length ? products.map(p => {
    const cat = categoryById(p.category);
    return `
    <tr>
      <td style="font-size:22px">${thumbHtml(p, 'table-thumb-img')}</td>
      <td>${esc(p.name)}</td>
      <td>${cat ? `${cat.emoji} ${esc(cat.name)}` : '-'}</td>
      <td>${money(p.price)}</td>
      <td>${isSeparateCat(p.category) ? 'ไม่จำกัด' : p.stock}</td>
      <td>
        <button class="row-btn" data-edit="${p.id}">แก้ไข</button>
        <button class="row-btn danger" data-del="${p.id}">ลบ</button>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" style="text-align:center;color:var(--sub-ink)">ไม่พบสินค้า</td></tr>`;
 
  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => editProduct(btn.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => deleteProduct(btn.dataset.del)));
}
 
function editProduct(id) {
  const p = load(DB_KEYS.products, []).find(x => x.id === id);
  if (!p) return;
  document.getElementById('prodId').value = p.id;
  document.getElementById('prodImage').value = p.image;
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodPrice').value = p.price;
  document.getElementById('prodCategory').value = p.category;
  document.getElementById('prodStock').value = p.stock;
  document.getElementById('cancelEditProductBtn').classList.remove('hidden');
  document.getElementById('saveProductBtn').textContent = '💾 บันทึกการแก้ไข';
  state.pendingProductPhoto = p.photo || null;
  setProductPhotoPreview(p.photo || null);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
 
function setProductPhotoPreview(dataUrl) {
  const img = document.getElementById('prodPhotoPreview');
  const removeBtn = document.getElementById('removeProdPhotoBtn');
  if (dataUrl) { img.src = dataUrl; img.classList.remove('hidden'); removeBtn.classList.remove('hidden'); }
  else { img.src = ''; img.classList.add('hidden'); removeBtn.classList.add('hidden'); }
}
 
document.getElementById('prodPhotoUpload').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  toast('⏳ กำลังอัปโหลดรูป...');
  try {
    const blob = await compressImageFile(file, 800, 0.8, 'image/webp');
    const url = await uploadProductPhoto(blob, 'image/webp');
    state.pendingProductPhoto = url;
    setProductPhotoPreview(url);
    toast('✅ อัปโหลดรูปสำเร็จ');
  } catch (err) {
    console.error('upload product photo error', err);
    toast('⚠️ อัปโหลดรูปไม่สำเร็จ ลองใหม่หรือเลือกไฟล์อื่น');
  }
});
document.getElementById('removeProdPhotoBtn').addEventListener('click', () => {
  state.pendingProductPhoto = null;
  document.getElementById('prodPhotoUpload').value = '';
  setProductPhotoPreview(null);
});
 
async function deleteProduct(id) {
  if (!confirm('ลบสินค้านี้ใช่หรือไม่?')) return;
  const products = (await loadFresh(DB_KEYS.products, [])).filter(p => p.id !== id);
  save(DB_KEYS.products, products);
  toast('🗑️ ลบสินค้าแล้ว');
  renderProductsTable();
}
 
document.getElementById('saveProductBtn').addEventListener('click', async () => {
  const id = document.getElementById('prodId').value;
  const image = document.getElementById('prodImage').value.trim() || '📦';
  const name = document.getElementById('prodName').value.trim();
  const price = parseFloat(document.getElementById('prodPrice').value);
  const category = document.getElementById('prodCategory').value;
  let stock = parseInt(document.getElementById('prodStock').value, 10);
  if (isNaN(stock) && isSeparateCat(category)) stock = 0; // หมวดโหมดแยกไม่ตัดสต็อก
 
  if (!name) { toast('⚠️ กรุณากรอกชื่อสินค้า'); return; }
  if (isNaN(price) || price < 0) { toast('⚠️ ราคาไม่ถูกต้อง'); return; }
  if (isNaN(stock) || stock < 0) { toast('⚠️ จำนวนคงเหลือไม่ถูกต้อง'); return; }
 
  const photo = state.pendingProductPhoto;
  const products = await loadFresh(DB_KEYS.products, []);
  if (id) {
    const p = products.find(x => x.id === id);
    if (p) Object.assign(p, { image, name, price, category, stock, photo });
    else products.push({ id, image, name, price, category, stock, photo });
    toast('💾 บันทึกการแก้ไขแล้ว');
  } else {
    products.push({ id: uid('p'), image, name, price, category, stock, photo });
    toast('✅ เพิ่มสินค้าใหม่แล้ว');
  }
  save(DB_KEYS.products, products);
  resetProductForm();
  renderProductsTable();
});
 
document.getElementById('cancelEditProductBtn').addEventListener('click', resetProductForm);

/* ---- นำเข้าหลายรายการ: วางข้อความทีละบรรทัด "ชื่อสินค้า ราคา" ---- */
function parseImportLines(text) {
  const out = [];
  text.split(/\r?\n/).forEach(raw => {
    const line = raw.replace(/^[\s\-•*·]+/, '').replace(/฿|บาท/g, '').trim();
    const m = line.match(/^(.*\S)\s+(\d+(?:\.\d+)?)\s*$/);
    if (m) out.push({ name: m[1].trim(), price: parseFloat(m[2]) });
  });
  return out;
}
// เพิ่มสินค้าที่ยังไม่มี (เทียบจากชื่อ + หมวด) คืนค่า {added, skipped}
function addProductsBulk(products, categoryId, items, stock) {
  let added = 0, skipped = 0;
  const unlimited = isSeparateCat(categoryId);
  items.forEach(it => {
    if (products.some(p => p.category === categoryId && p.name === it.name)) { skipped++; return; }
    products.push({ id: uid('p'), image: '📦', name: it.name, price: it.price, category: categoryId, stock: unlimited ? 0 : stock });
    added++;
  });
  return { added, skipped };
}
document.getElementById('importBtn').addEventListener('click', async () => {
  const categoryId = document.getElementById('importCategory').value;
  const items = parseImportLines(document.getElementById('importText').value);
  const stock = parseInt(document.getElementById('importStock').value, 10);
  if (!categoryId) { toast('⚠️ กรุณาเลือกหมวดหมู่'); return; }
  if (!items.length) { toast('⚠️ ไม่พบรายการ (รูปแบบ: ชื่อสินค้า ราคา ทีละบรรทัด)'); return; }
  const products = await loadFresh(DB_KEYS.products, []);
  const { added, skipped } = addProductsBulk(products, categoryId, items, isNaN(stock) || stock < 0 ? 100 : stock);
  save(DB_KEYS.products, products);
  document.getElementById('importText').value = '';
  renderProductsTable();
  toast(`✅ เพิ่ม ${added} รายการ${skipped ? ` (ข้ามที่ซ้ำ ${skipped})` : ''}`);
});
function resetProductForm() {
  document.getElementById('prodId').value = '';
  document.getElementById('prodImage').value = '';
  document.getElementById('prodName').value = '';
  document.getElementById('prodPrice').value = '';
  document.getElementById('prodStock').value = '';
  document.getElementById('cancelEditProductBtn').classList.add('hidden');
  document.getElementById('saveProductBtn').textContent = '💾 บันทึกสินค้า';
  document.getElementById('prodPhotoUpload').value = '';
  state.pendingProductPhoto = null;
  setProductPhotoPreview(null);
}
 
/* =====================================================================
   REPORTS
===================================================================== */
document.querySelectorAll('.report-tabs .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.report-tabs .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.reportRange = chip.dataset.range;
    renderReports();
  });
});
 
function renderReports() {
  const orders = load(DB_KEYS.orders, []);
  let buckets = [];
 
  if (state.reportRange === 'day') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      buckets.push({ key: d.toDateString(), label: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }), value: 0 });
    }
    orders.forEach(o => {
      const key = new Date(o.createdAt).toDateString();
      const b = buckets.find(b => b.key === key);
      if (b) b.value += o.totalPrice;
    });
  } else if (state.reportRange === 'month') {
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }), value: 0 });
    }
    orders.forEach(o => {
      const d = new Date(o.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const b = buckets.find(b => b.key === key);
      if (b) b.value += o.totalPrice;
    });
  } else {
    const years = [...new Set(orders.map(o => new Date(o.createdAt).getFullYear()))].sort();
    const thisYear = new Date().getFullYear();
    const yearSet = years.length ? years : [thisYear];
    buckets = yearSet.map(y => ({ key: `${y}`, label: `${y}`, value: 0 }));
    orders.forEach(o => {
      const y = new Date(o.createdAt).getFullYear();
      const b = buckets.find(b => b.key === `${y}`);
      if (b) b.value += o.totalPrice;
    });
  }
  renderBars('reportChart', buckets);
 
  const qtyMap = {};
  orders.forEach(o => o.items.forEach(it => { qtyMap[it.name] = (qtyMap[it.name] || 0) + it.qty; }));
  const best = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('reportBestSellers').innerHTML = best.length
    ? best.map(([name, qty]) => `<li>${esc(name)} — ${qty} ชิ้น</li>`).join('')
    : `<li>ไม่มีข้อมูล</li>`;
 
  const customers = load(DB_KEYS.customers, []);
  const regulars = customers.map(c => ({ c, stats: computeCustomerStats(c.id) }))
    .filter(x => x.stats.count > 0)
    .sort((a, b) => b.stats.count - a.stats.count).slice(0, 5);
  document.getElementById('reportRegulars').innerHTML = regulars.length
    ? regulars.map(x => `<li>${esc(x.c.name)} — ${x.stats.count} ครั้ง (${money(x.stats.totalSpent)})</li>`).join('')
    : `<li>ไม่มีข้อมูล</li>`;
}
 
/* ---- CSV export ---- */
function toCsv(rows) {
  return rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
document.getElementById('exportOrdersCsv').addEventListener('click', () => {
  const orders = load(DB_KEYS.orders, []);
  const rows = [['วันที่', 'ลูกค้า', 'Tag', 'จำนวนสินค้า', 'ยอดเงิน', 'สถานะ']];
  orders.forEach(o => rows.push([fmtDateTime(o.createdAt), o.customerName, o.farmTag, o.totalItems, o.totalPrice, o.status]));
  downloadFile('\uFEFF' + toCsv(rows), 'orders.csv', 'text/csv;charset=utf-8');
});
document.getElementById('exportCustomersCsv').addEventListener('click', () => {
  const customers = load(DB_KEYS.customers, []);
  const rows = [['ชื่อ', 'Tag ฟาร์ม', 'เบอร์โทร', 'หมายเหตุ', 'วันที่สมัคร']];
  customers.forEach(c => rows.push([c.name, c.farmTag, c.phone, c.note, fmtDateTime(c.createdAt)]));
  downloadFile('\uFEFF' + toCsv(rows), 'customers.csv', 'text/csv;charset=utf-8');
});
document.getElementById('exportProductsCsv').addEventListener('click', () => {
  const products = load(DB_KEYS.products, []);
  const rows = [['ชื่อ', 'หมวดหมู่', 'ราคา', 'คงเหลือ']];
  products.forEach(p => rows.push([p.name, categoryById(p.category)?.name || '', p.price, p.stock]));
  downloadFile('\uFEFF' + toCsv(rows), 'products.csv', 'text/csv;charset=utf-8');
});
document.getElementById('exportPdfReport').addEventListener('click', () => window.print());
 
/* =====================================================================
   SETTINGS
===================================================================== */
function renderSettings() {
  const settingsData = load(DB_KEYS.settings, {});
  document.getElementById('shopNameInput').value = settingsData.shopName || 'ฟาร์มมี่ช็อป';
  document.getElementById('shopContactInput').value = settingsData.contactInfo || '';
 
  const cats = load(DB_KEYS.categories, []);
  document.getElementById('settingsCatList').innerHTML = cats.map(c => `
    <div class="cat-row">
      <div class="cat-row-main">
        <span>${c.emoji} <span class="cat-chip-name" data-rename="${c.id}" title="กดเพื่อเปลี่ยนชื่อ" style="cursor:pointer">${esc(c.name)}</span></span>
        <span class="cat-chip-x" data-del="${c.id}" title="ลบหมวดหมู่">✕</span>
      </div>
      <div class="cat-row-flags">
        <label><input type="checkbox" data-flag="separate" data-id="${c.id}" ${c.separate ? 'checked' : ''}> โหมดแยก</label>
        ${c.separate ? `
        <label><input type="checkbox" data-flag="more" data-id="${c.id}" ${c.more ? 'checked' : ''}> อยู่ใน "เพิ่มเติม"</label>
        <label><input type="checkbox" data-flag="booking" data-id="${c.id}" ${c.booking ? 'checked' : ''}> ต้องเลือกวัน/เวลา</label>` : ''}
      </div>
    </div>`).join('');
  document.querySelectorAll('#settingsCatList [data-rename]').forEach(x => {
    x.addEventListener('click', () => renameCategory(x.dataset.rename));
  });
  document.querySelectorAll('#settingsCatList [data-del]').forEach(x => {
    x.addEventListener('click', () => deleteCategory(x.dataset.del));
  });
  document.querySelectorAll('#settingsCatList [data-flag]').forEach(x => {
    x.addEventListener('change', () => setCategoryFlag(x.dataset.id, x.dataset.flag, x.checked));
  });
 
  const settings = load(DB_KEYS.settings, {});
  const preview = document.getElementById('qrCurrentPreview');
  preview.innerHTML = settings.promptpayQr ? `<img src="${settings.promptpayQr}" alt="PromptPay QR" loading="lazy">` : `<p class="hint-text">ยังไม่มี QR</p>`;
}
 
document.getElementById('changePasswordBtn').addEventListener('click', async () => {
  const current = document.getElementById('currentPassword').value;
  const next = document.getElementById('newPassword').value;
  const confirmPw = document.getElementById('confirmPassword').value;
 
  if (!currentSession) { toast('⚠️ กรุณาเข้าสู่ระบบก่อน'); return; }
  if (next.length < 6) { toast('⚠️ รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัว (ข้อกำหนดของ Supabase)'); return; }
  if (next !== confirmPw) { toast('⚠️ รหัสผ่านใหม่ไม่ตรงกัน'); return; }
 
  // ยืนยันตัวตนด้วยรหัสผ่านปัจจุบันก่อน (Supabase ไม่มี API เช็ครหัสตรงๆ จึงลอง sign-in ซ้ำ)
  const email = currentSession.user.email;
  const { error: verifyError } = await supabaseClient.auth.signInWithPassword({ email, password: current });
  if (verifyError) { toast('⚠️ รหัสผ่านปัจจุบันไม่ถูกต้อง'); return; }
 
  const { error: updateError } = await supabaseClient.auth.updateUser({ password: next });
  if (updateError) { toast('⚠️ เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + updateError.message); return; }
 
  document.getElementById('currentPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  toast('✅ เปลี่ยนรหัสผ่านแล้ว');
});
 
document.getElementById('shopNameInput').addEventListener('change', e => {
  const s = load(DB_KEYS.settings, {}); s.shopName = e.target.value.trim() || 'ฟาร์มมี่ช็อป'; save(DB_KEYS.settings, s);
  toast('💾 บันทึกชื่อร้านแล้ว');
});
document.getElementById('shopContactInput').addEventListener('change', e => {
  const s = load(DB_KEYS.settings, {}); s.contactInfo = e.target.value.trim(); save(DB_KEYS.settings, s);
  toast('💾 บันทึกช่องทางติดต่อแล้ว');
});
 
document.getElementById('addCatBtn').addEventListener('click', () => {
  const emoji = document.getElementById('newCatEmoji').value.trim() || '📦';
  const name = document.getElementById('newCatName').value.trim();
  if (!name) { toast('⚠️ กรุณากรอกชื่อหมวดหมู่'); return; }
  const cats = load(DB_KEYS.categories, []);
  cats.push({ id: uid('cat'), emoji, name });
  save(DB_KEYS.categories, cats);
  document.getElementById('newCatEmoji').value = '';
  document.getElementById('newCatName').value = '';
  toast('✅ เพิ่มหมวดหมู่แล้ว');
  renderSettings();
});
 
function setCategoryFlag(id, flag, value) {
  const cats = load(DB_KEYS.categories, []);
  const c = cats.find(x => x.id === id);
  if (!c) return;
  c[flag] = value;
  if (flag === 'separate' && !value) { c.more = false; c.booking = false; }
  save(DB_KEYS.categories, cats);
  toast('💾 บันทึกการตั้งค่าหมวดหมู่แล้ว');
  renderSettings();
}

function renameCategory(id) {
  const cats = load(DB_KEYS.categories, []);
  const c = cats.find(x => x.id === id);
  if (!c) return;
  const name = prompt('เปลี่ยนชื่อหมวดหมู่', c.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) { toast('⚠️ ชื่อหมวดหมู่ต้องไม่ว่าง'); return; }
  c.name = trimmed;
  save(DB_KEYS.categories, cats);
  toast('✅ เปลี่ยนชื่อหมวดหมู่แล้ว');
  renderSettings();
}

function deleteCategory(id) {
  const products = load(DB_KEYS.products, []);
  if (products.some(p => p.category === id)) { toast('⚠️ มีสินค้าอยู่ในหมวดหมู่นี้ ลบไม่ได้'); return; }
  if (!confirm('ลบหมวดหมู่นี้ใช่หรือไม่?')) return;
  save(DB_KEYS.categories, load(DB_KEYS.categories, []).filter(c => c.id !== id));
  toast('🗑️ ลบหมวดหมู่แล้ว');
  renderSettings();
}
 
document.getElementById('qrUpload').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  toast('⏳ กำลังอัปโหลดรูป...');
  try {
    const blob = await compressImageFile(file, 700, 0.9, 'image/png');
    const url = await uploadProductPhoto(blob, 'image/png');
    const settings = load(DB_KEYS.settings, {});
    settings.promptpayQr = url;
    save(DB_KEYS.settings, settings);
    toast('✅ บันทึก QR แล้ว');
    renderSettings();
  } catch (err) {
    console.error('compress QR error', err);
    toast('⚠️ โหลดรูปไม่สำเร็จ ลองใหม่หรือเลือกไฟล์อื่น');
  }
});
document.getElementById('removeQrBtn').addEventListener('click', () => {
  const settings = load(DB_KEYS.settings, {});
  settings.promptpayQr = null;
  save(DB_KEYS.settings, settings);
  toast('🗑️ ลบ QR แล้ว');
  renderSettings();
});
 
document.getElementById('backupBtn').addEventListener('click', () => {
  const backup = {};
  Object.entries(DB_KEYS).forEach(([k, key]) => { if (k !== 'theme') backup[key] = load(key, null); });
  downloadFile(JSON.stringify(backup, null, 2), `farmy-shop-backup-${Date.now()}.json`, 'application/json');
  toast('⬇️ สำรองข้อมูลแล้ว');
});
document.getElementById('restoreInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      Object.values(DB_KEYS).forEach(key => { if (data[key] !== undefined) save(key, data[key]); });
      toast('✅ นำเข้าข้อมูลสำเร็จ กำลังโหลดใหม่...');
      setTimeout(() => location.reload(), 1000);
    } catch { toast('⚠️ ไฟล์ไม่ถูกต้อง'); }
  };
  reader.readAsText(file);
});
document.getElementById('resetDataBtn').addEventListener('click', () => {
  if (!confirm('ต้องการล้างข้อมูลทั้งหมดใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้ และจะล้างข้อมูลบนคลาวด์ที่ทุกเครื่องเห็นร่วมกัน')) return;
  resetAllData();
  toast('🗑️ ล้างข้อมูลแล้ว');
  setTimeout(() => location.reload(), 800);
});
 
/* =====================================================================
   GLOBAL SEARCH
===================================================================== */
const globalSearchInput = document.getElementById('globalSearch');
const searchResultsBox = document.getElementById('searchResults');
 
globalSearchInput.addEventListener('input', () => {
  const q = globalSearchInput.value.trim().toLowerCase();
  if (!q) { searchResultsBox.classList.remove('show'); return; }
  const unlocked = isAuthed() || document.body.classList.contains('admin-unlocked');
 
  const products = load(DB_KEYS.products, []).filter(p => p.name.toLowerCase().includes(q)).slice(0, 5);
  const customers = unlocked ? load(DB_KEYS.customers, []).filter(c => c.name.toLowerCase().includes(q) || (c.farmTag || '').toLowerCase().includes(q)).slice(0, 5) : [];
  const orders = unlocked ? load(DB_KEYS.orders, []).filter(o => o.customerName.toLowerCase().includes(q) || (o.farmTag || '').toLowerCase().includes(q)).slice(0, 5) : [];
 
  let html = '';
  if (products.length) html += `<div class="sr-cat">สินค้า</div>` + products.map(p => `<div class="sr-item" data-type="product" data-id="${p.id}">${p.image} ${esc(p.name)} — ${money(p.price)}</div>`).join('');
  if (customers.length) html += `<div class="sr-cat">ลูกค้า</div>` + customers.map(c => `<div class="sr-item" data-type="customer" data-id="${c.id}">${esc(c.name)} · ${esc(c.farmTag || '')}</div>`).join('');
  if (orders.length) html += `<div class="sr-cat">ออเดอร์</div>` + orders.map(o => `<div class="sr-item" data-type="order" data-id="${o.id}">${esc(o.customerName)} — ${fmtDate(o.createdAt)} — ${money(o.totalPrice)}</div>`).join('');
 
  searchResultsBox.innerHTML = html || `<div class="sr-item">ไม่พบผลลัพธ์</div>`;
  searchResultsBox.classList.add('show');
 
  searchResultsBox.querySelectorAll('.sr-item[data-type]').forEach(item => {
    item.addEventListener('click', () => {
      const { type, id } = item.dataset;
      searchResultsBox.classList.remove('show');
      globalSearchInput.value = '';
      if (type === 'product') { switchView('products'); }
      else if (type === 'customer') { switchView('customers'); if (isAuthed() || document.body.classList.contains('admin-unlocked')) setTimeout(() => showCustomerDetail(id), 50); }
      else if (type === 'order') { switchView('orders'); if (isAuthed() || document.body.classList.contains('admin-unlocked')) setTimeout(() => showOrderDetail(id), 50); }
    });
  });
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) searchResultsBox.classList.remove('show');
});
 
/* =====================================================================
   INIT — เชื่อมต่อฐานข้อมูลคลาวด์ก่อน แล้วค่อยเริ่มแอป
===================================================================== */
const dbLoadingEl = document.getElementById('dbLoading');
const dbErrorEl = document.getElementById('dbError');
 
// เมื่อมีการเปลี่ยนแปลงข้อมูลจากเครื่องอื่น (Realtime) ให้ re-render หน้าปัจจุบันทันที
window.addEventListener('db:change', () => {
  if (state.view) renderView(state.view);
});
window.addEventListener('db:error', e => {
  console.error('Supabase error', e.detail);
  if (dbErrorEl) dbErrorEl.classList.remove('hidden');
});
 
(async function start() {
  initTheme();
  try {
    await initDB();
    ensureUpgradeCategory();
    if (dbLoadingEl) dbLoadingEl.classList.add('hidden');
    applyUnlockedUI(isAuthed());
    goToView('pos');
  } catch (e) {
    console.error('เชื่อมต่อฐานข้อมูลไม่สำเร็จ', e);
    if (dbLoadingEl) dbLoadingEl.classList.add('hidden');
    if (dbErrorEl) dbErrorEl.classList.remove('hidden');
  }
})();


/* ---- โหลดหมวด + รายการเริ่มต้น (กดปุ่มในหน้าตั้งค่า, ข้ามรายการที่มีแล้ว) ---- */
const STARTER_PACK = [
  { id: UPGRADE_CAT_ID, emoji: '⚒️', name: 'ของอัพเกรด', flags: { separate: true }, text: `
อัพยุ้งฉาง 1 ชุด 89ชิ้น 9฿
ขยายพื้นที่ 1 ชุด 89ชิ้น 12฿
สลัก 5ชิ้น 1฿
ไม้กระดาน 5ชิ้น 1฿
เทป 5ชิ้น 1฿
ตะปู 5ชิ้น 1฿
ตะปูควง 5ชิ้น 1฿
ไม้ฝา 5ชิ้น 1฿
ฉโนด 5ชิ้น 1฿
ค้อนไม้ 5ชิ้น 1฿
หมุด 5ชิ้น 1฿
อัพรถไฟแจ้งรายการในแชท 5ชิ้น 1฿
ปิ่นโต โรงนา/ยุ้ง 7วัน 59฿
ปิ่นโต ขยายพื้นที่ 7วัน 79฿` },
  { id: 'cat_diamond', emoji: '💎', name: 'เติมเพชร&กดแพ็ค', flags: { separate: true }, text: `
50 เพชร 34฿
130 เพชร 84฿
275 เพชร 169฿
570 เพชร 329฿
1500 เพชร 679฿
4000 เพชร 1659฿` },
  { id: 'cat_coin', emoji: '🪙', name: 'เติมเหรียญ', flags: { separate: true, more: true, booking: true, summaryTitle: 'จองวนเหรียญ' }, text: `
เวล 11-20 1หมื่น 5฿
เวล 11-20 5หมื่น 20฿
เวล 11-20 1แสน 30฿
เวล 21-39 1แสน 12฿
เวล 21-39 5แสน 50฿
เวล 21-39 1ล้าน 80฿
เวล 40-58 1ล้าน 50฿
เวล 40-58 3ล้าน 130฿
เวล 40-58 5ล้าน 190฿
เวล 59+ 1ล้าน 45฿` },
  { id: 'cat_raw100', emoji: '🌾', name: 'วัตถุดิบเรทล้วน100', flags: { separate: true, more: true }, text: `
หางกุ้ง 100ชิ้น 6฿
ขน 100ชิ้น 6฿
ขี้ผึ้ง 100ชิ้น 6฿
ชีสแพะ 100ชิ้น 6฿
ปลา 100ชิ้น 5฿
ผ้าฝ้าย 100ชิ้น 5฿
น้ำผึ้ง 100ชิ้น 5฿
น้ำเชื่อม 100ชิ้น 5฿
น้ำตาลทรายขาว 100ชิ้น 5฿
น้ำตาลทรายแดง 100ชิ้น 5฿
ชีส 100ชิ้น 5฿
เนย 100ชิ้น 5฿
ครีม 100ชิ้น 5฿
พาสต้าสด 100ชิ้น 5฿
ไข่ 100ชิ้น 5฿
นม 100ชิ้น 5฿
เบคอน 100ชิ้น 5฿
ขนมปัง 100ชิ้น 5฿
แพนเค้ก 100ชิ้น 5฿
มะเขือเทศเผา 100ชิ้น 5฿
ขนมปังข้าวโพด 100ชิ้น 5฿
คุกกี้ 100ชิ้น 5฿
อาหารสัตว์ สุ่มคละ 100ชิ้น 5฿` },
  { id: 'cat_truckbill', emoji: '🚚', name: 'ส่งบิลรถกระบะ', flags: { separate: true, more: true }, text: `
เวล7-80 100บิล 70฿
เวล7-80 500บิล 350฿
เวล7-80 1000บิล 650฿
เวล80+ 100บิล 90฿
เวล80+ 500บิล 450฿
เวล80+ 1000บิล 800฿` },
];

async function loadStarterPack() {
  const cats = await loadFresh(DB_KEYS.categories, []);
  const products = await loadFresh(DB_KEYS.products, []);
  let catsAdded = 0, prodAdded = 0, prodSkipped = 0;
  STARTER_PACK.forEach(pack => {
    if (!cats.some(c => c.id === pack.id)) {
      cats.push({ id: pack.id, emoji: pack.emoji, name: pack.name, ...pack.flags });
      catsAdded++;
    }
    const r = addProductsBulk(products, pack.id, parseImportLines(pack.text), 0);
    prodAdded += r.added; prodSkipped += r.skipped;
  });
  save(DB_KEYS.categories, cats);
  save(DB_KEYS.products, products);
  toast(`✅ เพิ่มหมวด ${catsAdded} · สินค้า ${prodAdded}${prodSkipped ? ` (ข้ามที่มีแล้ว ${prodSkipped})` : ''}`);
  renderSettings();
}
document.getElementById('loadStarterBtn').addEventListener('click', () => {
  if (confirm('โหลดหมวด+รายการเริ่มต้น (เติมเพชร, เติมเหรียญ, วัตถุดิบเรทล้วน100, ส่งบิลรถกระบะ, ของอัพเกรด)?\nรายการที่มีอยู่แล้วจะไม่ถูกเพิ่มซ้ำ')) loadStarterPack();
});
