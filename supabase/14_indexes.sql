-- Migration 14: Performance indexes on store_id and created_at for high-frequency tables
-- Idempotent: semua pakai IF NOT EXISTS

CREATE INDEX IF NOT EXISTS idx_transactions_store_id   ON transactions(store_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items(transaction_id);

CREATE INDEX IF NOT EXISTS idx_products_store_id   ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cashiers_store_id   ON cashiers(store_id);
CREATE INDEX IF NOT EXISTS idx_cashiers_created_at ON cashiers(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_store_id   ON purchases(store_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id);

CREATE INDEX IF NOT EXISTS idx_debts_store_id   ON debts(store_id);
CREATE INDEX IF NOT EXISTS idx_debts_created_at ON debts(created_at DESC);
