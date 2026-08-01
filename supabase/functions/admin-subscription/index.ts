import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Inlined CORS helper — shared file not reliably bundled by deploy API.
// Fungsi sensitif: preview *.vercel.app TIDAK diizinkan, hanya domain produksi.
const allowlist = (Deno.env.get('ALLOWED_ORIGIN') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const normalizeOrigin = (origin: string): string =>
  origin.trim().toLowerCase().replace(/\/+$/, '');

const isOriginAllowed = (req: Request): boolean => {
  if (!allowlist.length) return true;
  const requestOrigin = req.headers.get('origin');
  if (!requestOrigin) return true;
  const normalized = normalizeOrigin(requestOrigin);
  return allowlist.some((o) => normalizeOrigin(o) === normalized);
};

const corsHeadersFor = (req: Request): Record<string, string> => {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (!allowlist.length) {
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }
  const requestOrigin = req.headers.get('origin');
  if (requestOrigin && isOriginAllowed(req)) {
    // Reflect bentuk ternormalisasi bila entry allowlist ditulis dengan trailing slash / huruf besar
    const normalized = normalizeOrigin(requestOrigin);
    headers['Access-Control-Allow-Origin'] = requestOrigin === normalized ? requestOrigin : normalized;
  }
  return headers;
};

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!isOriginAllowed(req)) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const callerEmail = user.email ?? '';
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('email', callerEmail)
      .maybeSingle();

    if (adminErr || !adminRow) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? '';

    // Lightweight admin status check — verifikasi sudah terjadi di blok email di atas.
    if (action === 'check_admin') {
      return new Response(
        JSON.stringify({ is_admin: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'list_stores') {
      const { data: stores, error: storesErr } = await supabaseAdmin
        .from('stores')
        .select('id, name, owner_id, trial_ends_at, premium_until, business_until, created_at')
        .order('created_at', { ascending: false });

      if (storesErr) {
        return new Response(
          JSON.stringify({ error: 'Failed to list stores' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const ownerIds: string[] = [...new Set((stores ?? [])
        .map((s: Record<string, unknown>) => s.owner_id as string)
        .filter(Boolean)
      )];
      const emailMap: Record<string, string> = {};
      if (ownerIds.length) {
        await Promise.all(
          ownerIds.map(async (ownerId) => {
            try {
              const { data: userData } = await supabaseAdmin.auth.admin.getUserById(ownerId);
              if (userData?.user?.email) emailMap[ownerId] = userData.user.email;
            } catch (e) {
              console.error(`Gagal mengambil user ${ownerId}:`, e);
            }
          }),
        );
      }

      const now = Date.now();
      const enriched = (stores ?? []).map((s: Record<string, unknown>) => {
        const trialMs = s.trial_ends_at ? new Date(s.trial_ends_at as string).getTime() : null;
        const premMs  = s.premium_until  ? new Date(s.premium_until  as string).getTime() : null;
        const bizMs   = s.business_until ? new Date(s.business_until as string).getTime() : null;
        let status = 'Gratis';
        if (bizMs && bizMs > now)          status = 'Bisnis';
        else if (premMs && premMs > now)   status = 'Premium';
        else if (trialMs && trialMs > now) status = 'Trial';
        return { ...s, owner_email: emailMap[s.owner_id as string] ?? null, subscription_status: status };
      });

      return new Response(
        JSON.stringify({ stores: enriched }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'activate') {
      const storeId: string = body.store_id ?? '';
      const pkg: string     = body.package  ?? '';
      let until: string     = body.until    ?? '';

      if (!storeId || !pkg || !until) {
        return new Response(
          JSON.stringify({ error: 'store_id, package, dan until wajib diisi' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (pkg !== 'premium' && pkg !== 'business') {
        return new Response(
          JSON.stringify({ error: 'package harus premium atau business' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const parsedUntil = new Date(until);
      if (isNaN(parsedUntil.getTime())) {
        return new Response(
          JSON.stringify({ error: 'until harus berupa tanggal ISO 8601 yang valid' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (parsedUntil.getTime() <= Date.now()) {
        return new Response(
          JSON.stringify({ error: 'until harus tanggal di masa depan' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      until = parsedUntil.toISOString();

      const { data: storeRow } = await supabaseAdmin
        .from('stores').select('premium_until, business_until').eq('id', storeId).single();

      const column = pkg === 'premium' ? 'premium_until' : 'business_until';
      const { error: updateErr } = await supabaseAdmin
        .from('stores').update({ [column]: until }).eq('id', storeId);

      if (updateErr) {
        console.error('activate update error:', updateErr);
        return new Response(
          JSON.stringify({ error: 'Gagal memperbarui langganan' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Audit log best-effort — kegagalan log tidak boleh membatalkan operasi
      try {
        const { error: logErr } = await supabaseAdmin.from('admin_action_logs').insert({
          admin_email: callerEmail, target_store_id: storeId, action: `activate_${pkg}`,
          old_value: { [column]: storeRow?.[column as keyof typeof storeRow] ?? null },
          new_value: { [column]: until },
        });
        if (logErr) console.error('admin_action_logs insert error:', logErr);
      } catch (logEx) {
        console.error('admin_action_logs insert exception:', logEx);
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'revoke') {
      const storeId: string = body.store_id ?? '';
      if (!storeId) {
        return new Response(
          JSON.stringify({ error: 'store_id wajib diisi' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: storeRow } = await supabaseAdmin
        .from('stores').select('premium_until, business_until').eq('id', storeId).single();

      const { error: updateErr } = await supabaseAdmin
        .from('stores').update({ premium_until: null, business_until: null }).eq('id', storeId);

      if (updateErr) {
        console.error('revoke update error:', updateErr);
        return new Response(
          JSON.stringify({ error: 'Gagal merevokasi langganan' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Audit log best-effort — kegagalan log tidak boleh membatalkan operasi
      try {
        const { error: logErr } = await supabaseAdmin.from('admin_action_logs').insert({
          admin_email: callerEmail, target_store_id: storeId, action: 'revoke',
          old_value: { premium_until: storeRow?.premium_until ?? null, business_until: storeRow?.business_until ?? null },
          new_value: { premium_until: null, business_until: null },
        });
        if (logErr) console.error('admin_action_logs insert error:', logErr);
      } catch (logEx) {
        console.error('admin_action_logs insert exception:', logEx);
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'action tidak dikenal' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: 'Terjadi kesalahan pada server' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
