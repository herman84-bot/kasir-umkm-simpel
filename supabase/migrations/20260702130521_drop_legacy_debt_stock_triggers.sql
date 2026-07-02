-- Drop legacy triggers that cast product_id to UUID (product_id is now bigint)
-- These are obsolete since create_debt_transaction RPC already handles stock mutations.
DROP TRIGGER IF EXISTS trigger_reduce_stock_on_debt ON public.debts;
DROP TRIGGER IF EXISTS trigger_restore_stock_on_debt_delete ON public.debts;

-- Drop their corresponding functions
DROP FUNCTION IF EXISTS public.reduce_stock_on_debt() CASCADE;
DROP FUNCTION IF EXISTS public.restore_stock_on_debt_delete() CASCADE;
DROP FUNCTION IF EXISTS public.restore_stock_on_debt() CASCADE;
