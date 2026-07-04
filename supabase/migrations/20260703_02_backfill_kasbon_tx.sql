-- Migration: backfill_kasbon_tx
-- Deskripsi: Menghubungkan kasbon lama yang belum memiliki transaction_id dengan riwayat transaksinya

UPDATE public.debts d
SET transaction_id = t.id
FROM public.transactions t
WHERE t.client_id = 'D-' || d.id
  AND d.transaction_id IS NULL;
