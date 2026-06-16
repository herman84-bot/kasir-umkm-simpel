# CLAUDE.md — Kasir UMKM Simpel

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
