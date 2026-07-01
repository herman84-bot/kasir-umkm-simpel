ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS returned_qty NUMERIC NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_purchase_id TEXT, p_store_id UUID, p_supplier TEXT, p_total NUMERIC, p_items JSONB, p_cashier TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_item RECORD; v_new_stock NUMERIC;
BEGIN
  INSERT INTO public.purchases (id, store_id, supplier, total, status, created_at)
  VALUES (p_purchase_id, p_store_id, p_supplier, p_total, 'Diterima', NOW());
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id BIGINT, product_name TEXT, quantity NUMERIC, price NUMERIC) LOOP
    INSERT INTO public.purchase_items (purchase_id, product_id, product_name, quantity, price, subtotal, returned_qty)
    VALUES (p_purchase_id, v_item.product_id, v_item.product_name, v_item.quantity, v_item.price, (v_item.quantity * v_item.price), 0);
    UPDATE public.products SET stock = stock + v_item.quantity WHERE id = v_item.product_id AND store_id = p_store_id RETURNING stock INTO v_new_stock;
    IF v_new_stock IS NOT NULL THEN
      INSERT INTO public.stock_ledgers (product_id, store_id, cashier_name, reference_type, qty_changed, balance_stock, reason, note, created_at)
      VALUES (v_item.product_id, p_store_id, p_cashier, 'purchase', v_item.quantity, v_new_stock, 'Pembelian', 'Pembelian dari ' || p_supplier || ' (PO #' || p_purchase_id || ')', NOW());
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_purchase_item(
  p_purchase_id TEXT, p_product_id BIGINT, p_qty_to_return NUMERIC, p_cashier TEXT, p_reason TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_store_id UUID; v_new_stock NUMERIC; v_purchase_item_qty NUMERIC;
  v_purchase_item_returned NUMERIC; v_supplier TEXT;
  v_total_items INT; v_fully_returned_items INT;
BEGIN
  SELECT store_id, supplier INTO v_store_id, v_supplier FROM public.purchases WHERE id = p_purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan: %', p_purchase_id; END IF;
  SELECT quantity, returned_qty INTO v_purchase_item_qty, v_purchase_item_returned FROM public.purchase_items WHERE purchase_id = p_purchase_id AND product_id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item tidak ada dalam invoice'; END IF;
  IF (v_purchase_item_qty - v_purchase_item_returned) < p_qty_to_return THEN RAISE EXCEPTION 'Jumlah retur melebihi sisa yang bisa diretur'; END IF;
  UPDATE public.purchase_items SET returned_qty = returned_qty + p_qty_to_return WHERE purchase_id = p_purchase_id AND product_id = p_product_id;
  UPDATE public.products SET stock = stock - p_qty_to_return WHERE id = p_product_id AND store_id = v_store_id RETURNING stock INTO v_new_stock;
  IF v_new_stock < 0 THEN RAISE EXCEPTION 'Stok tidak boleh kurang dari 0'; END IF;
  INSERT INTO public.stock_ledgers (product_id, store_id, cashier_name, reference_type, qty_changed, balance_stock, reason, note, created_at)
  VALUES (p_product_id, v_store_id, p_cashier, 'return', -p_qty_to_return, v_new_stock, 'Retur ke Supplier', 'Retur ke ' || v_supplier || ' (PO #' || p_purchase_id || '): ' || p_reason, NOW());
  SELECT COUNT(*), COUNT(CASE WHEN quantity = returned_qty THEN 1 END) INTO v_total_items, v_fully_returned_items FROM public.purchase_items WHERE purchase_id = p_purchase_id;
  IF v_total_items = v_fully_returned_items THEN UPDATE public.purchases SET status = 'Diretur' WHERE id = p_purchase_id;
  ELSIF EXISTS (SELECT 1 FROM public.purchase_items WHERE purchase_id = p_purchase_id AND returned_qty > 0) THEN UPDATE public.purchases SET status = 'Sebagian Diretur' WHERE id = p_purchase_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_purchase_item(TEXT, BIGINT, NUMERIC, TEXT, TEXT) TO anon, authenticated;
