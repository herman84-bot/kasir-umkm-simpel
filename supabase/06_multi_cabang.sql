-- =====================================================================
-- FITUR MULTI-CABANG — jalankan di SQL Editor → RUN
-- Mengizinkan 1 pemilik (owner) memiliki banyak toko/cabang.
-- Aman dijalankan berulang.
-- =====================================================================

-- 1) Hapus batasan "1 akun = 1 toko" agar owner bisa punya banyak cabang.
--    Nama constraint bawaan Postgres untuk UNIQUE(owner_id) = stores_owner_id_key.
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_owner_id_key;

-- 2) Pastikan ada kolom pembeda cabang (opsional, untuk label).
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT FALSE;

-- 3) Tandai toko pertama tiap owner sebagai "pusat" jika belum ada yang ditandai.
UPDATE stores s
SET is_main = TRUE
WHERE s.id = (
  SELECT id FROM stores s2
  WHERE s2.owner_id = s.owner_id
  ORDER BY created_at ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM stores s3 WHERE s3.owner_id = s.owner_id AND s3.is_main = TRUE
);

-- Catatan: fungsi my_store_ids() sudah mengembalikan SEMUA toko milik owner,
-- dan policy RLS sudah berbasis store_id IN (my_store_ids()), jadi tidak ada
-- perubahan policy yang diperlukan. Aplikasi memfilter per cabang aktif sendiri.

-- SELESAI ✅
