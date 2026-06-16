import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate the JWT via anon-key client
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

    // Use service-role key to bypass RLS and read true subscription data
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: stores, error: storesErr } = await supabaseAdmin
      .from('stores')
      .select('id, is_main, created_at, trial_ends_at, premium_until, business_until')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true });

    if (storesErr) {
      return new Response(
        JSON.stringify({ error: 'Failed to query stores' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const storeList = stores ?? [];
    // Primary store: is_main = true, or the earliest created store
    const primary = storeList.find((s) => s.is_main) ?? storeList[0] ?? null;

    const now = Date.now();

    // Compute expiry timestamps from relevant date columns
    const expiryMs = (cols: string[]): number | null => {
      if (!primary) return null;
      const candidates = cols
        .map((c) => (primary as Record<string, unknown>)[c])
        .filter(Boolean)
        .map((d) => new Date(d as string).getTime());
      // Columns missing (schema not migrated yet) → treat trial as 30 days from created_at
      if (!candidates.length) {
        if (!primary.created_at) return null;
        candidates.push(new Date(primary.created_at).getTime() + 30 * 24 * 3600 * 1000);
      }
      return Math.max(...candidates);
    };

    const daysLeft = (cols: string[]): number | null => {
      const expiry = expiryMs(cols);
      if (expiry === null) return null;
      return Math.ceil((expiry - now) / (24 * 3600 * 1000));
    };

    // Premium active: trial_ends_at OR premium_until OR business_until (business includes premium)
    const premiumDays = daysLeft(['trial_ends_at', 'premium_until', 'business_until']);
    // Business active: trial_ends_at OR business_until
    const businessDays = daysLeft(['trial_ends_at', 'business_until']);

    // null means no data yet → treat as active (matches client-side behaviour)
    const premiumActive = premiumDays === null ? true : premiumDays > 0;
    const businessActive = businessDays === null ? true : businessDays > 0;

    return new Response(
      JSON.stringify({
        premiumActive,
        businessActive,
        daysLeft: { premium: premiumDays, business: businessDays },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: 'Terjadi kesalahan pada server' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
