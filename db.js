const TABLE_NAME = 'app_state';

const DB_KEYS = {
  customers: 'hd_customers',
  products: 'hd_products',
  orders: 'hd_orders',
  categories: 'hd_categories',
  settings: 'hd_settings',
  theme: 'hd_theme',
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
const _cache = {};
let _dbReady = false;

function deepClone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
function load(key, fallback) {
  if (key === DB_KEYS.theme) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  const v = _cache[key];
  return v !== undefined ? deepClone(v) : fallback;
}

function save(key, val) {
  if (key === DB_KEYS.theme) {
    try { localStorage.setItem(key, val); } catch (e) { console.error('theme save error', e); }
    return;
  }
  _cache[key] = deepClone(val);
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

  if (missing.length) {
    const { error: seedError } = await supabaseClient
      .from(TABLE_NAME)
      .upsert(missing.map(m => ({ key: m.key, value: m.value, updated_at: new Date().toISOString() })), { onConflict: 'key' });
    if (seedError) { console.error('seed error', seedError); notifyDbError(seedError); }
  }

  subscribeRealtime();
  _dbReady = true;
}

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
      window.dispatchEvent(new CustomEvent('db:change', { detail: { key: row.key } }));
    })
    .subscribe(status => {
      window.dispatchEvent(new CustomEvent('db:realtime-status', { detail: status }));
    });
}

function isDbReady() { return _dbReady; }

function resetAllData() {
  SYNCED_KEYS.forEach(key => {
    const fresh = key === DB_KEYS.products ? deepClone(DEFAULT_PRODUCTS) : deepClone(DEFAULT_VALUES[key]);
    save(key, fresh);
  });
}
