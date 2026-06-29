-- =====================================================================
-- DELETE ACCOUNT CASCADE — Kasir UMKM Simpel
-- Ubah FK admin_users.user_id → auth.users(id) menjadi ON DELETE CASCADE
-- agar penghapusan auth.users otomatis membersihkan baris admin_users.
-- Aman dijalankan berulang (idempotent).
-- =====================================================================

-- Drop constraint lama (tanpa CASCADE), ganti dengan versi CASCADE
ALTER TABLE admin_users
  DROP CONSTRAINT IF EXISTS admin_users_user_id_fkey;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- SELESAI ✅
-- Setelah migrasi ini, memanggil auth.admin.deleteUser(uid) akan
-- otomatis menghapus baris admin_users yang mereferensikan uid tersebut.
