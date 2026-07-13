-- Migration: Prevent Deletion of Main Store and Last Remaining Store

-- Server-side guard (lapisan kedua, bukan pengganti guard client-side di app.js):
-- - Toko utama (is_main = true) jadi acuan status langganan, tidak boleh dihapus.
-- - Owner minimal harus punya 1 toko aktif setiap saat.
CREATE OR REPLACE FUNCTION public.prevent_main_store_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF OLD.is_main IS TRUE THEN
    RAISE EXCEPTION 'Toko utama tidak bisa dihapus. Pindahkan status toko utama ke cabang lain dulu, baru hapus toko ini.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.owner_id = OLD.owner_id AND s.id <> OLD.id) THEN
    RAISE EXCEPTION 'Tidak bisa menghapus toko terakhir. Minimal harus ada 1 toko aktif.' USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_main_store_delete ON public.stores;

CREATE TRIGGER trg_prevent_main_store_delete
  BEFORE DELETE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_main_store_delete();
