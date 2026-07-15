/* ===================================================================
   Supabase connection config
   ตั้งค่า URL และ Anon Key ของโปรเจกต์ Supabase ของคุณตรงนี้
   (หาได้จาก Supabase Dashboard > Project Settings > API)
=================================================================== */
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-SUPABASE-ANON-KEY';

if (typeof supabase === 'undefined') {
  throw new Error('Supabase SDK ยังไม่โหลด: ตรวจสอบว่า <script> ของ supabase-js อยู่ก่อน supabaseClient.js');
}

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
