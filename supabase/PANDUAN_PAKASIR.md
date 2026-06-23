# Panduan Integrasi Pembayaran Pakasir (Langganan Otomatis)

Pembayaran langganan Premium/Bisnis kini diproses oleh **Pakasir**
(payment gateway resmi berlisensi QRIS). Langganan **aktif otomatis**
setelah pembayaran berhasil — tanpa konfirmasi manual.

## Cara kerja singkat

1. User klik **Bayar Sekarang via Pakasir** di overlay upgrade.
2. Aplikasi mencatat order (status `pending`) di tabel `subscription_orders`,
   lalu mengarahkan user ke halaman bayar Pakasir.
3. User membayar (QRIS / Virtual Account).
4. Pakasir mengirim **webhook** ke Supabase Edge Function `pakasir-webhook`.
5. Edge Function memverifikasi ulang ke Pakasir (pakai API Key rahasia),
   lalu mengaktifkan `premium_until` / `business_until` (+30 hari).
6. Aplikasi memantau status order dan membuka fitur secara otomatis. 🎉

API Key **tidak pernah** ada di kode frontend — aman.

## Langkah setup (sekali saja)

### 1. Jalankan SQL
Di Supabase → SQL Editor → RUN file:
```
supabase/08_pakasir.sql
```
(Pastikan 03_subscription.sql & 07_tier_bisnis.sql juga sudah dijalankan.)

### 2. Deploy Edge Function
Dari komputer dengan Supabase CLI terpasang & login:
```bash
supabase functions deploy pakasir-webhook --no-verify-jwt
```
> `--no-verify-jwt` wajib, karena webhook dipanggil oleh server Pakasir
> (tanpa token login user).

### 3. Set secret (API Key Pakasir)
Ambil **API Key** dari dashboard Pakasir → detail Proyek, lalu:
```bash
supabase secrets set PAKASIR_API_KEY=API_KEY_ANDA PAKASIR_SLUG=kasir-umkm-simpel
```
> `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` sudah tersedia otomatis
> di lingkungan Edge Function — tidak perlu di-set manual.

### 4. Daftarkan Webhook URL di Pakasir
Dashboard Pakasir → Proyek `kasir-umkm-simpel` → Edit → **Webhook URL**:
```
https://<project-ref>.supabase.co/functions/v1/pakasir-webhook
```
Ganti `<project-ref>` dengan ref proyek Supabase Anda
(mis. `pfmsblktxlnovtajnxvc`).

## Mengetes (mode Sandbox)
Jika proyek Pakasir masih Sandbox, lakukan simulasi pembayaran:
```bash
curl -L 'https://app.pakasir.com/api/paymentsimulation' \
  -H 'Content-Type: application/json' \
  -d '{"project":"kasir-umkm-simpel","order_id":"<ORDER_ID>","amount":25000,"api_key":"<API_KEY>"}'
```
`<ORDER_ID>` bisa dilihat di tabel `subscription_orders` (kolom paling baru).

## Catatan keamanan
- User biasa hanya bisa **INSERT** & **SELECT** order miliknya (RLS).
- Hanya webhook (service_role) yang boleh meng-UPDATE status `completed`,
  dan hanya setelah verifikasi ke Pakasir berhasil. User tidak bisa
  mengaktifkan langganan tanpa benar-benar membayar.
