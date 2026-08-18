# DESIGN.md — Kasir UMKM Simpel

Dokumen design yang **jujur**: hanya mendokumentasikan apa yang benar-benar dipakai di
aplikasi (terverifikasi dari `index.html`, `app.js`, dan `tailwind.css` yang ter-compile,
per Agustus 2026). Kalau token/komponen tidak ada di sini, berarti tidak dipakai — jangan
memperkenalkannya tanpa alasan.

Stack: HTML + Tailwind CSS (di-build statis via `npm run build:css`) + Vanilla JS.
Tidak ada dark mode — aplikasi light-only. Permukaan gelap (sidebar, halaman login,
overlay) adalah pilihan desain, bukan mode.

---

## 1. Prinsip

- **Satu aksen** — terracotta (`primary`) membawa semua CTA utama, nav aktif, dan tautan brand.
- **Kalem, bukan berteriak** — berat font modest, satu tingkatan shadow, aksen dipakai sedikit.
- **Hangat & humanis** — kanvas cream hangat + tinta coklat kehitaman, bukan putih/abu dingin.
- **No AI slop** — dilarang: emoji sebagai ikon chrome UI, gradient tanpa guna (mis. `from-ink to-ink`),
  warna ungu/random di luar palet, animasi dekoratif yang menghalangi alur kerja.
  Aturan ini **ditegakkan otomatis** oleh `verify-design.js` (dijalankan lewat `npm test`).

## 2. Warna

### Token kustom (dari `tailwind.config.js`)

| Token | Hex | Pemakaian |
|---|---|---|
| `primary` | `#CC6B49` | Tombol utama, gradient login, nav aktif, tautan brand, loading bar |
| `primary-active` | `#B15537` | Hover/press tombol primary |
| `primary-light` | `#FBEEE7` | Latar badge/pill lembut, kotak info "Cara kerja" |
| `accent-gold` | `#E3A868` | **Hanya** stop pertama gradient login |
| `ink` | `#26231F` | Teks dominan + permukaan gelap (sidebar, login, overlay loading) |
| `body` | `#44403C` | Teks paragraf sekunder |
| `muted` | `#78716C` | Sub-label, label tab non-aktif |
| `muted-soft` | `#A8A29E` | Placeholder, teks disabled — kontras sengaja rendah, pakai hemat |
| `hairline` | `#E7E2DB` | Border kartu, pemisah tabel, outline input |
| `hairline-soft` | `#EFEBE4` | Divider lebih tipis |
| `surface-soft` | `#F5F2EB` | Latar kanvas aplikasi (body) |

**Token mati** (masih di config tapi tidak terpakai — jangan dipakai, nanti dihapus):
`primary-disabled`, `border-strong`, `canvas` (kartu pakai `bg-white` langsung), `surface-strong`.

### Warna semantik Tailwind (di luar token, untuk makna saja)

| Warna | Makna | Contoh |
|---|---|---|
| `rose` / `red` | Bahaya / error / void / hapus / stok rendah | `bg-rose-50 text-rose-600`, `text-red-700` |
| `amber` | Peringatan, retur | `bg-amber-50 text-amber-700` |
| `emerald` / `green` | Sukses, bayar lunas, badge aktif | `bg-emerald-100 text-emerald-600`, `bg-green-50 text-green-700` |
| `violet` / `purple` | **Khusus** panel Super Admin (`violet-700/800`) + badge metode QRIS (`purple-100/700`) | — |
| `blue` | Badge metode non-tunai lain (`blue-100/700`), angka selisih shift | — |
| `white` | Kartu & modal (`bg-white`) | — |

Aturan: warna semantik hanya untuk status/makna, bukan dekorasi. Kalau butuh warna baru
untuk hal non-semantik, gunakan token kustom di atas.

## 3. Tipografi

- **Plus Jakarta Sans** (Google Fonts). `index.html` memuat weight 400–800; halaman statis
  (`about`, `features`, `privacy`, `customer-display`) memuat 400–700.
- Fallback: `ui-sans-serif, -apple-system, system-ui, Roboto, 'Segoe UI', sans-serif`.
- Tidak ada family display terpisah. Tidak ada token ukuran kustom — pakai skala Tailwind:
  - `text-3xl`/`text-2xl` font-bold → headline halaman/modal
  - `text-xl` font-semibold → judul section/card
  - `text-base`/`text-sm` → body, label form
  - `text-xs` font-semibold → badge, meta tabel, tombol kecil
  - `font-mono` → kode produk, nomor versi, angka teknis

## 4. Bentuk & Radius

Tidak ada token radius kustom — pakai skala Tailwind:

- `rounded-lg` (8px) — tombol, input, badge
- `rounded-xl` (12px) — kartu, modal, tabel, panel
- `rounded-full` — pill, avatar, FAB, toggle

Aturan: hampir semua elemen interaktif membulat; sudut keras hanya untuk grid body.

## 5. Elevasi

- `shadow-sm` — kartu, modal, panel (definisi visual utama).
- `shadow-lg` — sidebar (satu-satunya).
- `border border-hairline` — pemisahan kartu di atas kanvas cream, selain shadow.
- **Satu tingkatan shadow saja.** Tidak ada shadow layering progresif.

## 6. Gerakan (Motion)

- CSS vars: `--motion-base`, `--motion-slow`, `--ease-paper` (lihat `<style>` di `index.html`).
- Modal/overlay: class `.motion-overlay` → animasi `paper-fade` (scrim) + `paper-enter`
  (panel naik lembut).
- Toast: `#appGlobalToast` dengan `toast-enter` / `toast-exit`.
- Halaman login: **dark-first reveal** — veil gelap default terlihat, JS memudarkannya
  (`revealLoginPage()` di `app.js`). Tanpa GSAP, tanpa animasi dekoratif.
- `prefers-reduced-motion: reduce` dihormati penuh (semua animasi dinonaktifkan via CSS).

## 7. Komponen Inti

### Sidebar
`bg-ink text-white`, lebar `md:w-72`, `shadow-lg`. Menu `data-screen` + `data-role`.
Di desktop bisa di-collapse (`#sidebarToggleBtn` → class `sidebar-collapsed`); di mobile
menjadi bottom nav. Ikon menu pakai SVG sprite.

### Halaman Login
Gradient `from-accent-gold via-primary to-primary-active` di belakang veil gelap
(`#lampVeil`, default terlihat) + `style="background:#1B1815"` inline sebagai safety net
anti-flash. Card login `bg-white rounded-xl shadow-sm p-8`. Form: tab Login/Daftar,
toggle password (`#i-eye`), recovery.

### Tombol
- Primary: `bg-primary text-white hover:bg-primary-active`, `rounded-lg`, `min-h-[44px]`.
- Ink: `bg-ink text-white hover:bg-primary-active` (aksi sekunder kuat).
- Outline: `border border-hairline bg-white`.
- Ghost/teks: `text-body hover:bg-surface-soft`.
- Pola `btn-icon` = ikon + label (mis. Simpan, Export PDF).

### Input
`border border-hairline rounded-lg px-4 py-3`, focus `focus:border-ink focus:border-2
focus:ring-0`. Label di atas, `text-body text-sm font-medium`. Error pakai warna semantik.

### Kartu
`bg-white rounded-xl border border-hairline shadow-sm p-6`.

### Modal
`fixed inset-0 z-[60..110] .motion-overlay` + scrim `bg-black/40–80`; panel
`w-full max-w-md (atau max-w-sm) rounded-xl bg-white`. Ditutup via tombol Batal,
Esc, atau klik backdrop. Z-index: modal biasa 60–110, overlay subscription `z-[200]`,
loading `z-[999]`.

### Tabel
Header: `<tr class="border-b border-hairline text-left text-muted text-xs uppercase tracking-wide">`.
Sel: `p-3 text-sm`, baris `border-b border-hairline`. Badge status di dalam sel pakai
pill semantik.

### Badge / Pill
`rounded-full px-2.5 py-1 text-xs font-semibold` + warna semantik
(mis. `bg-rose-100 text-rose-700` untuk VOID).

### Ikon (SVG sprite)
- Sprite inline di `index.html`: `<symbol id="i-*">`, dipakai via
  `<svg class="icon"><use href="#i-*"/></svg>`, `aria-hidden="true"`.
- Helper JS: `icon(name, cls)` dan `iconText(name, label, cls)` di `app.js`.
- **Dilarang emoji sebagai ikon chrome UI.** Emoji hanya boleh di teks percakapan
  (chat Aisyah, pesan WhatsApp kasbon).

### Lainnya
- **Toast**: `#appGlobalToast` (sukses/error non-blocking).
- **FAB Aisyah**: `fixed right-4 bottom-4 h-14 w-14 rounded-full` gradient primary,
  panel chat `max-w-sm h-[28rem] rounded-xl bg-white border border-hairline`.
- **Overlay Subscription**: gradient gelap `from-ink via-body to-primary`, CTA upgrade,
  banner trial tersisa ≤7 hari.
- **Super Admin**: tombol `bg-violet-700` (satu-satunya pengecualian warna — peran
  terpisah dari pengguna biasa, sengaja dibedakan).
- **Struk**: `#receiptContent` + media print (hanya struk yang tercetak).
- **Layar Pelanggan**: `customer-display.html` terpisah, sinkron via BroadcastChannel
  (tanpa akses data sensitif).

## 8. Responsif & Touch

- Breakpoint utama: `md` (768px) — sidebar muncul, bottom nav hilang.
- Mobile-first: semua layar scrollable punya ruang bawah aman (custom CSS).
- Touch target minimum **44×44px** (`min-h-[44px]` untuk tombol).
- Tidak boleh ada horizontal scroll; kartu/kolom menurunkan jumlah kolom, bukan reflow.

## 9. Known Gaps / Catatan

- `primary-disabled`, `border-strong`, `canvas`, `surface-strong` masih di
  `tailwind.config.js` tapi tidak terpakai — kandidat hapus.
- Halaman statis (`about`, `features`, `privacy`) memakai subset aturan yang sama
  (kanvas cream, card putih, terracotta) dengan CSS inline kecil — belum di-token-kan.
