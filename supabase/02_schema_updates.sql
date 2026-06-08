-- Schema updates for new features
-- Run these ALTER statements on your Supabase project SQL editor

-- Feature: Stok Minimum (min_stock)
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock NUMERIC DEFAULT 5;

-- Feature: Diskon per Transaksi
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0;

-- Feature: Metode Pembayaran
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Tunai';
