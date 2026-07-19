/* ===================================================================
   DB LAYER — เก็บข้อมูลร้านทั้งหมดบน Supabase (ตาราง app_state)
   แทนที่ localStorage เดิม โดยคงหน้าตา API เดิม (load/save) ไว้
   เพื่อให้ app.js ทั้งไฟล์เรียกใช้ได้เหมือนเดิม แต่ข้อมูลจริงอยู่บนคลาวด์
   และ sync แบบ Real-time ให้ทุกเครื่องที่เปิดเว็บอยู่ผ่าน Supabase Realtime
=================================================================== */

const TABLE_NAME = 'app_state';

const DB_KEYS = {
  customers: 'hd_customers',
  products: 'hd_products',
  orders: 'hd_orders',
  categories: 'hd_categories',
  settings: 'hd_settings',
  theme: 'hd_theme', // เก็บใน localStorage เท่านั้น (ค่า UI ล้วนๆ ไม่ต้อง sync)
};

const DEFAULT_CATEGORIES = [
  { id: 'plant', emoji: '🌾', name: 'พืช' },
  { id: 'fruit', emoji: '🍎', name: 'ผลไม้' },
  { id: 'veg', emoji: '🥕', name: 'ผัก' },
  { id: 'food', emoji: '🍞', name: 'อาหาร' },
  { id: 'product', emoji: '🧀', name: 'ผลิตภัณฑ์' },
  { id: 'fish', emoji: '🐟', name: 'ปลา' },
  { id: 'upgrade', emoji: '⚒️', name: 'วัสดุอัปเกรด' },
  { id: 'tool', emoji: '🪓', name: 'เครื่องมือ' },
  { id: 'bait', emoji: '🎣', name: 'เหยื่อ' },
  { id: 'other', emoji: '📦', name: 'อื่น ๆ' },
];

function dbUid(prefix) { return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }

const DEFAULT_PRODUCTS = [
  { id: dbUid('p'), image: '🍌', photo: null, name: 'กล้วย', category: 'fruit', price: 5, stock: 200 },
  { id: dbUid('p'), image: '🍎', photo: null, name: 'แอปเปิล', category: 'fruit', price: 6, stock: 200 },
  { id: dbUid('p'), image: '🍯', photo: null, name: 'น้ำผึ้ง', category: 'product', price: 12, stock: 80 },
  { id: dbUid('p'), image: '🧀', photo: null, name: 'ชีส', category: 'product', price: 15, stock: 60 },
  { id: dbUid('p'), image: '🥕', photo: null, name: 'แครอท', category: 'veg', price: 3, stock: 250 },
  { id: dbUid('p'), image: '🌾', photo: null, name: 'ข้าวสาลี', category: 'plant', price: 2, stock: 400 },
  { id: dbUid('p'), image: '🍞', photo: null, name: 'ขนมปัง', category: 'food', price: 10, stock: 120 },
  { id: dbUid('p'), image: '🥤', photo: null, name: 'น้ำปั่น', category: 'food', price: 8, stock: 100 },
  { id: dbUid('p'), image: '🐟', photo: null, name: 'ปลาแซลมอน', category: 'fish', price: 20, stock: 50 },
  { id: dbUid('p'), image: '🔩', photo: null, name: 'เหล็ก', category: 'upgrade', price: 18, stock: 90 },
  { id: dbUid('p'), image: '🪓', photo: null, name: 'ขวาน', category: 'tool', price: 45, stock: 20 },
  { id: dbUid('p'), image: '🎣', photo: null, name: 'เหยื่อตกปลา', category: 'bait', price: 4, stock: 300 },
];

const DEFAULT_VALUES = {
  [DB_KEYS.categories]: DEFAULT_CATEGORIES,
  [DB_KEYS.products]: DEFAULT_PRODUCTS,
  [DB_KEYS.customers]: [],
  [DB_KEYS.orders]: [],
  [DB_KEYS.settings]: { promptpayQr: null, shopName: 'ฟาร์มมี่ช็อป', contactInfo: '' },
};

const SYNCED_KEYS = Object.values(DB_KEYS).filter(k => k !== DB_KEYS.theme);

// ในหน่วยความจำ = สำเนาล่าสุดจาก Supabase (ไม่ใช่แหล่งข้อมูลจริง แค่แคชไว้ให้ UI อ่านเร็ว)
const _cache = {};
let _dbReady = false;
// เวลาที่เพิ่ง save() คีย์นี้จากเครื่องตัวเองล่าสุด — กันไม่ให้ re-render ซ้ำซ้อนตอน Realtime
// สะท้อนกลับมา (ทำให้เครื่องที่กำลังอัปโหลดรูป/เพิ่มสินค้า ค้าง/กระตุกจนดูเหมือน "เด้งออก")
const _recentLocalWrites = new Map();

function deepClone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

/* ---------------------- PUBLIC API (หน้าตาเหมือน localStorage เดิม) ---------------------- */
// อ่านข้อมูล: คืนสำเนาจากแคช (แก้ไข object ที่ได้โดยไม่กระทบข้อมูลจริงจนกว่าจะเรียก save)
function load(key, fallback) {
  if (key === DB_KEYS.theme) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  const v = _cache[key];
  return v !== undefined ? deepClone(v) : fallback;
}

// บันทึกข้อมูล: อัปเดตแคชทันที (UI ลื่นไม่ต้องรอเน็ต) แล้วค่อยส่งขึ้น Supabase เบื้องหลัง
function save(key, val) {
  if (key === DB_KEYS.theme) {
    try { localStorage.setItem(key, val); } catch (e) { console.error('theme save error', e); }
    return;
  }
  _cache[key] = deepClone(val);
  _recentLocalWrites.set(key, Date.now());
  supabaseClient
    .from(TABLE_NAME)
    .upsert({ key, value: val, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .then(({ error }) => {
      if (error) {
        console.error('บันทึกข้อมูลขึ้น Supabase ไม่สำเร็จ', key, error);
        notifyDbError(error);
      }
    });
}

function notifyDbError(error) {
  window.dispatchEvent(new CustomEvent('db:error', { detail: error }));
}

/* ---------------------- INIT: โหลดข้อมูลทั้งหมดจาก Supabase ครั้งแรก ---------------------- */
async function initDB() {
  const { data, error } = await supabaseClient.from(TABLE_NAME).select('key,value');
  if (error) {
    notifyDbError(error);
    throw error;
  }

  const found = new Map((data || []).map(row => [row.key, row.value]));
  const missing = [];

  SYNCED_KEYS.forEach(key => {
    if (found.has(key)) {
      _cache[key] = found.get(key);
    } else {
      _cache[key] = deepClone(DEFAULT_VALUES[key]);
      missing.push({ key, value: _cache[key] });
    }
  });

  // ครั้งแรกที่ไม่มีข้อมูลในฐานข้อมูลเลย ให้ seed ค่าเริ่มต้นขึ้นไปเก็บไว้
  if (missing.length) {
    const { error: seedError } = await supabaseClient
      .from(TABLE_NAME)
      .upsert(missing.map(m => ({ key: m.key, value: m.value, updated_at: new Date().toISOString() })), { onConflict: 'key' });
    if (seedError) { console.error('seed error', seedError); notifyDbError(seedError); }
  }

  subscribeRealtime();
  _dbReady = true;
}

/* ---------------------- REALTIME: ทุกเครื่องอัปเดตอัตโนมัติเมื่อมีการเปลี่ยนแปลง ---------------------- */
function subscribeRealtime() {
  supabaseClient
    .channel('app_state_realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE_NAME }, payload => {
      const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
      if (!row || !row.key) return;

      if (payload.eventType === 'DELETE') {
        _cache[row.key] = deepClone(DEFAULT_VALUES[row.key] ?? null);
      } else {
        _cache[row.key] = payload.new.value;
      }

      // ถ้าเพิ่งเขียนคีย์นี้เองจากเครื่องนี้ไม่เกิน 2 วิ = UI แสดงข้อมูลล่าสุดอยู่แล้ว ไม่ต้อง re-render ซ้ำ
      const lastLocalWrite = _recentLocalWrites.get(row.key) || 0;
      if (Date.now() - lastLocalWrite < 2000) return;

      window.dispatchEvent(new CustomEvent('db:change', { detail: { key: row.key } }));
    })
    .subscribe(status => {
      window.dispatchEvent(new CustomEvent('db:realtime-status', { detail: status }));
    });
}

function isDbReady() { return _dbReady; }

// ดึงข้อมูลล่าสุดจาก Supabase ตรงๆ (ข้ามแคชในเครื่อง) — ใช้ก่อนบันทึก/ลบข้อมูลสำคัญ
// กันเหตุการณ์เปิดหลายแท็บ/อุปกรณ์พร้อมกันแล้วแท็บที่ข้อมูลเก่ากว่าเขียนทับของใหม่ทิ้ง
async function loadFresh(key, fallback) {
  if (key === DB_KEYS.theme) return load(key, fallback);
  try {
    const { data, error } = await supabaseClient.from(TABLE_NAME).select('value').eq('key', key).maybeSingle();
    if (error || !data) return load(key, fallback);
    _cache[key] = data.value;
    return deepClone(data.value);
  } catch (e) {
    console.error('loadFresh error', key, e);
    return load(key, fallback);
  }
}

// ล้างข้อมูลทั้งหมดกลับเป็นค่าเริ่มต้น แล้วเขียนทับบนคลาวด์ (ทุกเครื่องจะเห็นค่าใหม่ผ่าน Realtime)
function resetAllData() {
  SYNCED_KEYS.forEach(key => {
    const fresh = key === DB_KEYS.products ? deepClone(DEFAULT_PRODUCTS) : deepClone(DEFAULT_VALUES[key]);
    save(key, fresh);
  });
}
