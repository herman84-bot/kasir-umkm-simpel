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
