# Panduan Setup Multi-Tenant (Wajib)

Lakukan 2 langkah ini di dashboard Supabase **sebelum** memakai aplikasi.

## 1. Matikan Konfirmasi Email (agar daftar langsung bisa dipakai)

1. Buka Supabase → **Authentication** → **Sign In / Providers** (atau **Providers → Email**)
2. Cari opsi **"Confirm email"** / **"Enable email confirmations"**
3. **Matikan (OFF)** lalu **Save**

> Kalau ini tetap ON, user yang daftar harus klik link di email dulu sebelum bisa masuk.

## 2. Jalankan SQL Multi-Tenant + Keamanan

1. Buka Supabase → **SQL Editor** → **New query**
2. Copy seluruh isi file `01_multi_tenant_setup.sql`
3. Tempel → klik **RUN**
4. Pastikan muncul "Success"

Script ini:
- Membuat tabel `stores` (data tiap toko)
- Menambah kolom `store_id` ke products, transactions, cashiers, purchases
- **Menghapus policy lama yang tidak aman** (`USING true`)
- Memasang **Row Level Security (RLS)** ketat: tiap toko hanya bisa akses datanya sendiri

---

## Cara Kerja Setelah Setup

```
1. User download APK / buka web
2. Klik "Daftar Toko" → isi nama toko, nama pemilik, email, password
3. Sistem otomatis buat: akun + toko + kasir admin (PIN default 1234)
4. Langsung masuk sebagai Admin toko
5. Data toko terisolasi penuh dari toko lain (dijamin RLS)
```

## Keamanan

- **Anon key boleh publik** — yang melindungi data adalah RLS, bukan kerahasiaan key.
- User yang belum login **tidak bisa baca data apa pun** (RLS menolak `auth.uid()` kosong).
- Toko A **tidak bisa** melihat data Toko B (difilter `store_id` lewat RLS).
- Password akun toko dikelola Supabase Auth (terenkripsi, bukan plain text).

## Catatan

- PIN kasir (di tabel `cashiers`) masih plain text — ini hanya untuk pemilihan operator
  di dalam toko yang sudah terautentikasi, bukan batas keamanan antar-toko. Aman untuk UMKM.
- Data demo lama (tanpa `store_id`) akan otomatis tersembunyi. Lihat bagian OPSIONAL
  di akhir `01_multi_tenant_setup.sql` jika ingin menghapusnya.

## Fitur Panel Super Admin — Aktivitas Toko & Hapus Toko (WAJIB)

Panel Super Admin (Pengaturan → 🛡 Admin Panel) kini menampilkan **Aktivitas** tiap toko
(hijau = ada transaksi, merah = belum ada transaksi sama sekali) dan tombol **Hapus** toko.

Agar kedua fitur ini berfungsi, lakukan 2 langkah berikut **sekali saja**:

### 1. Jalankan migration `17_super_admin_aktivitas_hapus.sql`

Supabase → SQL Editor → RUN `supabase/17_super_admin_aktivitas_hapus.sql`.

Script ini (idempotent):
- Menambah kolom `total_transactions` & `last_transaction_at` ke hasil RPC
  `list_all_stores_for_admin` (dihitung dari transaksi yang TIDAK dibatalkan/void).
- Mengubah FK `admin_action_logs.target_store_id` menjadi `ON DELETE SET NULL`
  sehingga log audit "admin menghapus toko X" tetap tersimpan setelah toko dihapus.

Pastikan migration 11–13 (super admin + uid fix) sudah dijalankan sebelumnya.

### 2. Deploy ulang Edge Function `admin-subscription`

Aksi **hapus toko** dieksekusi lewat Edge Function `admin-subscription` (action
`delete_store`) dengan service-role — bukan dari client. Deploy ulang:

```bash
supabase functions deploy admin-subscription
```

Alur hapus toko (server-side, teraudit):
1. Verifikasi pemanggil terdaftar di tabel `admin_users`.
2. Menolak menghapus toko milik akun admin sendiri.
3. Catat audit di `admin_action_logs` (tetap tersimpan walau toko dihapus).
4. Hapus toko dengan aman multi-cabang: kalau pemilik masih punya toko/cabang lain,
   hanya baris toko ini yang dihapus (akun pemilik tetap aktif). Kalau ini satu-satunya
   toko miliknya, akun pemilik ikut dihapus → otomatis menghapus toko + SEMUA datanya
   (produk, transaksi, kasbon, dll.) lewat FK `ON DELETE CASCADE`.
