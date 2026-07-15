-- ===================================================================
-- SinaShop (Hay-Day) — Supabase schema
-- รันไฟล์นี้ทั้งหมดใน Supabase Dashboard > SQL Editor > New query > Run
-- ===================================================================

-- ตารางเดียวเก็บข้อมูลร้านทั้งหมดแบบ key/value (jsonb)
-- key ที่ใช้: hd_products, hd_categories, hd_customers, hd_orders, hd_settings
create table if not exists public.app_state (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- เปิด Row Level Security
alter table public.app_state enable row level security;

-- แอปนี้ใช้ระบบล็อกฝั่งหน้าบ้าน (Admin login ผ่าน Supabase Auth) ในการกันหน้าจัดการร้าน
-- ส่วนหน้า "ขายสินค้า" (POS) เปิดให้ลูกค้าทุกคนใช้ได้โดยไม่ต้อง login (ตัดสต็อก/สร้างออเดอร์ได้)
-- จึงอนุญาตให้ anon key อ่าน/เขียนตารางนี้ได้ทั้งหมด (เทียบเท่าของเดิมที่เก็บใน localStorage
-- ซึ่งใครก็แก้ได้อยู่แล้วจาก DevTools ของเครื่องตัวเอง) หากต้องการความปลอดภัยสูงขึ้น
-- ให้แยก policy ตาม key และบังคับ auth.role() = 'authenticated' สำหรับ key ที่ควรแก้ได้เฉพาะแอดมิน
create policy "app_state_select_all" on public.app_state
  for select using (true);

create policy "app_state_insert_all" on public.app_state
  for insert with check (true);

create policy "app_state_update_all" on public.app_state
  for update using (true) with check (true);

create policy "app_state_delete_all" on public.app_state
  for delete using (true);

-- เปิด Realtime ให้ตารางนี้ (ให้ทุกเครื่องได้รับการอัปเดตทันทีที่มีการเปลี่ยนแปลง)
alter publication supabase_realtime add table public.app_state;
