-- Migration: kasbon_fix
-- Deskripsi: Menambahkan kolom transaction_id ke tabel debts dan memperbarui RPC create_debt_transaction.

ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS transaction_id BIGINT REFERENCES public.transactions(id) ON DELETE CASCADE;

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
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_transaction_id bigint;
  v_debt_id bigint;
  v_item jsonb;
  v_product_id bigint;
  v_qty numeric;
  v_price numeric;
  v_product_name text;
  v_new_stock numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than 0';
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
