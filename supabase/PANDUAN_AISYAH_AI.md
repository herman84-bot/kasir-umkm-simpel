# Panduan Deploy Aisyah AI (Edge Function)

Aisyah AI adalah asisten chat bertenaga LLM (Groq) yang berjalan di Supabase Edge Function `aisyah-chat`.
Aplikasi memanggilnya lewat `db.functions.invoke('aisyah-chat', ...)`. Jika function belum di-deploy
atau internet mati, aplikasi otomatis kembali ke jawaban berbasis kata kunci (fallback), jadi chat
tetap berfungsi.

## Prasyarat

1. **Supabase CLI** terpasang — lihat https://supabase.com/docs/guides/cli
2. **Deno** terpasang (dibutuhkan Supabase CLI untuk menjalankan/men-deploy Edge Functions) — https://deno.land
3. Akun Groq + API key dari https://console.groq.com

## Langkah Deploy

```bash
# 1. Login ke Supabase
supabase login

# 2. Hubungkan ke project (project ref aplikasi ini)
supabase link --project-ref pfmsblktxlnovtajnxvc

# 3. Set API key Groq sebagai secret (PAKAI KEY BARU HASIL ROTASI, lihat catatan keamanan)
supabase secrets set GROQ_API_KEY=gsk_xxx

# 4. (Opsional, DIANJURKAN) Batasi CORS ke origin aplikasi Anda
#    Tanpa ini, CORS default ke '*' (semua origin). Set ke origin asli aplikasi:
supabase secrets set ALLOWED_ORIGIN=https://aplikasi-anda.example.com

# 5. Deploy function
supabase functions deploy aisyah-chat
```

> **Keamanan akses:** Function `aisyah-chat` kini **mewajibkan user Supabase yang sudah login**.
> Pemanggil tanpa JWT yang valid akan menerima `401 Unauthorized`, sehingga kuota Groq tidak bisa
> disalahgunakan oleh orang yang hanya memegang anon key. Aplikasi memanggil lewat
> `db.functions.invoke('aisyah-chat', ...)` yang otomatis melampirkan JWT user login, jadi user toko
> tetap berfungsi normal; jika entah bagaimana user belum login, aplikasi otomatis pakai jawaban fallback.

## Cara Test

1. Buka aplikasi di browser.
2. Klik tombol FAB Aisyah (ikon chat di pojok bawah).
3. Tanya, misalnya: **"apa itu QRIS Dinamis"**.
   - Jika function aktif → muncul jawaban dari LLM (lebih natural & kontekstual).
4. **Test fallback:** matikan internet ATAU jangan deploy function dulu, lalu tanya lagi.
   - Aplikasi harus tetap memberi jawaban dari mesin kata kunci (tidak error/diam).

## Catatan Keamanan (PENTING)

- API key Groq yang lama sempat ter-expose di `config.js` (baris 4). Key tersebut **WAJIB di-rotate**
  (dibuat ulang) di https://console.groq.com sebelum dipakai lagi. Key lama harus dianggap bocor.
- Simpan API key **hanya** lewat `supabase secrets set GROQ_API_KEY=...`.
- **Jangan pernah commit** API key ke repository (jangan taruh di `config.js`, `app.js`, atau file mana pun
  yang ikut ter-commit). Edge Function membaca key dari `Deno.env.get('GROQ_API_KEY')`, bukan dari frontend.
- **Batasi CORS:** set secret `ALLOWED_ORIGIN` ke origin aplikasi Anda (mis. `https://aplikasi-anda.example.com`)
  agar Edge Function tidak menerima request dari sembarang origin. Jika `ALLOWED_ORIGIN` tidak diset, CORS
  default ke `'*'` (kompatibel tapi kurang ketat untuk produksi).
