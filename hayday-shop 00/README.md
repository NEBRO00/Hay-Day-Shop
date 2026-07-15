# SinaShop — วิธีติดตั้งฐานข้อมูลคลาวด์ (Supabase)

## ไฟล์ในชุดนี้
- index.html, app.js, style.css — ไฟล์เว็บ (แก้ไขแล้ว)
- supabaseClient.js — ตั้งค่าเชื่อมต่อ Supabase (ต้องกรอก URL/Key เอง)
- db.js — เลเยอร์ฐานข้อมูล + Realtime sync
- supabase_setup.sql — สคริปต์สร้างตาราง/สิทธิ์/เปิด Realtime

## ขั้นตอน

### 1) สร้างโปรเจกต์ Supabase
1. เข้า https://supabase.com > New project
2. ตั้งชื่อ + รหัสผ่าน DB + เลือก Region ใกล้ผู้ใช้ (Southeast Asia)
3. รอสร้างเสร็จ (~2 นาที)

### 2) สร้างตารางฐานข้อมูล
1. เมนูซ้าย > SQL Editor > New query
2. คัดลอกทั้งไฟล์ `supabase_setup.sql` วางแล้วกด Run

### 3) เปิด Realtime (เผื่อ SQL ข้อ 2 ไม่ทำงานอัตโนมัติ)
1. เมนูซ้าย > Database > Replication
2. หาตาราง `app_state` ใน supabase_realtime publication > เปิดสวิตช์ให้ติด

### 4) เอา URL และ Anon Key
1. เมนูซ้าย > Project Settings > API
2. คัดลอก `Project URL` และ `anon public` key

### 5) แก้ไฟล์ supabaseClient.js
เปิดไฟล์ `supabaseClient.js` แก้ 2 บรรทัดนี้:
```js
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-SUPABASE-ANON-KEY';
```
ใส่ค่าจากข้อ 4 แทน

### 6) สร้างบัญชี Admin (สำหรับ login หลังบ้าน)
1. เมนูซ้าย > Authentication > Users > Add user
2. กรอกอีเมล/รหัสผ่าน (Auto Confirm User = เปิด)
3. ใช้อีเมล/รหัสผ่านนี้ล็อกอินหน้า "ปลดล็อก" บนเว็บ

### 7) Deploy ขึ้น Netlify
1. ลาก-วางทั้งโฟลเดอร์นี้ (index.html, app.js, style.css, supabaseClient.js, db.js) เข้า Netlify Drop
   หรือ push ขึ้น GitHub แล้วเชื่อม Netlify/Vercel/GitHub Pages ตามปกติ
2. ต้องอัปโหลดไฟล์ครบทั้ง 5 ไฟล์ (ห้ามลืม supabaseClient.js กับ db.js — สาเหตุที่เว็บพังตอนนี้)

### 8) ทดสอบ
- เปิดเว็บ 2 เครื่อง/เบราว์เซอร์คนละอัน → ดูสินค้าต้องเหมือนกัน
- แก้ไขสินค้าจากเครื่อง A → เครื่อง B ต้องอัปเดตอัตโนมัติไม่ต้อง refresh
- Refresh หน้า → ข้อมูลต้องไม่หาย
- เปิด Console (F12) → ต้องไม่มี error สีแดง

## หมายเหตุความปลอดภัย
หน้า "ขายสินค้า" เปิดให้ลูกค้าทุกคนเขียนข้อมูล (สร้างออเดอร์/ตัดสต็อก) โดยไม่ต้อง login
จึงต้องเปิดสิทธิ์ anon เขียนตาราง `app_state` ได้ (เหมือนของเดิมที่เก็บบน localStorage
ซึ่งใครก็แก้ได้จากเครื่องตัวเองอยู่แล้ว) ถ้าต้องการเข้มกว่านี้ ต้องทำ backend แยกสำหรับ POS
