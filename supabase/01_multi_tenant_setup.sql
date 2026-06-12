-- =====================================================================
-- MULTI-TENANT + KEAMANAN (RLS) — Kasir UMKM Simpel
-- Jalankan SELURUH script ini di Supabase → SQL Editor → RUN
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

-- 2) TAMBAH KOLOM store_id KE SEMUA TABEL DATA ---------------------------
ALTER TABLE products     ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE cashiers     ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE purchases    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;

-- 3) HAPUS POLICY LAMA YANG TIDAK AMAN (USING true) ----------------------
DROP POLICY IF EXISTS "Allow all access to products"          ON products;
DROP POLICY IF EXISTS "Allow all access to transactions"      ON transactions;
DROP POLICY IF EXISTS "Allow all access to transaction_items" ON transaction_items;
DROP POLICY IF EXISTS "Allow all access to cashiers"          ON cashiers;
DROP POLICY IF EXISTS "Allow all access to purchases"         ON purchases;
DROP POLICY IF EXISTS "Allow all access to purchase_items"    ON purchase_items;

-- 4) AKTIFKAN RLS DI SEMUA TABEL -----------------------------------------
ALTER TABLE stores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashiers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items    ENABLE ROW LEVEL SECURITY;

-- 5) FUNGSI BANTU: daftar store_id milik user yang login -----------------
CREATE OR REPLACE FUNCTION my_store_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM stores WHERE owner_id = auth.uid()
$$;

-- 6) POLICY: STORES ------------------------------------------------------
DROP POLICY IF EXISTS "store_owner_all" ON stores;
CREATE POLICY "store_owner_all" ON stores
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- 7) POLICY: tabel dengan kolom store_id ---------------------------------
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

-- 8) POLICY: tabel item (lewat parent transaction/purchase) --------------
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

-- =====================================================================
-- OPSIONAL: hapus data demo lama yang belum punya store_id (orphan)
-- Hapus tanda komentar (--) di bawah jika ingin membersihkan data lama.
-- =====================================================================
-- DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE store_id IS NULL);
-- DELETE FROM purchase_items    WHERE purchase_id    IN (SELECT id FROM purchases    WHERE store_id IS NULL);
-- DELETE FROM transactions WHERE store_id IS NULL;
-- DELETE FROM purchases    WHERE store_id IS NULL;
-- DELETE FROM products     WHERE store_id IS NULL;
-- DELETE FROM cashiers     WHERE store_id IS NULL;

-- SELESAI ✅
