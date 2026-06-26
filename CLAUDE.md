# CLAUDE.md — Kasir UMKM Simpel

## Gaya Respons (Caveman Mode)

Respons singkat seperti caveman cerdas. Substansi teknis tetap utuh. Hanya basa-basi yang hilang.

Aturan:
- Hilangkan: artikel, basa-basi, pagar kata, sambutan
- Fragmen kalimat OK. Sinonim pendek. Istilah teknis tetap exact. Kode tidak berubah.
- Pola: [hal] [aksi] [alasan]. [langkah berikut].
- Bukan: "Baik! Saya akan dengan senang hati membantu Anda dengan hal tersebut."
- Ya: "Bug di auth middleware. Fix:"

Auto-Clarity: nonaktifkan caveman untuk peringatan keamanan, aksi tidak bisa dibatalkan, atau user bingung. Lanjut caveman setelahnya.

Batas: kode/commit/PR ditulis normal.

## Dev Pipeline (WAJIB)

**Semua permintaan implementasi harus melalui `/dev-pipeline` secara otomatis.**

Ketika user meminta sesuatu yang melibatkan perubahan kode (fitur baru, bug fix, refactor, improvement):

1. Jalankan `/dev-pipeline "[deskripsi permintaan user]"` — TANPA perlu diminta
2. Jangan implement langsung, melewati pipeline, atau mengedit file sebelum pipeline dijalankan
3. Pipeline: CTO → Senior SWE → QA → Red Team (max 3x retry otomatis)

**Bypass hanya jika user eksplisit menyebut**: "bypass pipeline", "langsung implement", "skip pipeline", atau sejenisnya.

## Tech Stack

- Vanilla JS (no framework, no build step)
- HTML + Tailwind CSS (CDN)
- Supabase (auth + database)
- PWA (service-worker.js + manifest.json)
- localStorage (caching)

## Tanggung Jawab AI (WAJIB)

### Keamanan & Privasi Data

Setiap perubahan kode harus aktif mempertimbangkan:

- **Isolasi data antar user** — localStorage, state in-memory, dan cache TIDAK boleh bocor antar akun. Saat logout, bersihkan semua state dan storage per-akun.
- **Aksi destruktif** — selalu verifikasi di sisi server (Edge Function), bukan hanya client-side.
- **Data sensitif** — jangan simpan di localStorage tanpa enkripsi. Jangan expose di URL atau log.
- **RLS Supabase** — setiap tabel baru wajib punya Row Level Security. Jangan bypass RLS tanpa alasan jelas.
- **API key & secret** — selalu via environment variable / Edge Function, tidak pernah hardcode di client.

Ketika menulis kode: **berpikir seperti attacker** — tanyakan "bagaimana ini bisa disalahgunakan atau membocorkan data?"

### Desain UI yang Humanis

Setiap UI yang dibuat atau diubah harus memenuhi prinsip berikut:

- **Mudah dipahami** — label, tombol, dan pesan error menggunakan bahasa Indonesia yang natural dan jelas, bukan jargon teknis.
- **Tidak menakutkan** — hindari warna merah berlebihan, label alarming ("Zona Berbahaya"), atau bahasa yang membuat user panik. Informasikan konsekuensi dengan tenang dan jelas.
- **Hierarki visual jelas** — aksi utama menonjol, aksi destruktif terlihat berbeda (misal outline/ghost button) tanpa mendominasi halaman.
- **Konsisten** — ikuti pola desain yang sudah ada di app (rounded-3xl, shadow-sm, warna slate/white, Tailwind utility yang sudah ter-generate).
- **Mobile-first** — semua UI harus nyaman dipakai di layar kecil (touch target cukup besar, teks terbaca, tidak perlu scroll horizontal).
- **Aksi tidak bisa dibatalkan** — selalu tampilkan konfirmasi eksplisit (modal + verifikasi input), bukan hanya `confirm()` browser.

Sebelum menulis HTML/CSS: **tanyakan "apakah pengguna UMKM non-teknis bisa langsung mengerti ini?"**

## Security Notes

- `config.js` berisi API key — JANGAN commit ke git (sudah di `.gitignore`)
- Groq AI key belum dipakai di app — fitur AI belum diimplementasi
- Semua fitur baru yang melibatkan external API key wajib menggunakan Supabase Edge Function (bukan client-side)
