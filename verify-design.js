// verify-design.js — Design-lint: memblokir "AI slop" agar tidak kembali.
// Dipanggil dari `npm test`. Cakupan:
//   1. Emoji di chrome UI (index.html, customer-display, halaman statis) = FAIL.
//      app.js: emoji hanya diizinkan dari allowlist chat Aisyah / pesan WA kasbon.
//   2. Warna utility di luar palet kustom & set semantik = FAIL.
//   3. Gradient no-op (from-X ... to-X sama dalam satu tag) = FAIL.
//   4. Ikon sprite: semua icon('..') / iconText('..') / <use href="#i-.."> harus ada di sprite.
//   5. Badge versi: tidak boleh ada "Versi X.Y.Z" hardcoded; app.js mengisi dari APP_VERSION.
//   6. root <-> public identik untuk file aplikasi (anti-drift).
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
let failures = 0;
let checks = 0;
const ok = (cond, label) => {
  checks++;
  if (cond) console.log('  PASS  ' + label);
  else { failures++; console.error('  FAIL  ' + label); }
};
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── 1. Emoji di chrome UI ──────────────────────────────────────────────────
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
// Emoji yang diizinkan di app.js — hanya untuk teks percakapan (chat Aisyah &
// pesan WhatsApp kasbon), bukan ikon chrome UI.
const CHAT_EMOJI = ['😊', '🙏', '🧕', '🤗', '🎉', '📶', '🖨', '📷', '🏢', '🏪', '👑', '📄'];

for (const f of ['index.html', 'customer-display.html', 'about.html', 'features.html', 'privacy.html']) {
  const m = (read(f).match(EMOJI) || []);
  ok(m.length === 0, `${f} bebas emoji di chrome UI`);
}

const js = read('app.js');
const foundEmoji = [...new Set(js.match(EMOJI) || [])];
const badEmoji = foundEmoji.filter(e => !CHAT_EMOJI.includes(e));
ok(badEmoji.length === 0, `app.js: emoji hanya dari allowlist chat (di luar allowlist: ${badEmoji.join('') || 'tidak ada'})`);

// ── 2. Warna utility di luar palet ─────────────────────────────────────────
// Palet kustom (tailwind.config.js) + warna semantik yang disengaja.
// Untuk menambah warna baru secara sah: tambahkan ke ALLOWED_COLORS + catat di DESIGN.md.
const ALLOWED_COLORS = [
  'primary', 'primary-active', 'primary-light', 'primary-disabled', 'accent-gold',
  'ink', 'body', 'muted', 'muted-soft', 'hairline', 'hairline-soft', 'border-strong',
  'canvas', 'surface-soft', 'surface-strong',
  'white', 'black', 'transparent', 'current',
  'rose', 'red', 'amber', 'emerald', 'green', 'violet', 'purple', 'blue',
];
// Nama yang cocok dengan pola regex tapi BUKAN warna (utility non-warna).
const NON_COLORS = ['sm', 'xs', 'base', 'lg', 'xl', 'left', 'center', 'right', 'b', 't', 'l', 'r', 'collapse', 'dashed', 'solid', 'none'];

const COLOR_UTIL = /(?:^|[\s"'])((?:hover:|focus:|disabled:)?(?:bg|text|border|from|to|via|ring|outline)-([a-z][a-z-]*?)(?:-[0-9]+)?(?:\/[0-9]+)?)(?=[\s"'])/g;
for (const f of ['index.html', 'app.js', 'customer-display.html']) {
  const t = read(f);
  const bad = [];
  let m;
  while ((m = COLOR_UTIL.exec(t))) {
    const name = m[2];
    if (name.startsWith('gradient')) continue; // bg-gradient-to-*
    if (NON_COLORS.includes(name)) continue;
    if (!ALLOWED_COLORS.includes(name)) bad.push(m[1]);
  }
  ok(bad.length === 0, `${f}: hanya warna palet/semantik (di luar: ${[...new Set(bad)].join(', ') || 'tidak ada'})`);
}

// ── 3. Gradient no-op (from-X ... to-X sama dalam satu class) ──────────────
for (const f of ['index.html', 'app.js']) {
  const t = read(f);
  const bad = [];
  // Scan per attribute class (bukan per baris) agar dua tag berbeda di baris
  // yang sama tidak saling memicu false positive.
  const classRe = /class=["']([^"']*)["']/g;
  const stopRe = /(?:from|via|to)-([a-z][a-z0-9-]*)/g;
  let cm;
  while ((cm = classRe.exec(t))) {
    const stops = [];
    let sm;
    while ((sm = stopRe.exec(cm[1]))) stops.push(sm[1]);
    // "to-r" (arah bg-gradient-to-r) hanya noise — relevan hanya jika duplikat.
    if (stops.length >= 2 && new Set(stops).size < stops.length) {
      bad.push(`class="${cm[1].trim()}"`);
    }
  }
  ok(bad.length === 0, `${f}: tidak ada gradient no-op (${bad.slice(0, 3).join('; ') || 'tidak ada'})`);
}

// ── 4. Ikon sprite harus ada ───────────────────────────────────────────────
const sprite = read('index.html');
const spriteIds = new Set([...sprite.matchAll(/id="i-([a-z-]+)"/g)].map(m => m[1]));
const missing = new Set();

const checkIconRef = (label, ref) => {
  if (!spriteIds.has(ref)) missing.add(`${label} → #i-${ref}`);
};
for (const m of js.matchAll(/icon\(['"]([a-z-]+)['"]/g)) checkIconRef('app.js icon()', m[1]);
for (const m of js.matchAll(/iconText\(['"]([a-z-]+)['"]/g)) checkIconRef('app.js iconText()', m[1]);
for (const m of js.matchAll(/href="#i-([a-z-]+)"/g)) checkIconRef('app.js <use>', m[1]);
for (const m of sprite.matchAll(/href="#i-([a-z-]+)"/g)) checkIconRef('index.html <use>', m[1]);

ok(spriteIds.size > 30, `sprite ikon terdefinisi (${spriteIds.size} symbol)`);
ok(missing.size === 0, `semua referensi ikon ada di sprite (hilang: ${[...missing].join(', ') || 'tidak ada'})`);

// ── 5. Badge versi tidak boleh hardcoded ───────────────────────────────────
ok(!/Versi\s+\d+\.\d+/.test(sprite), 'index.html: tidak ada versi hardcoded ("Versi X.Y.Z")');
ok(sprite.includes('id="aboutAppVersion"'), 'index.html: badge versi dinamis (aboutAppVersion) ada');
ok(sprite.includes('id="appVersionDisplay"'), 'index.html: display versi (appVersionDisplay) ada');
ok(/getElementById\('aboutAppVersion'\)[\s\S]*?APP_VERSION/.test(js), 'app.js: aboutAppVersion diisi dari APP_VERSION');
ok(/getElementById\('appVersionDisplay'\)[\s\S]*?APP_VERSION/.test(js), 'app.js: appVersionDisplay diisi dari APP_VERSION');

// ── 6. root <-> public identik (anti-drift) ────────────────────────────────
for (const f of ['app.js', 'index.html', 'customer-display.html', 'tailwind.css', 'service-worker.js']) {
  ok(compareFile(f), `public/${f} identik dengan ${f}`);
}

function compareFile(f) {
  try {
    return fs.readFileSync(path.join(ROOT, f)).equals(fs.readFileSync(path.join(ROOT, 'public', f)));
  } catch (e) { return false; }
}

console.log('');
if (failures === 0) {
  console.log(`${checks}/${checks} pemeriksaan design-lint lulus ✅`);
  process.exit(0);
} else {
  console.error(`${failures} pelanggaran design-lint ditemukan ❌`);
  process.exit(1);
}
