-- =====================================================================
-- MIGRATION 19 — Cashier PIN Hashing (bcrypt via pgcrypto)
-- Kasir UMKM Simpel
-- Jalankan di Supabase → SQL Editor → RUN
-- Aman dijalankan berulang (idempotent).
-- =====================================================================

-- 1) Aktifkan pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Hash semua PIN yang masih plaintext
--    Deteksi: password TIDAK diawali $2a$ / $2b$ / $2y$ (bcrypt prefix)
UPDATE cashiers
SET password = crypt(password, gen_salt('bf'))
WHERE password IS NOT NULL
  AND password !~ '^\$2[aby]\$';

-- 3) Trigger: hash otomatis saat INSERT/UPDATE password
--    Supaya PIN selalu ter-hash, tidak peduli dari mana data masuk.
CREATE OR REPLACE FUNCTION hash_cashier_pin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Hash jika password baru dan belum di-hash
  IF NEW.password IS NOT NULL AND NEW.password !~ '^\$2[aby]\$' THEN
    NEW.password := crypt(NEW.password, gen_salt('bf'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_cashier_pin ON cashiers;
CREATE TRIGGER trg_hash_cashier_pin
  BEFORE INSERT OR UPDATE OF password ON cashiers
  FOR EACH ROW
  EXECUTE FUNCTION hash_cashier_pin();

-- 4) RPC: verify_cashier_pin
--    Menerima store_id + PIN, mencari kasir di store tersebut yang PIN-nya cocok.
--    Mengembalikan id, name, role (TANPA password) atau NULL.
CREATE OR REPLACE FUNCTION verify_cashier_pin(
  p_store_id UUID,
  p_pin TEXT
)
RETURNS TABLE (
  id    BIGINT,
  name  TEXT,
  role  TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  -- Hanya bisa verify kasir di store milik pemanggil
  RETURN QUERY
  SELECT c.id, c.name, c.role
  FROM cashiers c
  WHERE c.store_id = p_store_id
    AND c.store_id IN (SELECT my_store_ids())
    AND c.password = crypt(p_pin, c.password)
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_cashier_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_cashier_pin(UUID, TEXT) TO authenticated;

-- 5) RPC: verify_admin_pin
--    Mencari kasir dengan role='admin' di store pemanggil yang PIN-nya cocok.
CREATE OR REPLACE FUNCTION verify_admin_pin(
  p_store_id UUID,
  p_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cashiers c
    WHERE c.store_id = p_store_id
      AND c.store_id IN (SELECT my_store_ids())
      AND c.role = 'admin'
      AND c.password = crypt(p_pin, c.password)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_admin_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_admin_pin(UUID, TEXT) TO authenticated;

-- SELESAI ✅
-- Setelah migration ini:
--   - Semua PIN di tabel cashiers ter-hash (bcrypt)
--   - PIN baru otomatis ter-hash via trigger
--   - Frontend bisa pakai verify_cashier_pin() / verify_admin_pin()
--   - Frontend TIDAK perlu lagi select password dari tabel cashiers

-- 6) Kolom has_pin: auto-update saat password berubah
ALTER TABLE cashiers ADD COLUMN IF NOT EXISTS has_pin BOOLEAN DEFAULT FALSE;

-- Update existing rows
UPDATE cashiers SET has_pin = (password IS NOT NULL AND password != '');

-- Trigger: update has_pin saat password berubah
CREATE OR REPLACE FUNCTION update_cashier_has_pin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.has_pin := (NEW.password IS NOT NULL AND NEW.password != '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_has_pin ON cashiers;
CREATE TRIGGER trg_update_has_pin
  BEFORE INSERT OR UPDATE OF password ON cashiers
  FOR EACH ROW
  EXECUTE FUNCTION update_cashier_has_pin();
