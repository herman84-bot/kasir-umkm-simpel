-- =====================================================================
-- MIGRATION 18 — Security Audit Fixes
-- Kasir UMKM Simpel
-- Jalankan di Supabase → SQL Editor → RUN
-- Aman dijalankan berulang (idempotent).
-- =====================================================================

-- 1) SECURE_ADJUST_STOCK — Function yang dipanggil dari app.js tapi
--    belum terdefinisi di migration. Dibuat dengan SECURITY INVOKER
--    agar RLS pada tabel products tetap berlaku.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.secure_adjust_stock(
  p_product_id BIGINT,
  p_new_stock NUMERIC,
  p_reason TEXT DEFAULT 'adjustment',
  p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_store_id UUID;
  v_old_stock NUMERIC;
  v_diff NUMERIC;
BEGIN
  SELECT store_id, stock INTO v_store_id, v_old_stock
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan atau bukan milik toko Anda';
  END IF;

  v_diff := p_new_stock - v_old_stock;

  UPDATE public.products
  SET stock = p_new_stock
  WHERE id = p_product_id;

  INSERT INTO public.stock_ledgers (
    store_id, product_id, reference_type, qty_changed,
    balance_stock, reason, note
  ) VALUES (
    v_store_id, p_product_id, p_reason, v_diff,
    p_new_stock, p_reason, p_note
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.secure_adjust_stock(BIGINT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.secure_adjust_stock(BIGINT, NUMERIC, TEXT, TEXT) TO authenticated;

-- 2) VERIFIKASI: Pastikan semua tabel utama punya RLS enabled
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_missing TEXT := '';
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'stores', 'products', 'transactions', 'transaction_items',
        'cashiers', 'purchases', 'purchase_items', 'debts',
        'subscription_orders', 'error_logs', 'cashier_shifts',
        'transaction_returns', 'return_items', 'inventory_adjustments',
        'stock_ledgers', 'admin_users', 'admin_action_logs'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = r.tablename
        AND c.relrowsecurity = true
    ) THEN
      v_missing := v_missing || r.tablename || ', ';
    END IF;
  END LOOP;

  IF v_missing != '' THEN
    RAISE WARNING 'Tabel WITHOUT RLS: %', v_missing;
  ELSE
    RAISE NOTICE 'Semua tabel utama sudah memiliki RLS enabled';
  END IF;
END $$;

-- 3) REVOKE akses PUBLIC dari semua RPC functions (defense-in-depth)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'decrement_stock', 'increment_stock', 'secure_adjust_stock',
        'create_debt_transaction', 'mark_debt_paid', 'delete_debt_secure',
        'list_all_stores_for_admin', 'list_error_logs_for_admin',
        'activate_subscription', 'revoke_subscription'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%s(%s) FROM PUBLIC',
      r.proname, r.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%s(%s) TO authenticated',
      r.proname, r.args
    );
  END LOOP;

  RAISE NOTICE 'Semua RPC functions: EXECUTE revoked dari PUBLIC, granted ke authenticated';
END $$;

-- SELESAI ✅
