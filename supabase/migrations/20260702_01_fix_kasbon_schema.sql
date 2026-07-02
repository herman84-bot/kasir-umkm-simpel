-- Migration: fix_kasbon_schema
-- Deskripsi: Menambahkan kolom reason dan note yang dibutuhkan oleh RPC create_debt_transaction

ALTER TABLE public.stock_ledgers 
ADD COLUMN IF NOT EXISTS reason text,
ADD COLUMN IF NOT EXISTS note text;
