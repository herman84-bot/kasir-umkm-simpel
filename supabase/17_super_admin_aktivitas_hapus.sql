-- =====================================================================
-- MIGRATION 17 — Super Admin: Aktivitas Toko + Hapus Toko
-- Kasir UMKM Simpel
-- Jalankan di Supabase → SQL Editor → RUN
-- Aman dijalankan berulang (idempotent).
-- =====================================================================

-- 1) RPC list_all_stores_for_admin — kini menyertakan DATA AKTIVITAS:
--    total_transactions (jumlah transaksi sukses, tanpa void) dan
--    last_transaction_at (waktu transaksi terakhir). Dipakai panel
--    super admin untuk menandai toko HIJAU (aktif bertransaksi) atau
--    MERAH (belum ada transaksi sama sekali).
-- ---------------------------------------------------------------------
-- Penting: tipe return berubah (8 kolom → 10 kolom), jadi fungsi lama
-- HARUS di-DROP dulu. PostgreSQL menolak CREATE OR REPLACE saat row
-- type berbeda (error 42P13). DROP IF EXISTS aman dijalankan berulang.
DROP FUNCTION IF EXISTS public.list_all_stores_for_admin();

CREATE OR REPLACE FUNCTION public.list_all_stores_for_admin()
RETURNS TABLE (
  id                  UUID,
  name                TEXT,
  owner_id            UUID,
  owner_email         TEXT,
  trial_ends_at       TIMESTAMPTZ,
  premium_until       TIMESTAMPTZ,
  business_until      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ,
  total_transactions  BIGINT,
  last_transaction_at TIMESTAMPTZ
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
      s.created_at,
      COUNT(t.id)::BIGINT AS total_transactions,
      MAX(t.created_at)   AS last_transaction_at
    FROM stores s
    LEFT JOIN auth.users u ON u.id = s.owner_id
    LEFT JOIN transactions t
      ON t.store_id = s.id
     AND (t.status IS DISTINCT FROM 'void')   -- transaksi yang dibatalkan tidak dihitung
    GROUP BY
      s.id, s.name, s.owner_id, u.email,
      s.trial_ends_at, s.premium_until, s.business_until, s.created_at
    ORDER BY s.created_at DESC;
END;
$$;

-- 2) ADMIN ACTION LOG — biarkan baris audit TERSIMPAN meski toko dihapus.
--    Sebelumnya target_store_id NOT NULL + ON DELETE CASCADE, jadi log
--    hapus toko ikut terhapus. Sekarang: nullable + ON DELETE SET NULL,
--    sehingga catatan "admin menghapus toko X" tetap bisa dilihat.
-- ---------------------------------------------------------------------
ALTER TABLE admin_action_logs ALTER COLUMN target_store_id DROP NOT NULL;

ALTER TABLE admin_action_logs
  DROP CONSTRAINT IF EXISTS admin_action_logs_target_store_id_fkey;

ALTER TABLE admin_action_logs
  ADD CONSTRAINT admin_action_logs_target_store_id_fkey
  FOREIGN KEY (target_store_id) REFERENCES stores(id) ON DELETE SET NULL;

-- SELESAI ✅
-- Catatan:
--   - Aksi hapus toko dieksekusi lewat Edge Function `admin-subscription`
--     (action 'delete_store') dengan service-role, bukan dari client.
--   - Menghapus akun pemilik (auth.users) otomatis menghapus toko beserta
--     semua datanya lewat FK ON DELETE CASCADE (stores.owner_id). Karena
--     multi-cabang aktif (migration 06), akun hanya dihapus bila ini
--     satu-satunya toko milik pemilik — lihat logika delete_store.
