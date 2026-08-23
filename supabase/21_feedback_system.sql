-- =====================================================================
-- FEEDBACK SYSTEM: Bug Reports + Feature Requests via Edge Function
-- Jalankan di Supabase → SQL Editor → RUN
-- =====================================================================

-- 1) Tabel feedback
CREATE TABLE IF NOT EXISTS public.feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  user_email TEXT,
  store_name TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2) Index untuk query cepat
CREATE INDEX IF NOT EXISTS idx_feedback_created ON public.feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON public.feedback(type);

-- 3) RLS: user hanya bisa INSERT sendiri, admin bisa SELECT semua
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Insert: authenticated users can insert their own feedback
CREATE POLICY "feedback_insert_auth" ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Select: only super admin can read all feedback
CREATE POLICY "feedback_select_admin" ON public.feedback
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE user_id = auth.uid()
    )
  );

-- 4) Grants
GRANT INSERT ON public.feedback TO authenticated;
GRANT SELECT ON public.feedback TO authenticated;
