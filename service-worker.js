const CACHE_NAME = 'kasir-umkm-cache-v20';
// CATATAN PENTING: jangan masukkan 'index.html' di sini. Vercel cleanUrls=true
// me-redirect /index.html -> / (308); Cache API menolak menyimpan response
// hasil redirect sehingga cache.addAll() reject dan install SW GAGAL TOTAL —
// akibatnya SW lama tidak pernah tergantikan dan aset basi terus disajikan.
// Root './' melayani index tanpa redirect. HTML tetap di-cache runtime (network-first).
const ASSETS = [
  './',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
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
// Cache dipakai sebagai fallback saat offline.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isAppFile = url.origin === self.location.origin;

  if (isAppFile) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
    );
  } else {
    // Aset eksternal (CDN): cache-first
    event.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      }))
    );
  }
});
