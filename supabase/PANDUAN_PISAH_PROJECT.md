# Panduan Pisahkan ke Project Supabase Baru (khusus Kasir)

Karena aplikasi kasir & absensi saat ini menumpang di satu project, sebaiknya
kasir dipindah ke project sendiri agar benar-benar terpisah. Data kasir masih
baru, jadi **tidak perlu migrasi** — cukup buat project baru.

## Langkah 1 — Buat Project Baru
1. Buka https://supabase.com/dashboard → **New Project**
2. Nama: `kasir-umkm` (bebas)
3. Region: **Southeast Asia (Singapore)**
4. Buat & catat password database → **Create new project** → tunggu ±2 menit

## Langkah 2 — Buat Semua Tabel + Keamanan (sekali RUN)
1. Project baru → **SQL Editor** → **New query**
2. Copy seluruh isi file `00_full_setup_project_baru.sql`
3. Tempel → **RUN** → pastikan "Success"

> File ini sudah membuat SEMUA tabel dari nol (stores, products, cashiers,
> transactions, transaction_items, purchases, purchase_items) lengkap dengan
> RLS multi-tenant. Tidak perlu menjalankan `01_multi_tenant_setup.sql` lagi.

## Langkah 3 — Matikan Konfirmasi Email
**Authentication → Providers → Email → matikan "Confirm email" → Save**

## Langkah 4 — Ambil Kredensial Baru
Project baru → **Settings → API**, catat:
- **Project URL** (contoh: `https://xxxxx.supabase.co`)
- **anon public key** (string panjang)

Kirim keduanya ke Claude untuk diganti di `app.js`. (Atau ganti sendiri di
`app.js` bagian `SUPABASE_URL` dan `SUPABASE_KEY`.)

## Langkah 5 — Beres
Setelah kredensial diganti & di-deploy, hard refresh aplikasi (Ctrl+Shift+R),
lalu daftar toko baru. Project lama (absensi) tidak tersentuh sama sekali.

---

### Catatan tentang project lama
Tabel kasir yang terlanjur dibuat di project absensi boleh dibiarkan (tidak
mengganggu), atau dihapus kalau mau bersih:

```sql
DROP TABLE IF EXISTS transaction_items, purchase_items,
  transactions, purchases, products, cashiers, stores CASCADE;
DROP FUNCTION IF EXISTS my_store_ids();
```

⚠️ Pastikan nama tabel di atas BUKAN tabel yang dipakai aplikasi absensi
sebelum menjalankan DROP ini.
