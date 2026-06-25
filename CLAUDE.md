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

## Security Notes

- `config.js` berisi API key — JANGAN commit ke git (sudah di `.gitignore`)
- Groq AI key belum dipakai di app — fitur AI belum diimplementasi
- Semua fitur baru yang melibatkan external API key wajib menggunakan Supabase Edge Function (bukan client-side)
