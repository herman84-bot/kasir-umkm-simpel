import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeadersFor } from '../_shared/cors.ts';

const systemPrompt =
  'Kamu adalah Aisyah, asisten virtual aplikasi Kasir UMKM Simpel. ' +
  'Selalu jawab dalam Bahasa Indonesia yang ramah dan gunakan sapaan islami ringan secara konsisten ' +
  '(misalnya "Assalamualaikum" / "Insya Allah" / "Baarakallahu fiik") secukupnya, jangan berlebihan. ' +
  'Jelaskan HANYA fitur yang NYATA ada di aplikasi ini, jangan pernah mengarang fitur yang tidak ada:\n' +
  '- Tambah produk & kelola inventori (harga modal, harga jual, stok, stok minimum, kategori, barcode).\n' +
  '- Kasir & transaksi: keranjang, diskon (nominal Rp atau persen), metode bayar Tunai/QRIS/Transfer, hitung kembalian otomatis.\n' +
  '- Struk otomatis setelah bayar, cetak via printer thermal 58mm/80mm menggunakan aplikasi RawBT, atau cetak biasa.\n' +
  '- QRIS: upload gambar QRIS toko. QRIS Dinamis (fitur Premium) menanamkan nominal belanja otomatis ke QR.\n' +
  '- Langganan: fitur dasar gratis. Premium Rp25.000/bulan dan Bisnis Rp50.000/bulan (multi-cabang & Dashboard Pusat).\n' +
  '- Kasbon (catatan utang pelanggan).\n' +
  '- Laporan: export PDF dan grafik penjualan.\n' +
  '- Scan barcode lewat kamera HP maupun scanner fisik HID (Bluetooth/USB mode keyboard).\n' +
  '- Shift / tutup kasir dengan ringkasan penjualan per shift.\n' +
  '- Kelola kasir/operator beserta PIN dan role.\n' +
  '- Multi-device: data tersinkron di cloud, bisa dibuka dari beberapa perangkat dengan akun yang sama.\n' +
  'Jika pengguna butuh bantuan lebih lanjut atau ingin konfirmasi langganan, arahkan ke email noreply.absenta@gmail.com. ' +
  'Jawab dengan ringkas, jelas, dan langsung ke inti.';

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req, { allowVercelPreview: true });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Require an authenticated Supabase user — blocks anon/random callers from burning Groq quota.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Rate limiting: 10 requests per 60-second window per user.
    // INSERT first then COUNT so concurrent requests at the boundary both see the full count,
    // avoiding the naive select-before-insert race window.
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { error: insertError } = await serviceClient.from('chat_rate_log').insert({ user_id: user.id });
    if (insertError) {
      return new Response(
        JSON.stringify({ error: 'Terjadi kesalahan pada server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const windowStart = new Date(Date.now() - 60_000).toISOString();
    const { count, error: countError } = await serviceClient
      .from('chat_rate_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('requested_at', windowStart);

    if (countError) {
      return new Response(
        JSON.stringify({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if ((count ?? 0) > 10) {
      return new Response(
        JSON.stringify({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Terjadi kesalahan pada server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { messages } = await req.json();

    const sanitized = (Array.isArray(messages) ? messages : [])
      .filter(
        (m) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string',
      )
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      .slice(-6);

    const groqMessages = [{ role: 'system', content: systemPrompt }, ...sanitized];

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        max_tokens: 800,
        temperature: 0.6,
      }),
    });

    if (!groqRes.ok) {
      console.error('Groq non-2xx:', groqRes.status, await groqRes.text());
      return new Response(
        JSON.stringify({ error: 'Terjadi kesalahan pada server' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content ?? '';

    return new Response(
      JSON.stringify({ reply }),
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
