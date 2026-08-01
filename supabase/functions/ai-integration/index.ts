import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeadersFor } from '../_shared/cors.ts';

// Reuse same system prompt as Aisyah for now (can be customized later)
const systemPrompt =
  'Kamu adalah asisten AI untuk aplikasi Kasir UMKM Simpel. Jawab dalam Bahasa Indonesia yang ramah dan singkat.';

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate user
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

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GROQ_API_KEY belum diset' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { messages } = await req.json();
    const sanitized = (Array.isArray(messages) ? messages : [])
      .filter(
        (m) =>
          m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
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
