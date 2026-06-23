-- =====================================================================
-- LANGGANAN / TRIAL 30 HARI — jalankan di Supabase SQL Editor → RUN
-- =====================================================================

-- Setiap toko baru otomatis dapat masa aktif 30 hari sejak daftar
ALTER TABLE stores ADD COLUMN IF NOT EXISTS trial_ends_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days');
ALTER TABLE stores ADD COLUMN IF NOT EXISTS premium_until  TIMESTAMPTZ;

-- Toko yang sudah terlanjur ada: beri 30 hari dari sekarang
UPDATE stores SET trial_ends_at = NOW() + INTERVAL '30 days' WHERE trial_ends_at IS NULL;

-- =====================================================================
-- CARA AKTIVASI LANGGANAN (manual, setelah user bayar via QRIS):
-- 1. Buka Table Editor → stores → cari toko berdasarkan nama/email
-- 2. Isi kolom premium_until dengan tanggal kedaluwarsa baru, contoh 1 bulan:
--    UPDATE stores SET premium_until = NOW() + INTERVAL '30 days' WHERE name = 'NAMA TOKO';
-- =====================================================================
