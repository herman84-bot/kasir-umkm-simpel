# Security Assessment — Kasir UMKM Simpel

Tanggal: 8 Agustus 2026
Metode: static review (repo) + live probe non-destruktif (RLS, CORS, headers, Edge Function)
Prinsip: tidak menghapus/mengubah data, tidak menyentuh akun pelanggan, tidak menampilkan secret.

---

## Ringkasan Eksekutif

Pondasi keamanan aplikasi **kuat untuk ukuran vanilla JS + Supabase**:

- RLS aktif di **semua** tabel data + isolasi tenant berbasis `auth.uid()` (bukan input client).
- Live probe membuktikan: akses anon (tanpa login) ke REST API → **nol baris** di semua tabel sensitif.
- Semua fungsi `SECURITY DEFINER` yang sensitif (admin, debt, error log) punya guard server-side.
- Edge Function memvalidasi JWT + keanggotaan admin di server, CORS allowlist domain produksi.
- Security headers produksi (Vercel) sangat baik: HSTS, CSP `frame-ancestors 'none'`, nosniff, dll.
- Tidak ada secret (service role) di client. XSS escaping konsisten (83× `esc()`).

Tidak ditemukan kerentanan kritis yang bisa dieksploitasi dari luar tanpa login.
Temuan yang perlu diperhatikan: kebijakan email confirmation, CDN tanpa SRI, dan ketergantungan mutlak pada disiplin escaping karena CSP longgar.

---

## ✅ Yang Terverifikasi AMAN (dengan bukti)

### 1. RLS + Isolasi Tenant — SOLID
- Semua tabel tenant: `stores, products, transactions, transaction_items, cashiers, purchases, purchase_items, debts, cashier_shifts, transaction_returns, return_items, inventory_adjustments, stock_ledgers, error_logs, subscription_orders, admin_users, admin_action_logs` → `ENABLE ROW LEVEL SECURITY`.
- Policy memakai `store_id IN (SELECT my_store_ids())`, di mana `my_store_ids()` adalah fungsi `SECURITY DEFINER` yang mengambil id toko dari **`auth.uid()`** — client tidak bisa memalsukan toko mana yang boleh diakses.
- Utang (debts): migrasi `20260703` menutup UPDATE/DELETE langsung (hanya SELECT/INSERT via RLS); perubahan status/hapus hanya lewat `mark_debt_paid()` / `delete_debt_secure()` yang memverifikasi kepemilikan store di server.

### 2. Live Probe RLS — LULUS
Probe langsung ke `{project}.supabase.co/rest/v1/...` memakai anon key (tanpa login):
`stores`, `products`, `transactions`, `cashiers`, `debts`, `admin_users` → semuanya balas `[]` (0 baris). Tidak ada kebocoran data tanpa autentikasi.

### 3. SECURITY DEFINER — Semua Ada Guard Admin
| Fungsi | Guard |
|---|---|
| `list_all_stores_for_admin()` | `admin_users.user_id = auth.uid()` |
| `activate_subscription()` | admin check, lalu audit log (email dari DB, tidak bisa spoof) |
| `revoke_subscription()` | admin check + audit log |
| `list_error_logs_for_admin()` | admin check + `SET search_path = ''` (anti search-path hijack) |
| `mark_debt_paid()` / `delete_debt_secure()` | verifikasi `auth.uid()` + kepemilikan `store_id` |

### 4. Edge Function `admin-subscription` — Berlapis
- JWT divalidasi via `auth.getUser()` (bukan percaya header mentah).
- Keanggotaan admin dicek server-side: `admin_users.email = callerEmail`.
- Service role **hanya** dipakai di server (tidak pernah ke client).
- CORS: allowlist `simpelkasir.my.id`, `www.simpelkasir.my.id`, `kasir-umkm-simpel.vercel.app`; origin lain → 403/terblokir browser. Probe live mengonfirmasi.
- `delete_store`: toko milik akun admin sendiri diblokir; audit log ditulis SEBELUM hapus (tetap tersimpan setelah hapus via FK SET NULL); multi-cabang ditangani (hapus baris vs hapus akun).
- Semua respons kini membawa header `x-ef-version` untuk verifikasi versi deploy.

### 5. Security Headers Produksi (Vercel) — BAGUS
- `strict-transport-security: max-age=63072000` (HSTS 2 tahun)
- `content-security-policy` ada, termasuk `frame-ancestors 'none'` (anti clickjacking)
- `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`
- `referrer-policy: strict-origin-when-cross-origin`
- `permissions-policy`: mic & geolocation ditolak, kamera hanya untuk scanner barcode di origin sendiri

### 6. Client-Side
- Tidak ada secret di repo: `config.js` tidak ter-commit (.gitignore). Yang hardcoded hanya **anon key** (`sb_publishable_...`) — memang sifatnya publik; keamanan dijamin RLS, bukan oleh kerahasiaan key.
- XSS: semua data user (nama toko, email, pesan error) di-render lewat `esc()` (83 pemakaian). Terverifikasi: `<script>alert(1)</script>` menjadi teks aman di tabel super admin.
- Password recovery: flow dijaga ketat dengan `passwordRecoveryMode` berbasis UID — menutup celah link reset PKCE.
- `customer-display.html` tidak mengambil data dari Supabase (murni BroadcastChannel antar-tab) — tidak menambah permukaan serangan.

---

## ⚠️ Temuan (urut severity)

### P1 — Perlu Tindakan
**T1. Kebijakan email confirmation — ✅ SUDAH DIPERBAIKI (8 Agu 2026)**
File `00_full_setup_project_baru.sql` berkomentar *"Jangan lupa matikan Confirm email"* — sebelumnya OFF, siapa pun bisa daftar dengan email siapa pun.
→ **STATUS: Confirm email sudah diaktifkan** di Supabase Dashboard oleh pemilik. Verifikasi kode: alur daftar (`handleRegister` → `needConfirm`) dan form register sudah menangani kasus ini — menampilkan pesan *"Akun dibuat! Silakan cek email Anda untuk konfirmasi, lalu masuk."* dan pindah ke tab login. Akun lama tidak terpengaruh.
→ Sisa saran: aktifkan CAPTCHA (hCaptcha/Cloudflare Turnstile) untuk login/signup bila ingin proteksi brute force tambahan.

**T2. CDN tanpa SRI (Subresource Integrity) — ✅ SUDAH DIPERBAIKI (8 Agu 2026)**
5 library CDN kini: versi di-pin (chart.js@4.5.1, supabase-js@2.112.2, qrcodejs@1.0.0, quagga@0.12.1, jsqr@1.4.0) + atribut `integrity` sha384 + `crossorigin="anonymous"` di `index.html` (3 library) dan `app.js` (2 library yang di-load dinamis via `loadScript`/`CDN_SRI`). Service-worker ASSETS ikut disinkronkan. Hash terverifikasi cocok dengan file yang disajikan CDN.
→ Catatan: update library di masa depan harus ikut memperbarui hash SRI.

**T3. Key Supabase hardcoded → rotasi menyakitkan + pintu bocor bila RLS salah**
`SUPABASE_URL` dan `SUPABASE_KEY` hardcode di `app.js:516-517`. Anon key publik by-design, jadi bukan bocor — tapi: (a) rotasi key butuh edit kode + redeploy; (b) tabel baru yang lupa `ENABLE RLS` langsung bisa diakses siapa pun.
→ Baku mutu: **setiap tabel baru wajib** `ENABLE ROW LEVEL SECURITY` + policy sebelum dipakai produksi (sudah jadi aturan CLAUDE.md — patuhi di semua migrasi berikutnya).

### P2 — Perbaikan yang Disarankan
**T4. CSP memakai `'unsafe-inline'` + `'unsafe-eval'`**
Melemahkan pertahanan XSS: browser tidak bisa memblokir script inline/menyisipkan. Tradeoff wajar untuk app vanilla + Tailwind CDN, tapi berarti keamanan XSS bergantung 100% pada disiplin `esc()`.
→ Tidak wajib diubah sekarang. Catatan: jangan pernah menghapus escaping karena "CSP sudah ada".

**T5. `activate` / `revoke` → silent success saat store tidak ada**
Update 0 baris tidak dianggap error, fungsi tetap balas `success: true` padahal tidak terjadi apa-apa.
→ Cek `data` hasil update / cek keberadaan store dulu (seperti di `delete_store`), balas 404 jika tidak ada.

**T6. Data bisnis sensitif di localStorage**
`pos_debts`, `qris_payload`, `qris_image`, `pending_subs_order`, plus sesi `sb-*` tersimpan plaintext. Terbaca oleh script apa pun di origin — jadi T2 (CDN) dan T4 (CSP) secara tidak langsung ikut membocorkan ini bila dieksploitasi.
→ Tradeoff offline-POS; minimal catat risiko ini. Enkripsi opsional (mis. WebCrypto dengan passphrase) hanya untuk data paling sensitif.

**T7. Admin check Edge Function berbasis email, RPC berbasis `user_id`**
`admin_users.email = callerEmail` di Edge Function vs `user_id = auth.uid()` di RPC. Tidak konsisten; jika user mengganti email, EF bisa menolak admin sah (atau sebaliknya jika ada duplikat historis).
→ Samakan: cek via `admin_users.user_id = user.id` di Edge Function juga.

**T8. `access-control-allow-origin: *` di response HTML produksi**
Header ACAO `*` pada dokumen HTML statis. Tidak berbahaya (tanpa credentials), tapi tidak perlu.
→ Hapus dari header response HTML (Vercel config / vercel.json) biar bersih.

### P3 — Info / Catatan
- **T9.** `x-ef-version` di repo (`supabase/functions/admin-subscription/index.ts`) belum di-commit — commit via Changes panel agar repo sinkron dengan yang ter-deploy.
- **T10.** `my_store_ids()` didefinisikan ulang di beberapa migration — pastikan versi terakhir yang dipakai konsisten (semua memakai `auth.uid()`, aman).

---

## Rekomendasi Prioritas

1. **Segera (dari dashboard, tanpa coding):** aktifkan **Confirm email** + CAPTCHA di Supabase Auth. (T1)
2. **Menengah (1 hari):** tambah **SRI** di 5 script CDN. (T2)
3. **Baku mutu:** tabel baru wajib RLS + policy sebelum produksi. (T3)
4. **Saat ada waktu:** perbaiki silent success `activate`/`revoke` (T5), samakan admin check EF ke `user_id` (T7).

---

## Cakupan yang Tidak Diuji (butuh kredensial/dashboard)

- Pengujian dengan akun super admin asli (butuh login kamu — tidak diminta).
- Setting Supabase Auth di dashboard (email confirmation, CAPTCHA, rate limit, MFA).
- Konfigurasi Supabase Dashboard (API keys, redirect URLs, function secrets).
- Audit dependensi npm lokal (repo ini tidak punya dependency runtime selain jsdom untuk test).
