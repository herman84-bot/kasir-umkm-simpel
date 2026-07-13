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

-- 4) Cabang baru wajib warisi status langganan toko utama (trial_ends_at,
-- premium_until, business_until) dari server, BUKAN dari nilai yang dikirim
-- client saat INSERT. RLS stores hanya membatasi owner_id, tidak membatasi
-- kolom apa saja yang boleh diisi client saat insert — jadi client (console
-- browser / request dimodifikasi) bisa mengirim nilai apapun untuk kolom
-- subscription ini kalau kita percaya begitu saja. Trigger ini menimpa nilai
-- tsb dengan nilai otoritatif dari toko utama pemilik yang sama, supaya
-- client sama sekali tidak berpengaruh terhadap status langganan cabang baru.
CREATE OR REPLACE FUNCTION public.copy_subscription_from_main_store()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  main_store public.stores%ROWTYPE;
BEGIN
  IF NEW.is_main IS TRUE THEN
    -- Toko pertama owner: DEFAULT kolom DB berlaku, trial baru yang sah.
    RETURN NEW;
  END IF;

  SELECT * INTO main_store
  FROM public.stores
  WHERE owner_id = NEW.owner_id AND is_main IS TRUE
  LIMIT 1;

  IF FOUND THEN
    NEW.trial_ends_at := main_store.trial_ends_at;
    NEW.premium_until := main_store.premium_until;
    NEW.business_until := main_store.business_until;
  ELSE
    -- Edge case: owner belum punya toko utama. Jangan gagalkan insert,
    -- kolom-kolom ini nullable — biarkan NULL daripada percaya client.
    NEW.trial_ends_at := NULL;
    NEW.premium_until := NULL;
    NEW.business_until := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_copy_subscription_from_main_store ON public.stores;

CREATE TRIGGER trg_copy_subscription_from_main_store
  BEFORE INSERT ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_subscription_from_main_store();

-- 5) Kolom subscription (trial_ends_at, premium_until, business_until) HANYA
-- boleh diubah lewat RPC activate_subscription/revoke_subscription (SECURITY
-- DEFINER, jalan sebagai owner function) atau service_role (Edge Function
-- Pakasir webhook/admin-subscription), BUKAN langsung oleh role `authenticated`.
-- RLS stores cuma cek owner_id, tidak membatasi kolom — tanpa REVOKE ini,
-- owner mana pun bisa UPDATE premium_until/business_until sendiri langsung
-- (self-escalation/billing bypass) atau kirim nilai forged saat INSERT toko
-- pertama (is_main=true). Trigger BEFORE INSERT/UPDATE yang ada TETAP aman
-- jalan karena privilege check Postgres hanya berlaku pada kolom yang
-- disebutkan EKSPLISIT di statement client, bukan pada nilai yang di-set
-- trigger secara internal terhadap NEW.
REVOKE UPDATE (trial_ends_at, premium_until, business_until) ON public.stores FROM authenticated;
REVOKE INSERT (trial_ends_at, premium_until, business_until) ON public.stores FROM authenticated;
