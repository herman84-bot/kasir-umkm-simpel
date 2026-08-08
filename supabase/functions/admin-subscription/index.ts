import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Penanda versi yang ter-deploy — dikirim sebagai header `x-ef-version` di
// SEMUA respons (termasuk 401/403). Dipakai verifikasi remote: kalau header
// ini muncul, berarti yang live sudah versi terbaru (tanpa guard "toko
// terakhir") dan bukan copy lama yang masih terpasang di sebagian deploy.
const EF_VERSION = 'v2';

// Inlined CORS helper — shared file not reliably bundled by deploy API.
// Fungsi sensitif: preview *.vercel.app TIDAK diizinkan, hanya domain produksi.
// Domain produksi aplikasi ini — SELALU diizinkan tanpa bergantung env var, supaya
// fitur tidak patah kalau secret ALLOWED_ORIGIN lupa diset atau salah isi.
const DEFAULT_ORIGINS = [
  'https://www.simpelkasir.my.id',
  'https://simpelkasir.my.id',
  'https://kasir-umkm-simpel.vercel.app',
];

// ALLOWED_ORIGIN berisi daftar origin dipisah koma yang MENAMBAH default di atas.
const envList = (Deno.env.get('ALLOWED_ORIGIN') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const wildcard = envList.includes('*');
const allowlist = [...DEFAULT_ORIGINS, ...envList.filter((o) => o !== '*')];

const normalizeOrigin = (origin: string): string =>
  origin.trim().toLowerCase().replace(/\/+$/, '');

const isOriginAllowed = (req: Request): boolean => {
  if (wildcard) return true;
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
    'x-ef-version': EF_VERSION,
  };
  if (wildcard) {
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

    // T7: verifikasi admin via user_id = auth.uid() — konsisten dengan RPC di
    // database (migration 12/17). Sebelumnya pakai email dari JWT; sekarang
    // identity diambil dari sesi yang sudah divalidasi auth.getUser() di atas.
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from('admin_users')
      .select('id, email')
      .eq('user_id', user.id)
      .maybeSingle();

    if (adminErr || !adminRow) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Email untuk audit log diambil dari baris admin_users di DB (bukan JWT),
    // supaya log aksi tidak bisa dipalsukan lewat klaim JWT.
    const callerEmail = adminRow.email || user.email || '';

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

      // Aktivitas transaksi per toko (tanpa transaksi yang dibatalkan/void).
      // Konsisten dengan RPC list_all_stores_for_admin (migration 17):
      // status != 'void' DAN status NULL ikut dihitung (IS DISTINCT FROM 'void').
      let activityMap: Record<string, { total: number; last_at: string | null }> = {};
      const { data: txs, error: txsErr } = await supabaseAdmin
        .from('transactions')
        .select('store_id, created_at')
        .or('status.is.null,status.neq.void')
        .limit(100000);
      if (txsErr) {
        console.error('list_stores: gagal memuat aktivitas transaksi:', txsErr.message);
      } else {
        activityMap = {};
        for (const t of (txs ?? [])) {
          const sid = (t as Record<string, unknown>).store_id as string;
          if (!sid) continue;
          const entry = activityMap[sid] ?? (activityMap[sid] = { total: 0, last_at: null });
          entry.total += 1;
          const createdAt = (t as Record<string, unknown>).created_at as string | null;
          if (createdAt && (!entry.last_at || createdAt > entry.last_at)) entry.last_at = createdAt;
        }
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
        const activity = activityMap[s.id as string] ?? { total: 0, last_at: null };
        return {
          ...s,
          owner_email: emailMap[s.owner_id as string] ?? null,
          subscription_status: status,
          total_transactions: activity.total,
          last_transaction_at: activity.last_at,
        };
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

      // T5: verifikasi store benar-benar ada — sebelumnya update 0 baris tetap
      // membalas success (silent success). Sekarang toko tidak ada → 404.
      const { data: storeRow, error: storeFetchErr } = await supabaseAdmin
        .from('stores').select('id, premium_until, business_until').eq('id', storeId).maybeSingle();
      if (storeFetchErr) {
        console.error('activate store fetch error:', storeFetchErr);
        return new Response(
          JSON.stringify({ error: 'Gagal mengambil data toko' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (!storeRow) {
        return new Response(
          JSON.stringify({ error: 'Toko tidak ditemukan' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

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

      // T5: verifikasi store benar-benar ada (lihat komentar di action activate).
      const { data: storeRow, error: storeFetchErr } = await supabaseAdmin
        .from('stores').select('id, premium_until, business_until').eq('id', storeId).maybeSingle();
      if (storeFetchErr) {
        console.error('revoke store fetch error:', storeFetchErr);
        return new Response(
          JSON.stringify({ error: 'Gagal mengambil data toko' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (!storeRow) {
        return new Response(
          JSON.stringify({ error: 'Toko tidak ditemukan' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

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

    if (action === 'delete_store') {
      const storeId: string = body.store_id ?? '';
      if (!storeId) {
        return new Response(
          JSON.stringify({ error: 'store_id wajib diisi' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: storeRow, error: storeErr } = await supabaseAdmin
        .from('stores')
        .select('id, name, owner_id')
        .eq('id', storeId)
        .maybeSingle();
      if (storeErr) {
        console.error('delete_store fetch error:', storeErr);
        return new Response(
          JSON.stringify({ error: 'Gagal mengambil data toko' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      if (!storeRow) {
        return new Response(
          JSON.stringify({ error: 'Toko tidak ditemukan' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Keamanan: admin tidak boleh menghapus toko milik akun sendiri
      if (storeRow.owner_id === user.id) {
        return new Response(
          JSON.stringify({ error: 'Tidak bisa menghapus toko milik akun Anda sendiri' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Audit log SEBELUM hapus — dengan FK ON DELETE SET NULL (migration 17),
      // baris ini tetap tersimpan walau toko ikut terhapus.
      try {
        const { error: logErr } = await supabaseAdmin.from('admin_action_logs').insert({
          admin_email: callerEmail, target_store_id: storeId, action: 'delete_store',
          old_value: { name: storeRow.name, owner_id: storeRow.owner_id },
          new_value: null,
        });
        if (logErr) console.error('admin_action_logs insert error:', logErr);
      } catch (logEx) {
        console.error('admin_action_logs insert exception:', logEx);
      }

      // Hapus toko dengan aman terhadap MULTI-CABANG (migration 06: 1 pemilik
      // boleh punya banyak toko). deleteUser() menghapus akun pemilik → FK
      // stores.owner_id ON DELETE CASCADE menghapus SEMUA toko/cabang miliknya —
      // lebih luas dari yang diminta. Aturan:
      //   - Pemilik masih punya toko lain → hapus HANYA baris toko ini
      //     (data anak ikut terhapus via FK ON DELETE CASCADE dari stores).
      //   - Ini toko terakhir milik pemilik → hapus akun pemilik
      //     (cascade menghapus toko + SEMUA datanya).
      let deleteErrMsg: string | null = null;
      let deleteStoreOnly = !storeRow.owner_id; // tanpa owner → hapus baris saja
      if (storeRow.owner_id) {
        const { data: otherStores, error: otherErr } = await supabaseAdmin
          .from('stores')
          .select('id')
          .eq('owner_id', storeRow.owner_id)
          .neq('id', storeId)
          .limit(1);
        if (otherErr) {
          deleteErrMsg = otherErr.message;
        } else {
          deleteStoreOnly = (otherStores ?? []).length > 0;
        }
      }

      if (deleteStoreOnly) {
        const { error: storeDelErr } = await supabaseAdmin
          .from('stores').delete().eq('id', storeId);
        if (storeDelErr) deleteErrMsg = storeDelErr.message;
      } else if (storeRow.owner_id) {
        const { error: userDelErr } = await supabaseAdmin.auth.admin.deleteUser(storeRow.owner_id);
        if (userDelErr) {
          // User mungkin sudah terhapus sebelumnya → hapus baris toko langsung
          const { error: storeDelErr } = await supabaseAdmin
            .from('stores').delete().eq('id', storeId);
          if (storeDelErr) deleteErrMsg = storeDelErr.message;
        }
      }

      if (deleteErrMsg) {
        console.error('delete_store delete error:', deleteErrMsg);
        return new Response(
          JSON.stringify({ error: 'Gagal menghapus toko: ' + deleteErrMsg }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
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
