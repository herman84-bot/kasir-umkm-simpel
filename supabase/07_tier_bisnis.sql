-- =====================================================================
-- TIER BISNIS (Multi-Cabang) — jalankan di SQL Editor → RUN
-- Menambah kolom business_until untuk paket Bisnis (di atas Premium).
-- Aman dijalankan berulang.
-- =====================================================================

-- Paket Bisnis: membuka Multi-Cabang. Diaktifkan manual setelah pembayaran
-- (set business_until = tanggal kedaluwarsa, mis. NOW() + interval '1 month').
ALTER TABLE stores ADD COLUMN IF NOT EXISTS business_until TIMESTAMPTZ;

-- Catatan model langganan:
--  • trial_ends_at  → 30 hari pertama (semua fitur terbuka)
--  • premium_until  → paket Premium (QRIS dinamis, PDF, operator/kasbon tanpa batas)
--  • business_until → paket Bisnis (Premium + Multi-Cabang)
-- Aplikasi menambatkan status langganan ke TOKO UTAMA (is_main), sehingga
-- seluruh cabang berbagi satu langganan dan cabang baru TIDAK dapat trial sendiri.

-- Contoh mengaktifkan Bisnis 1 bulan untuk sebuah toko utama:
--   UPDATE stores SET business_until = NOW() + INTERVAL '1 month'
--   WHERE id = '<id-toko-utama>';

-- SELESAI ✅
