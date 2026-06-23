-- =====================================================================
-- ATOMIC STOCK DECREMENT RPC — Kasir UMKM Simpel
-- Jalankan di Supabase → SQL Editor → RUN
-- Aman dijalankan berulang (idempotent).
-- =====================================================================

-- Fungsi ini menggantikan pola read-then-write di sisi klien,
-- sehingga dua transaksi bersamaan tidak saling timpa nilai stok.
-- SECURITY INVOKER: RLS policy "tenant_products" pada tabel products
-- tetap berlaku — pengguna hanya bisa mengurangi stok produk miliknya.
-- WHERE clause juga menyertakan pengecekan kepemilikan store_id sebagai
-- defense-in-depth: fungsi tidak akan mengubah produk milik tenant lain
-- meski caller berhasil menebak p_product_id yang valid.
CREATE OR REPLACE FUNCTION decrement_stock(p_product_id BIGINT, p_qty NUMERIC)
RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be positive';
  END IF;
  UPDATE products
  SET stock = GREATEST(0, stock - p_qty)
  WHERE id = p_product_id
    AND store_id IN (SELECT my_store_ids());
END;
$$;

-- Cabut akses eksekusi dari PUBLIC (mencakup anon) lalu berikan hanya ke authenticated.
-- Ini melindungi fungsi dari panggilan tanpa sesi auth yang valid,
-- terlepas dari konfigurasi RLS di masa mendatang.
REVOKE EXECUTE ON FUNCTION decrement_stock(BIGINT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decrement_stock(BIGINT, NUMERIC) TO authenticated;

-- SELESAI ✅
