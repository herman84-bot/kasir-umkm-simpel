-- =====================================================================
-- PEMBAYARAN LANGGANAN OTOMATIS via PAKASIR — jalankan di SQL Editor → RUN
-- Membuat tabel order langganan. Webhook Pakasir (Edge Function) akan
-- menandai order 'completed' dan mengaktifkan premium_until/business_until.
-- Aman dijalankan berulang.
-- =====================================================================

CREATE TABLE IF NOT EXISTS subscription_orders (
  order_id     TEXT PRIMARY KEY,                    -- KUS-<store>-<timestamp>
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  tier         TEXT NOT NULL CHECK (tier IN ('premium', 'business')),
  amount       INTEGER NOT NULL,                    -- nominal tanpa titik (mis. 25000)
  status       TEXT NOT NULL DEFAULT 'pending',     -- pending | completed | failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscription_orders_store ON subscription_orders(store_id);

-- RLS: owner hanya boleh membuat & melihat order untuk tokonya sendiri.
-- Webhook memakai service_role key sehingga melewati RLS (boleh UPDATE).
ALTER TABLE subscription_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_orders_select ON subscription_orders;
CREATE POLICY subscription_orders_select ON subscription_orders
  FOR SELECT USING (store_id IN (SELECT my_store_ids()));

DROP POLICY IF EXISTS subscription_orders_insert ON subscription_orders;
CREATE POLICY subscription_orders_insert ON subscription_orders
  FOR INSERT WITH CHECK (store_id IN (SELECT my_store_ids()));

-- Catatan: TIDAK ada policy UPDATE/DELETE untuk user biasa — hanya webhook
-- (service_role) yang boleh mengubah status menjadi 'completed'. Ini mencegah
-- user mengaktifkan langganan sendiri tanpa benar-benar membayar.

-- SELESAI ✅
