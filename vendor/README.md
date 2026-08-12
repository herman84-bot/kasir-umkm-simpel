# vendor/

## gsap.min.js

Animasi lampu tarik di halaman login memakai GSAP yang dimuat dari same-origin (bukan CDN).

Cara menyiapkan:

1. Unduh https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js
2. Simpan sebagai `vendor/gsap.min.js`
3. Salin juga ke `public/vendor/gsap.min.js` (dua salinan wajib byte-identik)

Tanpa file ini aplikasi tetap berjalan normal — hanya animasi lampu yang dilewati dan halaman login langsung tampil terang.

## Memastikan file GSAP asli

Script ini berjalan di halaman yang sama dengan kolom password, jadi pastikan filenya benar-benar berasal dari sumber resmi:

- Unduh HANYA dari cdn.jsdelivr.net, unpkg.com, atau github.com/greensock.
- Hitung hash file yang sudah diunduh:

  openssl dgst -sha384 -binary gsap.min.js | openssl base64 -A

- Bandingkan hasilnya dengan hash SRI resmi yang ditampilkan jsDelivr di halaman paket gsap versi 3.13.0 (tombol "SRI" pada file dist/gsap.min.js). Kalau tidak cocok, JANGAN dipakai — unduh ulang.
