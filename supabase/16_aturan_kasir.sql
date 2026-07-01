-- Migration 16: Aturan Kasir & Shift Management
-- Idempotent: safe to run multiple times

-- 1) Table cashier_shifts
CREATE TABLE IF NOT EXISTS public.cashier_shifts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  cashier_id          BIGINT REFERENCES public.cashiers(id) ON DELETE SET NULL,
  opened_at           TIMESTAMPTZ DEFAULT NOW(),
  closed_at           TIMESTAMPTZ,
  cash_float_amount   NUMERIC DEFAULT 0,
  expected_cash       NUMERIC DEFAULT 0,
  actual_cash         NUMERIC DEFAULT 0,
  discrepancy         NUMERIC DEFAULT 0,
  note                TEXT
);

-- 2) Columns on transactions
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'void'));
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS void_by TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS void_at TIMESTAMPTZ;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.cashier_shifts(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payment_cash_amount NUMERIC DEFAULT 0;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payment_noncash_amount NUMERIC DEFAULT 0;

-- 3) Table transaction_returns
CREATE TABLE IF NOT EXISTS public.transaction_returns (
  id                  BIGSERIAL PRIMARY KEY,
  transaction_id      BIGINT REFERENCES public.transactions(id) ON DELETE SET NULL,
  store_id            UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  cashier_name        TEXT,
  refund_amount       NUMERIC DEFAULT 0,
  return_reason       TEXT,
  authorized_by       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 4) Table return_items
CREATE TABLE IF NOT EXISTS public.return_items (
  id                  BIGSERIAL PRIMARY KEY,
  return_id           BIGINT REFERENCES public.transaction_returns(id) ON DELETE CASCADE,
  product_id          BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  quantity            NUMERIC DEFAULT 0,
  price_at_return     NUMERIC DEFAULT 0
);

-- 5) RLS Enabled
ALTER TABLE public.cashier_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;

-- 6) RLS Policies
DROP POLICY IF EXISTS "tenant_cashier_shifts" ON public.cashier_shifts;
CREATE POLICY "tenant_cashier_shifts" ON public.cashier_shifts
  FOR ALL
  USING (store_id IN (SELECT public.my_store_ids()))
  WITH CHECK (store_id IN (SELECT public.my_store_ids()));

DROP POLICY IF EXISTS "tenant_transaction_returns" ON public.transaction_returns;
CREATE POLICY "tenant_transaction_returns" ON public.transaction_returns
  FOR ALL
  USING (store_id IN (SELECT public.my_store_ids()))
  WITH CHECK (store_id IN (SELECT public.my_store_ids()));

DROP POLICY IF EXISTS "tenant_return_items" ON public.return_items;
CREATE POLICY "tenant_return_items" ON public.return_items
  FOR ALL
  USING (return_id IN (
    SELECT id FROM public.transaction_returns WHERE store_id IN (SELECT public.my_store_ids())
  ))
  WITH CHECK (return_id IN (
    SELECT id FROM public.transaction_returns WHERE store_id IN (SELECT public.my_store_ids())
  ));

-- 7) Atomic Stock Increment RPC
CREATE OR REPLACE FUNCTION public.increment_stock(p_product_id BIGINT, p_qty NUMERIC)
RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be positive';
  END IF;
  UPDATE public.products
  SET stock = stock + p_qty
  WHERE id = p_product_id
    AND store_id IN (SELECT public.my_store_ids());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_stock(BIGINT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_stock(BIGINT, NUMERIC) TO authenticated;
