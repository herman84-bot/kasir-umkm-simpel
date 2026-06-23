-- Offline Transaction Deduplication — idempotent, safe to re-run
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_transactions_store_client
  ON transactions (store_id, client_id)
  WHERE client_id IS NOT NULL;
