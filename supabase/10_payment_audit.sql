-- Migration: Payment Confirmation Audit Trail
-- Adds nullable confirmed_by and confirmed_at columns to transactions table.
-- Idempotent: safe to run multiple times.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
