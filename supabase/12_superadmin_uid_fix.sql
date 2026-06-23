-- =====================================================================
-- SUPER ADMIN UID FIX — Kasir UMKM Simpel
-- Migrasi dari email-based RLS ke auth.uid()-based RLS.
-- Aman dijalankan berulang (idempotent).
-- =====================================================================

-- 1) Tambah kolom user_id ke admin_users jika belum ada ------------------
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- 2) Isi user_id dari existing rows berdasarkan join ke auth.users -------
UPDATE admin_users au
SET user_id = u.id
FROM auth.users u
WHERE u.email = au.email
  AND au.user_id IS NULL;

-- 3) Ganti RLS policy admin_users: gunakan user_id = auth.uid() ----------
DROP POLICY IF EXISTS "admin_read_self" ON admin_users;
CREATE POLICY "admin_read_self" ON admin_users
  FOR SELECT
  USING (user_id = auth.uid());

-- 4) Ganti RLS policy admin_action_logs: gunakan join ke admin_users -----
DROP POLICY IF EXISTS "admin_log_read_self" ON admin_action_logs;
CREATE POLICY "admin_log_read_self" ON admin_action_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.user_id = auth.uid()
        AND admin_users.email = admin_action_logs.admin_email
    )
  );

-- 5) RPC list_all_stores_for_admin — verifikasi via auth.uid() -----------
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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
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

-- 6) RPC activate_subscription — verifikasi via auth.uid() ---------------
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
  v_admin_email  TEXT;
BEGIN
  SELECT email INTO v_admin_email FROM admin_users WHERE user_id = auth.uid();
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

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

-- 7) RPC revoke_subscription — verifikasi via auth.uid() -----------------
CREATE OR REPLACE FUNCTION revoke_subscription(
  p_store_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_premium  TIMESTAMPTZ;
  v_old_business TIMESTAMPTZ;
  v_admin_email  TEXT;
BEGIN
  SELECT email INTO v_admin_email FROM admin_users WHERE user_id = auth.uid();
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

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
-- Cara menambah super admin baru (dengan user_id):
--   INSERT INTO admin_users (email, user_id)
--   SELECT 'email@admin.com', id FROM auth.users WHERE email = 'email@admin.com';
