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

const _cache = {};
let _dbReady = false;

function deepClone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

function load(key, fallback) {
  if (key === DB_KEYS.theme) {
    try { return
  });
}
