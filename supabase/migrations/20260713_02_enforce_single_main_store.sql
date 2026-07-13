-- Migration: Enforce Single Main Store per Owner + Fix search_path Mutable

-- Latar: sejak backfill is_main lama, handleRegister & alur fallback toko pertama
-- TIDAK PERNAH set is_main=true (kolom diam-diam DEFAULT FALSE). Semua owner yang
-- daftar setelah backfill lama itu saat ini punya NOL toko is_main=true, artinya
-- trigger prevent_main_store_delete (20260713_01) tidak melindungi toko mereka.
-- Migration ini: (1) backfill idempotent, (2) unique index cegah 2 toko is_main
-- untuk owner yang sama, (3) fix search_path mutable pada 2 trigger function baru.

-- 1) Backfill idempotent: owner yang saat ini tidak punya satupun toko is_main=true
-- diberi is_main=true pada toko dengan created_at paling awal miliknya.
UPDATE public.stores s
SET is_main = TRUE
FROM (
  SELECT DISTINCT ON (owner_id) id, owner_id
  FROM public.stores
  ORDER BY owner_id, created_at ASC, id ASC
) earliest
WHERE s.id = earliest.id
  AND NOT EXISTS (
    SELECT 1 FROM public.stores existing_main
    WHERE existing_main.owner_id = earliest.owner_id
      AND existing_main.is_main IS TRUE
  );

-- 2) Unique index partial: pastikan tiap owner maksimal 1 toko is_main=true.
-- INSERT/UPDATE yang membuat toko kedua is_main=true untuk owner sama akan gagal.
DROP INDEX IF EXISTS public.ux_stores_owner_main;

CREATE UNIQUE INDEX ux_stores_owner_main
  ON public.stores (owner_id)
  WHERE is_main IS TRUE;

-- 3) Fix search_path mutable pada 2 trigger function baru (20260713_01).
-- Logic/behavior TIDAK berubah — hanya tambah SET search_path = public.
CREATE OR REPLACE FUNCTION public.prevent_main_store_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(OLD.owner_id::text));

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

CREATE OR REPLACE FUNCTION public.prevent_main_store_flag_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_main IS TRUE AND NEW.is_main IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Status toko utama tidak bisa diubah langsung.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_main_store_flag_change ON public.stores;

CREATE TRIGGER trg_prevent_main_store_flag_change
  BEFORE UPDATE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_main_store_flag_change();
