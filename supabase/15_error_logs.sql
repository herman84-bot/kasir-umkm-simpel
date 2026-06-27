-- Migration 15: Error Logs table for observability
-- Idempotent: safe to run multiple times

-- 1) Table -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.error_logs (
  id           BIGSERIAL PRIMARY KEY,
  store_id     UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  user_email   TEXT,
  app_version  VARCHAR(20),
  message      TEXT NOT NULL CHECK (char_length(message) <= 1000),
  stack        TEXT,
  url          TEXT,
  context      JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2) RLS -------------------------------------------------------------------
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_error_logs" ON public.error_logs;
CREATE POLICY "tenant_error_logs" ON public.error_logs
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (store_id IN (SELECT public.my_store_ids()) OR store_id IS NULL)
    AND (
      SELECT COUNT(*) FROM public.error_logs el2
      WHERE el2.user_email = (auth.jwt() ->> 'email')
      AND el2.created_at > NOW() - INTERVAL '5 minutes'
    ) <= 50
  );

-- 3) Trigger — overwrite client-supplied user_email with server JWT email ---
CREATE OR REPLACE FUNCTION public.set_error_log_user_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.user_email := (SELECT email FROM auth.users WHERE id = auth.uid());
  RETURN NEW;
END; $$;

CREATE OR REPLACE TRIGGER error_logs_set_email
  BEFORE INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_error_log_user_email();

-- 4) Index -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS error_logs_store_created_idx
  ON public.error_logs (store_id, created_at DESC);

-- 5) Admin RPC -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_error_logs_for_admin()
RETURNS TABLE (
  id          BIGINT,
  store_id    UUID,
  store_name  TEXT,
  user_email  TEXT,
  app_version VARCHAR(20),
  message     TEXT,
  stack       TEXT,
  url         TEXT,
  context     JSONB,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
    SELECT
      el.id,
      el.store_id,
      s.name::TEXT AS store_name,
      el.user_email,
      el.app_version,
      el.message,
      el.stack,
      el.url,
      el.context,
      el.created_at
    FROM public.error_logs el
    LEFT JOIN public.stores s ON s.id = el.store_id
    ORDER BY el.created_at DESC
    LIMIT 100;
END;
$$;
