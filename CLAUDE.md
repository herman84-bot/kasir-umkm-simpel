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

## Tanggung Jawab AI — Pilar Utama (WAJIB untuk SETIAP perubahan)

AI HARUS aktif berpikir, bertanya, dan memverifikasi. Jangan anggap "kode jalan" = "sudah benar". Setiap commit harus lulus 4 pilar ini:

### 1. Keamanan & Integritas Data

Setiap perubahan harus aman dari sudut pandang:

- **Isolasi data antar user** — localStorage, state in-memory, cache TIDAK boleh bocor antar akun/sesi. Saat logout/switch akun, bersihkan semua state sensitif.
- **Server-side validation** — aksi destruktif (hapus, update, transfer) wajib verifikasi di Edge Function, bukan hanya client-side.
- **RLS Supabase** — setiap tabel baru wajib punya Row Level Security. Jangan bypass RLS tanpa alasan yang didokumentasikan.
- **API key & secret** — hanya via environment variable / Edge Function. Tidak pernah hardcode, tidak pernah log, tidak pernah visible di client.
- **Data sensitif** — jangan simpan email/password/token di localStorage. Jangan expose di URL bar atau console log.

**Tanyakan saat coding:** "Bagaimana user lain bisa akses data ini? Bagaimana attacker bisa bypass ini? Apa yang bisa bocor?"

### 2. Desain & UX yang Humanis

Setiap UI harus mudah dipahami dan nyaman digunakan oleh pemilik UMKM non-teknis:

- **Bahasa natural** — label, pesan, error, dan guidance menggunakan Bahasa Indonesia yang sederhana. Jangan jargon teknis.
- **Tidak overwhelming** — hindari warna merah berlebihan, warning text yang menakutkan, atau visual yang alarming. Informasikan konsekuensi dengan tenang dan jelas.
- **Visual hierarchy jelas** — aksi utama menonjol, aksi destruktif terlihat berbeda (outline/ghost button, bukan solid). Tidak ada kebingungan "mana yang harus diklik?"
- **Konsisten** — ikuti pola desain existing (rounded-3xl, shadow-sm, warna slate/white, Tailwind). Tidak boleh ada satu card yang terlihat "seperti dari app lain".
- **Mobile-first** — UI harus nyaman di layar 375px (iPhone SE). Touch target ≥ 44px, teks readable tanpa zoom, tidak ada horizontal scroll.
- **Aksi irreversible** — selalu konfirmasi eksplisit + verifikasi input (modal + email/PIN, bukan hanya OK button). User tidak boleh bisa hapus data karena salah klik.
- **Loading & error states** — tampilkan status (loading, error, success) dengan jelas. Jangan biarkan user bingung "apa yang terjadi?"

**Tanyakan saat design:** "Apakah tukang sayur yang baru pakai smartphone bisa langsung ngerti ini tanpa manual?"

### 3. Kualitas & Testability

Setiap perubahan harus robust dan mudah diverifikasi:

- **Happy path & edge cases** — jangan cuma test senang-senang. Test offline, network error, concurrent request, invalid input, rate limit, timeout.
- **State consistency** — setelah operasi, semua state in-memory, localStorage, Supabase harus sinkron. Jangan ada ghost data atau missing data.
- **Database integrity** — migration harus idempotent (bisa dijalankan 2x tanpa error). Foreign key harus proper (CASCADE atau SET NULL, sesuai semantik). Backfill data harus aman di production.
- **No silent failures** — jangan catch error terus silent. Log apa yang salah, user perlu tahu, admin perlu bisa debug.
- **Regression check** — perubahan baru tidak boleh break fitur lama. Test fitur existing yang adjacent untuk pastikan cross-impact.

**Tanyakan saat implement:** "Apa yang bisa salah? Bagaimana kalau network timeout di tengah proses? Apakah state masih konsisten?"

### 4. Dokumentasi & Maintainability

Setiap perubahan harus bisa dipahami 6 bulan kemudian:

- **Commit message jelas** — bukan "fix bug" atau "update". Jelaskan WHAT dan WHY: "fix: logout tidak bersihkan state.cashiers — data akun lama bocor saat login akun baru".
- **Kode self-documenting** — nama variable/function jelas (bukan `x`, `fn`, `data`). Jangan komentar "lagi saya apa" tapi "kenapa kami pilih cara ini".
- **Perubahan besar → di-document** — jika ada breaking change atau perubahan alur, catat di CLAUDE.md atau issue agar team tahu.
- **Link context** — jika fix referensi issue/bug screenshot, include link atau nomor di commit message.

**Tanyakan saat selesai:** "Apakah developer 6 bulan kemudian bisa pahami ini hanya baca commit message + kode?"

## Security Notes

- `config.js` berisi API key — JANGAN commit ke git (sudah di `.gitignore`)
- Groq AI key belum dipakai di app — fitur AI belum diimplementasi
- Semua fitur baru yang melibatkan external API key wajib menggunakan Supabase Edge Function (bukan client-side)
