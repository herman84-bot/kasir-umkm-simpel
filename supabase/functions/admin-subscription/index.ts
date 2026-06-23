import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Finding 4: Explicit origin guard — reject requests from unlisted origins
  const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN');
  if (allowedOrigin) {
    const requestOrigin = req.headers.get('origin');
    if (requestOrigin && requestOrigin !== allowedOrigin) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate JWT and extract the authenticated user via anon-key client
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

    // Use service-role key to bypass RLS for all subsequent operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Verify caller is a registered super admin
    const callerEmail = user.email ?? '';
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('email', callerEmail)
      .maybeSingle();

    if (adminErr || !adminRow) {
      // Authenticated but not authorised — 403 per AC7
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? '';

    // ── GET /list-stores ──────────────────────────────────────────────────────
    if (action === 'list_stores') {
      const { data: stores, error: storesErr } = await supabaseAdmin
        .from('stores')
        .select(`
          id,
          name,
          owner_id,
          trial_ends_at,
          premium_until,
          business_until,
          created_at
        `)
        .order('created_at', { ascending: false });

      if (storesErr) {
        return new Response(
          JSON.stringify({ error: 'Failed to list stores' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Finding 1: Fetch only the specific owner users instead of the full auth.users list
      const ownerIds: string[] = [...new Set((stores ?? []).map((s: Record<string, unknown>) => s.owner_id as string))];
      const emailMap: Record<string, string> = {};
      if (ownerIds.length) {
        await Promise.all(
          ownerIds.map(async (ownerId) => {
            const { data: userData } = await supabaseAdmin.auth.admin.getUserById(ownerId);
            if (userData?.user?.email) {
              emailMap[ownerId] = userData.user.email;
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
        if (bizMs && bizMs > now)            status = 'Bisnis';
        else if (premMs && premMs > now)     status = 'Premium';
        else if (trialMs && trialMs > now)   status = 'Trial';

        return {
          ...s,
          owner_email: emailMap[s.owner_id as string] ?? null,
          subscription_status: status,
        };
      });

      return new Response(
        JSON.stringify({ stores: enriched }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── POST /activate ────────────────────────────────────────────────────────
    if (action === 'activate') {
      const storeId: string = body.store_id ?? '';
      const pkg: string     = body.package  ?? '';   // 'premium' | 'business'
      let until: string     = body.until    ?? '';   // ISO date string

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

      // Finding 2: Validate the until timestamp before writing to the database
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
      // Re-serialize to a canonical ISO string to prevent injection of exotic formats
      until = parsedUntil.toISOString();

      // Fetch old values for logging
      const { data: storeRow } = await supabaseAdmin
        .from('stores')
        .select('premium_until, business_until')
        .eq('id', storeId)
        .single();

      const column = pkg === 'premium' ? 'premium_until' : 'business_until';
      const { error: updateErr } = await supabaseAdmin
        .from('stores')
        .update({ [column]: until })
        .eq('id', storeId);

      if (updateErr) {
        // Finding 6: Log internal error detail server-side; return generic message to caller
        console.error('activate update error:', updateErr);
        return new Response(
          JSON.stringify({ error: 'Gagal memperbarui langganan' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Log the action — callerEmail is taken from the verified JWT, not caller-supplied
      await supabaseAdmin.from('admin_action_logs').insert({
        admin_email:     callerEmail,
        target_store_id: storeId,
        action:          `activate_${pkg}`,
        old_value:       { [column]: storeRow?.[column as keyof typeof storeRow] ?? null },
        new_value:       { [column]: until },
      });

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── POST /revoke ──────────────────────────────────────────────────────────
    if (action === 'revoke') {
      const storeId: string = body.store_id ?? '';
      if (!storeId) {
        return new Response(
          JSON.stringify({ error: 'store_id wajib diisi' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: storeRow } = await supabaseAdmin
        .from('stores')
        .select('premium_until, business_until')
        .eq('id', storeId)
        .single();

      const { error: updateErr } = await supabaseAdmin
        .from('stores')
        .update({ premium_until: null, business_until: null })
        .eq('id', storeId);

      if (updateErr) {
        // Finding 6: Log internal error detail server-side; return generic message to caller
        console.error('revoke update error:', updateErr);
        return new Response(
          JSON.stringify({ error: 'Gagal merevokasi langganan' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      await supabaseAdmin.from('admin_action_logs').insert({
        admin_email:     callerEmail,
        target_store_id: storeId,
        action:          'revoke',
        old_value:       {
          premium_until:  storeRow?.premium_until  ?? null,
          business_until: storeRow?.business_until ?? null,
        },
        new_value: { premium_until: null, business_until: null },
      });

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
