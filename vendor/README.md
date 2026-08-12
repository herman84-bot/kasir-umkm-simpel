# vendor/

Dependensi pihak ketiga yang disajikan dari domain sendiri (same-origin),
bukan dari CDN.

## gsap.min.js — GSAP 3.13.0

Dipakai untuk animasi lampu di halaman login (`#lampGate` di index.html).

**Kenapa di-vendor, bukan dari CDN?**
Halaman login menangani password. Script dari CDN pihak ketiga di halaman itu
adalah risiko rantai pasok: kalau CDN diretas, script jahat bisa membaca
kolom email/password. Menyajikan dari domain sendiri menghapus risiko itu,
sekaligus membuat animasi tetap jalan saat offline (PWA).

**Asal file:** paket npm resmi `gsap@3.13.0`, diambil dengan `npm pack gsap@3.13.0`.
npm memverifikasi integritas paket terhadap hash yang dipublikasikan registry.

**SHA-384 (format SRI):**
```
sha384-HOvlOYPIs/zjoIkWUGXkVmXsjr8GuZLV+Q+rcPwmJOVZVpvTSXQChiN4t9Euv9Vc
```

Verifikasi ulang kapan saja:
```bash
echo "sha384-$(openssl dgst -sha384 -binary vendor/gsap.min.js | openssl base64 -A)"
```
Hasilnya harus sama persis dengan nilai di atas.

## Cara memperbarui versi

1. `npm pack gsap@<versi>` lalu ekstrak `package/dist/gsap.min.js`
2. Salin ke `vendor/gsap.min.js` DAN `public/vendor/gsap.min.js` (wajib identik)
3. Hitung ulang hash di atas dan perbarui README ini
4. Naikkan `CACHE_NAME` di `service-worker.js` + `public/service-worker.js`

## Catatan

Aplikasi tetap berfungsi normal kalau file ini hilang atau gagal dimuat —
animasi lampu dilewati (`if (!window.gsap) return;` di app.js). Fitur hiasan
tidak boleh bisa mengunci pengguna dari aplikasi.
