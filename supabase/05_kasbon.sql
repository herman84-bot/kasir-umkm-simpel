-- =====================================================================
-- FITUR KASBON / HUTANG PELANGGAN — jalankan di SQL Editor → RUN
-- Aman dijalankan berulang.
-- =====================================================================

CREATE TABLE IF NOT EXISTS debts (
  id            BIGSERIAL PRIMARY KEY,
  store_id      UUID REFERENCES stores(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  phone         TEXT,
  amount        NUMERIC DEFAULT 0,
  note          TEXT,
  status        TEXT DEFAULT 'belum',     -- 'belum' | 'lunas'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  paid_at       TIMESTAMPTZ
);

ALTER TABLE debts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_debts" ON debts;
CREATE POLICY "tenant_debts" ON debts
  FOR ALL
  USING (store_id IN (SELECT my_store_ids()))
  WITH CHECK (store_id IN (SELECT my_store_ids()));

-- SELESAI ✅
