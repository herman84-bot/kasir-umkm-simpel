-- =====================================================================
-- SINKRONISASI FINAL — jalankan SELURUH script ini di SQL Editor → RUN
-- Menggabungkan semua update skema. Aman dijalankan berulang.
-- =====================================================================

-- 1) Fitur stok minimum, diskon, metode pembayaran (dari 02)
ALTER TABLE products     ADD COLUMN IF NOT EXISTS min_stock       NUMERIC DEFAULT 5;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method  TEXT    DEFAULT 'Tunai';

-- 2) Langganan / premium (dari 03)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days');
ALTER TABLE stores ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;
UPDATE stores SET trial_ends_at = NOW() + INTERVAL '30 days' WHERE trial_ends_at IS NULL;

-- 3) QRIS toko di cloud (sinkron antar perangkat)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS qris_image   TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS qris_payload TEXT;

-- SELESAI ✅
-- =====================================================================
-- CARA AKTIVASI PREMIUM PELANGGAN (setelah mereka bayar):
--   UPDATE stores SET premium_until = NOW() + INTERVAL '30 days'
--   WHERE id = (SELECT s.id FROM stores s JOIN auth.users u ON u.id = s.owner_id
--               WHERE u.email = 'email_pelanggan@gmail.com');
-- =====================================================================
