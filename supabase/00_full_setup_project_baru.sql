-- =====================================================================
-- SETUP LENGKAP — Kasir UMKM Simpel (untuk PROJECT SUPABASE BARU/KOSONG)
-- Jalankan SELURUH script ini di Supabase → SQL Editor → RUN (sekali jalan).
-- Membuat semua tabel dari nol + multi-tenant + keamanan RLS.
-- Aman dijalankan berulang (idempotent).
-- =====================================================================

-- 1) TABEL STORES (data tiap toko/tenant) --------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  note        TEXT DEFAULT 'Terima kasih, selamat datang kembali!',
  paper_size  TEXT DEFAULT '58',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (owner_id)              -- 1 akun = 1 toko
);

-- 2) TABEL PRODUCTS ------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id         BIGSERIAL PRIMARY KEY,
  store_id   UUID REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  barcode    TEXT,
  category   TEXT DEFAULT 'Lainnya',
  price      NUMERIC DEFAULT 0,
  cost       NUMERIC DEFAULT 0,
  stock      NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3) TABEL CASHIERS (operator/PIN di dalam toko) -------------------------
CREATE TABLE IF NOT EXISTS cashiers (
  id         BIGSERIAL PRIMARY KEY,
  store_id   UUID REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  password   TEXT DEFAULT '1234',
  role       TEXT DEFAULT 'kasir',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4) TABEL TRANSACTIONS + ITEMS -----------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id             BIGSERIAL PRIMARY KEY,
  store_id       UUID REFERENCES stores(id) ON DELETE CASCADE,
  cashier_name   TEXT,
  total_amount   NUMERIC DEFAULT 0,
  payment_amount NUMERIC DEFAULT 0,
  change_amount  NUMERIC DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_items (
  id             BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT REFERENCES transactions(id) ON DELETE CASCADE,
  product_id     BIGINT,
  product_name   TEXT,
  quantity       NUMERIC DEFAULT 0,
  price_at_sale  NUMERIC DEFAULT 0,
  subtotal       NUMERIC DEFAULT 0
);

-- 5) TABEL PURCHASES + ITEMS --------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id         TEXT PRIMARY KEY,
  store_id   UUID REFERENCES stores(id) ON DELETE CASCADE,
  supplier   TEXT,
  total      NUMERIC DEFAULT 0,
  status     TEXT DEFAULT 'Diterima',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id           BIGSERIAL PRIMARY KEY,
  purchase_id  TEXT REFERENCES purchases(id) ON DELETE CASCADE,
  product_id   BIGINT,
  product_name TEXT,
  quantity     NUMERIC DEFAULT 0,
  price        NUMERIC DEFAULT 0,
  subtotal     NUMERIC DEFAULT 0
);

-- 6) AKTIFKAN RLS DI SEMUA TABEL -----------------------------------------
ALTER TABLE stores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashiers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items    ENABLE ROW LEVEL SECURITY;

-- 7) FUNGSI BANTU: daftar store_id milik user yang login -----------------
CREATE OR REPLACE FUNCTION my_store_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM stores WHERE owner_id = auth.uid()
$$;

-- 8) POLICY: STORES ------------------------------------------------------
DROP POLICY IF EXISTS "store_owner_all" ON stores;
CREATE POLICY "store_owner_all" ON stores
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- 9) POLICY: tabel dengan kolom store_id ---------------------------------
DROP POLICY IF EXISTS "tenant_products" ON products;
CREATE POLICY "tenant_products" ON products
  FOR ALL
  USING (store_id IN (SELECT my_store_ids()))
  WITH CHECK (store_id IN (SELECT my_store_ids()));

DROP POLICY IF EXISTS "tenant_transactions" ON transactions;
CREATE POLICY "tenant_transactions" ON transactions
  FOR ALL
  USING (store_id IN (SELECT my_store_ids()))
  WITH CHECK (store_id IN (SELECT my_store_ids()));

DROP POLICY IF EXISTS "tenant_cashiers" ON cashiers;
CREATE POLICY "tenant_cashiers" ON cashiers
  FOR ALL
  USING (store_id IN (SELECT my_store_ids()))
  WITH CHECK (store_id IN (SELECT my_store_ids()));

DROP POLICY IF EXISTS "tenant_purchases" ON purchases;
CREATE POLICY "tenant_purchases" ON purchases
  FOR ALL
  USING (store_id IN (SELECT my_store_ids()))
  WITH CHECK (store_id IN (SELECT my_store_ids()));

-- 10) POLICY: tabel item (lewat parent transaction/purchase) -------------
DROP POLICY IF EXISTS "tenant_transaction_items" ON transaction_items;
CREATE POLICY "tenant_transaction_items" ON transaction_items
  FOR ALL
  USING (transaction_id IN (
    SELECT id FROM transactions WHERE store_id IN (SELECT my_store_ids())))
  WITH CHECK (transaction_id IN (
    SELECT id FROM transactions WHERE store_id IN (SELECT my_store_ids())));

DROP POLICY IF EXISTS "tenant_purchase_items" ON purchase_items;
CREATE POLICY "tenant_purchase_items" ON purchase_items
  FOR ALL
  USING (purchase_id IN (
    SELECT id FROM purchases WHERE store_id IN (SELECT my_store_ids())))
  WITH CHECK (purchase_id IN (
    SELECT id FROM purchases WHERE store_id IN (SELECT my_store_ids())));

-- SELESAI ✅ — Project baru siap. Jangan lupa matikan "Confirm email".
