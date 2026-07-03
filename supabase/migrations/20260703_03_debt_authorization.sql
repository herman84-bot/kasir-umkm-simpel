-- Migration: Fix Missing Authorization for Debt Update and Delete

-- Ensure RLS on debts blocks direct UPDATE and DELETE
DROP POLICY IF EXISTS "tenant_debts" ON public.debts;

-- Re-create policy to only allow SELECT and INSERT for regular requests
CREATE POLICY "tenant_debts_select_insert" ON public.debts
  FOR SELECT
  USING (store_id IN (SELECT public.my_store_ids()));

CREATE POLICY "tenant_debts_insert" ON public.debts
  FOR INSERT
  WITH CHECK (store_id IN (SELECT public.my_store_ids()));


CREATE OR REPLACE FUNCTION public.mark_debt_paid(p_debt_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_store_id UUID;
  v_transaction_id BIGINT;
BEGIN
  -- Verify secure server-side session context instead of trusting client param
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: Only admin can mark debt as paid';
  END IF;

  -- Get debt details and verify ownership
  SELECT store_id, transaction_id INTO v_store_id, v_transaction_id 
  FROM public.debts WHERE id = p_debt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt not found';
  END IF;

  IF v_store_id NOT IN (SELECT public.my_store_ids()) THEN
    RAISE EXCEPTION 'Unauthorized: Debt does not belong to your store';
  END IF;

  -- Update debt
  UPDATE public.debts 
  SET status = 'lunas', paid_at = NOW() 
  WHERE id = p_debt_id;

  -- Update transaction if exists
  IF v_transaction_id IS NOT NULL THEN
    UPDATE public.transactions 
    SET payment_method = 'Lunas' 
    WHERE id = v_transaction_id;
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.delete_debt_secure(p_debt_id BIGINT, p_admin_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_store_id UUID;
  v_transaction_id BIGINT;
  v_debt_items JSONB;
  v_item JSONB;
  v_num_id BIGINT;
  v_qty NUMERIC;
BEGIN
  -- Verify secure server-side session context instead of trusting client param
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: Only admin can delete debt';
  END IF;

  -- Get debt details
  SELECT store_id, transaction_id, items INTO v_store_id, v_transaction_id, v_debt_items
  FROM public.debts WHERE id = p_debt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt not found';
  END IF;

  IF v_store_id NOT IN (SELECT public.my_store_ids()) THEN
    RAISE EXCEPTION 'Unauthorized: Debt does not belong to your store';
  END IF;

  -- Void transaction and restore stock
  IF v_transaction_id IS NOT NULL THEN
    UPDATE public.transactions 
    SET status = 'void', 
        void_reason = 'Kasbon Dihapus', 
        void_by = p_admin_name, 
        void_at = NOW()
    WHERE id = v_transaction_id;

    -- Restore stock
    IF v_debt_items IS NOT NULL AND jsonb_typeof(v_debt_items) = 'array' THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_debt_items)
      LOOP
        v_num_id := (v_item->>'product_id')::BIGINT;
        v_qty := (v_item->>'qty')::NUMERIC;
        IF v_num_id IS NOT NULL AND v_qty > 0 THEN
           PERFORM public.increment_stock(v_num_id, v_qty);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Delete debt
  DELETE FROM public.debts WHERE id = p_debt_id;
END;
$$;
