const CACHE_NAME = 'kasir-umkm-cache-v42';
// CATATAN PENTING: jangan masukkan 'index.html' di sini. Vercel cleanUrls=true
// me-redirect /index.html -> / (308); Cache API menolak menyimpan response
// hasil redirect sehingga cache.addAll() reject dan install SW GAGAL TOTAL —
// akibatnya SW lama tidak pernah tergantikan dan aset basi terus disajikan.
// Root './' melayani index tanpa redirect. HTML tetap di-cache runtime (network-first).
// CDN di bawah memakai Promise.allSettled sehingga redirect/404 tidak membatalkan install.
// app.js?v=N harus cocok dengan <script src> di index agar precache = runtime URL.
const ASSETS = [
  './',
  'app.js?v=19',
  'vendor/gsap.min.js',
  'customer-display.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.2',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  // allSettled + cache:'reload': install TIDAK boleh gagal hanya karena satu aset
  // redirect/404. Ini memastikan SW baru selalu berhasil terpasang & aktif,
  // memutus kebuntuan SW lama yang tidak pernah ter-update.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        ASSETS.map(url => cache.add(new Request(url, { cache: 'reload' })))
      )
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// Network-first untuk file aplikasi (HTML/JS) agar update langsung terpakai.
// Cache dipakai sebagai fallback saat offline. Hanya cache response OK (hindari 404/5xx).
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isAppFile = url.origin === self.location.origin;

  if (isAppFile) {
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./')))
    );
  } else {
    // Aset eksternal (CDN): cache-first
    event.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }))
    );
  }
});
