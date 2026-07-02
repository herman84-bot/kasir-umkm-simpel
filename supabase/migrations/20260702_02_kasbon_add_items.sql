-- =====================================================================
-- PERBAIKAN SCHEMA KASBON (debts.items)
-- Menambahkan kolom items (JSONB) ke tabel debts jika belum ada.
-- Ini mencegah error ketika fungsi RPC create_debt_transaction
-- mencoba memasukkan data array items ke tabel debts.
-- =====================================================================

ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;
