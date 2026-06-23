// Origin allowlist via env. Set ALLOWED_ORIGIN to the app origin in production.
// Falls back to '*' if unset so a fresh deploy doesn't break.
const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

export const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
