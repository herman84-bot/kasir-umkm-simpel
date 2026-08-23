-- =====================================================================
-- FIX: create_debt_transaction 403 + cashiers has_pin missing
-- Jalankan di Supabase → SQL Editor → RUN
-- =====================================================================

-- 1) Pastikan kolom has_pin ada (migration 19 mungkin belum jalan)
ALTER TABLE cashiers ADD COLUMN IF NOT EXISTS has_pin BOOLEAN DEFAULT FALSE;
UPDATE cashiers SET has_pin = (password IS NOT NULL AND password != '')
  WHERE has_pin IS DISTINCT FROM (password IS NOT NULL AND password != '');

-- 2) Fix create_debt_transaction: ubah ke SECURITY DEFINER
--    SECURITY INVOKER → RLS berlaku di dalam function → INSERT gagal 403
--    SECURITY DEFINER → function jalan sebagai owner → bypass RLS
CREATE OR REPLACE FUNCTION public.create_debt_transaction(
  p_store_id uuid,
  p_customer_name text,
  p_phone text,
  p_amount numeric,
  p_note text,
  p_items jsonb,
  p_cashier_name text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_transaction_id bigint;
  v_debt_id bigint;
  v_item jsonb;
  v_product_id bigint;
  v_qty numeric;
  v_price numeric;
  v_product_name text;
  v_new_stock numeric;
  v_is_premium boolean;
  v_active_debt_count int;
BEGIN
  -- Verify caller is authenticated
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Verify store belongs to caller
  IF NOT EXISTS (
    SELECT 1 FROM public.stores WHERE id = p_store_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: store does not belong to you';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than 0';
  END IF;

  -- Server-side validation 1: Check existing unpaid debt for the same customer
  IF EXISTS (
    SELECT 1 FROM public.debts
    WHERE store_id = p_store_id
      AND lower(customer_name) = lower(p_customer_name)
      AND status != 'lunas'
  ) THEN
    RAISE EXCEPTION 'Pelanggan % masih memiliki kasbon aktif yang belum lunas.', p_customer_name;
  END IF;

  -- Server-side validation 2: Free tier limit (max 5 active kasbons)
  SELECT (
    COALESCE(trial_ends_at, created_at + interval '30 days') > now() OR
    premium_until > now() OR
    business_until > now()
  ) INTO v_is_premium
  FROM public.stores
  WHERE id = p_store_id;

  IF COALESCE(v_is_premium, false) = false THEN
    SELECT count(*) INTO v_active_debt_count
    FROM public.debts
    WHERE store_id = p_store_id AND status != 'lunas';

    IF v_active_debt_count >= 5 THEN
      RAISE EXCEPTION 'Limit tercapai. Upgrade Premium untuk membuat lebih dari 5 kasbon aktif.';
    END IF;
  END IF;

  -- 1. Insert into debts
  INSERT INTO public.debts (store_id, customer_name, phone, amount, note, status, items)
  VALUES (p_store_id, p_customer_name, p_phone, p_amount, p_note, 'belum', p_items)
  RETURNING id INTO v_debt_id;

  -- 2. Insert into transactions (status: Hutang)
  INSERT INTO public.transactions (store_id, total_amount, discount_amount, payment_method, cashier_name, client_id)
  VALUES (p_store_id, p_amount, 0, 'Hutang', p_cashier_name, 'D-' || v_debt_id)
  RETURNING id INTO v_transaction_id;

  -- 3. Update debts with transaction_id
  UPDATE public.debts SET transaction_id = v_transaction_id WHERE id = v_debt_id;

  -- 4. Loop items to insert transaction_items and decrement stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::bigint;
    v_qty := (v_item->>'qty')::numeric;
    v_price := (v_item->>'price')::numeric;
    v_product_name := v_item->>'product_name';

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than 0';
    END IF;

    -- Insert transaction_items
    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, quantity, price_at_sale, subtotal)
    VALUES (v_transaction_id, v_product_id, v_product_name, v_qty, v_price, v_qty * v_price);

    -- Decrement stock and write to ledger
    UPDATE public.products
    SET stock = GREATEST(0, stock - v_qty)
    WHERE id = v_product_id AND store_id = p_store_id
    RETURNING stock INTO v_new_stock;

    IF v_new_stock IS NOT NULL THEN
      INSERT INTO public.stock_ledgers (
        store_id, product_id, reference_type, qty_changed, balance_stock, cashier_name, reference_id
      ) VALUES (
        p_store_id, v_product_id, 'kasbon', -v_qty, v_new_stock, p_cashier_name, 'D-' || v_debt_id
      );
    END IF;
  END LOOP;

  -- Return the new debt ID and transaction ID
  RETURN jsonb_build_object('debt_id', v_debt_id, 'transaction_id', v_transaction_id);
END;
$$;

-- 3) Pastikan EXECUTE grant untuk authenticated
REVOKE EXECUTE ON FUNCTION public.create_debt_transaction(uuid,text,text,numeric,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_debt_transaction(uuid,text,text,numeric,text,jsonb,text) TO authenticated;

-- SELESAI ✅
