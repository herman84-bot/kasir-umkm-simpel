# vendor/

## gsap.min.js

Animasi lampu tarik di halaman login memakai GSAP yang dimuat dari same-origin (bukan CDN).

Cara menyiapkan:

1. Unduh https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js
2. Simpan sebagai `vendor/gsap.min.js`
3. Salin juga ke `public/vendor/gsap.min.js` (dua salinan wajib byte-identik)

Tanpa file ini aplikasi tetap berjalan normal — hanya animasi lampu yang dilewati dan halaman login langsung tampil terang.
