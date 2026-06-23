-- =====================================================================
-- SUPER ADMIN PANEL — Kasir UMKM Simpel
-- Jalankan di Supabase → SQL Editor → RUN
-- Aman dijalankan berulang (idempotent).
-- =====================================================================

-- 1) TABEL SUPER ADMIN (daftar email yang berwenang sebagai super admin) -----
CREATE TABLE IF NOT EXISTS admin_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Aktifkan RLS agar tabel tidak bisa dibaca/ditulis sembarangan via anon key
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Super admin boleh membaca barisnya sendiri lewat JWT email match.
-- Tidak ada policy INSERT/UPDATE/DELETE dari client — hanya bisa diubah via SQL Editor.
DROP POLICY IF EXISTS "admin_read_self" ON admin_users;
CREATE POLICY "admin_read_self" ON admin_users
  FOR SELECT
  USING (email = auth.jwt() ->> 'email');

-- 2) TABEL LOG AKSI ADMIN -------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_action_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email     TEXT NOT NULL,
  target_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,          -- 'activate_premium' | 'activate_business' | 'revoke'
  old_value       JSONB,
  new_value       JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admin_action_logs ENABLE ROW LEVEL SECURITY;

-- Super admin boleh melihat log aksinya sendiri (opsional, dipakai Edge Function via service-role)
DROP POLICY IF EXISTS "admin_log_read_self" ON admin_action_logs;
CREATE POLICY "admin_log_read_self" ON admin_action_logs
  FOR SELECT
  USING (admin_email = auth.jwt() ->> 'email');

-- 3) RPC: list semua toko beserta info langganan (SECURITY DEFINER = berjalan
--    sebagai pemilik fungsi, melewati RLS stores) -----------------------------
CREATE OR REPLACE FUNCTION list_all_stores_for_admin()
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  owner_id        UUID,
  owner_email     TEXT,
  trial_ends_at   TIMESTAMPTZ,
  premium_until   TIMESTAMPTZ,
  business_until  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  caller_email TEXT := auth.jwt() ->> 'email';
BEGIN
  -- Hanya email yang terdaftar di admin_users boleh memanggil fungsi ini
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = caller_email) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
    SELECT
      s.id,
      s.name,
      s.owner_id,
      u.email::TEXT   AS owner_email,
      s.trial_ends_at,
      s.premium_until,
      s.business_until,
      s.created_at
    FROM stores s
    LEFT JOIN auth.users u ON u.id = s.owner_id
    ORDER BY s.created_at DESC;
END;
$$;

-- 4) RPC: activate_subscription — dipakai Edge Function (service-role),
--    disertakan agar bisa dipanggil via supabase.rpc() di Edge Function -------
CREATE OR REPLACE FUNCTION activate_subscription(
  p_store_id       UUID,
  p_package        TEXT,    -- 'premium' | 'business'
  p_until          TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_premium  TIMESTAMPTZ;
  v_old_business TIMESTAMPTZ;
  -- Extract caller identity from JWT so callers cannot spoof the audit email
  v_admin_email  TEXT := auth.jwt() ->> 'email';
BEGIN
  SELECT premium_until, business_until
    INTO v_old_premium, v_old_business
    FROM stores WHERE id = p_store_id;

  IF p_package = 'premium' THEN
    UPDATE stores SET premium_until = p_until WHERE id = p_store_id;
    INSERT INTO admin_action_logs (admin_email, target_store_id, action, old_value, new_value)
      VALUES (
        v_admin_email,
        p_store_id,
        'activate_premium',
        jsonb_build_object('premium_until', v_old_premium),
        jsonb_build_object('premium_until', p_until)
      );
  ELSIF p_package = 'business' THEN
    UPDATE stores SET business_until = p_until WHERE id = p_store_id;
    INSERT INTO admin_action_logs (admin_email, target_store_id, action, old_value, new_value)
      VALUES (
        v_admin_email,
        p_store_id,
        'activate_business',
        jsonb_build_object('business_until', v_old_business),
        jsonb_build_object('business_until', p_until)
      );
  ELSE
    RAISE EXCEPTION 'paket tidak dikenal: %', p_package;
  END IF;
END;
$$;

-- 5) RPC: revoke_subscription — set premium_until dan business_until ke NULL --
CREATE OR REPLACE FUNCTION revoke_subscription(
  p_store_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_premium  TIMESTAMPTZ;
  v_old_business TIMESTAMPTZ;
  -- Extract caller identity from JWT so callers cannot spoof the audit email
  v_admin_email  TEXT := auth.jwt() ->> 'email';
BEGIN
  SELECT premium_until, business_until
    INTO v_old_premium, v_old_business
    FROM stores WHERE id = p_store_id;

  UPDATE stores SET premium_until = NULL, business_until = NULL WHERE id = p_store_id;

  INSERT INTO admin_action_logs (admin_email, target_store_id, action, old_value, new_value)
    VALUES (
      v_admin_email,
      p_store_id,
      'revoke',
      jsonb_build_object('premium_until', v_old_premium, 'business_until', v_old_business),
      jsonb_build_object('premium_until', NULL, 'business_until', NULL)
    );
END;
$$;

-- SELESAI ✅
-- Cara menambah super admin:
--   INSERT INTO admin_users (email) VALUES ('email@admin.com');
