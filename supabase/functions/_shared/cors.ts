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

// Hanya deployment Vercel proyek ini (production + preview), wajib https
const VERCEL_PREVIEW_HOST = /^kasir-umkm-simpel(-[a-z0-9-]+)?\.vercel\.app$/;

const isVercelPreviewOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && VERCEL_PREVIEW_HOST.test(url.hostname);
  } catch (_) {
    return false;
  }
};

export interface CorsOptions {
  allowVercelPreview?: boolean;
}

export function corsHeadersFor(req: Request, options: CorsOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  if (wildcard) {
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }

  const requestOrigin = req.headers.get('origin');
  if (!requestOrigin) return headers;

  const normalized = normalizeOrigin(requestOrigin);
  const matched = allowlist.some((o) => normalizeOrigin(o) === normalized) ||
    (options.allowVercelPreview === true && isVercelPreviewOrigin(requestOrigin));

  // Reflect bentuk yang benar-benar dicocokkan supaya ACAO selalu sama persis dengan
  // origin browser meski entry allowlist ditulis dengan trailing slash / huruf besar
  if (matched) headers['Access-Control-Allow-Origin'] = requestOrigin === normalized ? requestOrigin : normalized;
  return headers;
}

export function isOriginAllowed(req: Request, options: CorsOptions = {}): boolean {
  if (wildcard) return true;
  const requestOrigin = req.headers.get('origin');
  if (!requestOrigin) return true;
  const normalized = normalizeOrigin(requestOrigin);
  return allowlist.some((o) => normalizeOrigin(o) === normalized) ||
    (options.allowVercelPreview === true && isVercelPreviewOrigin(requestOrigin));
}
