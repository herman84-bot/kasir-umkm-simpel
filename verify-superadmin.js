// verify-superadmin.js — Regression test: Panel Super Admin (Aktivitas + Hapus Toko)
// Menjalankan dengan: node verify-superadmin.js
// Cakupan:
//   1. app.js tetap bisa dievaluasi penuh (tidak ada error sintaks) di JSDOM.
//   2. Logika badge aktivitas (hijau "Aktif" / merah "Tidak Aktif" / "—" jika null).
//   3. Kolom Status (langganan) kembali dirender — header + sel.
//   4. Modal hapus: teks konfirmasi multi-cabang yang benar.
//   5. Payload delete_store: action + store_id benar.
//   6. Edge Function: filter status konsisten dengan RPC + limit + aman multi-cabang.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = __dirname;
const htmlPath = path.join(ROOT, 'index.html');
const jsPath = path.join(ROOT, 'app.js');
const efPath = path.join(ROOT, 'supabase/functions/admin-subscription/index.ts');
const migPath = path.join(ROOT, 'supabase/17_super_admin_aktivitas_hapus.sql');

let failures = 0;
let checks = 0;
const ok = (cond, label) => {
  checks++;
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.error(`  FAIL  ${label}`); }
};
const contains = (haystack, needle, label) => ok(String(haystack).includes(needle), `${label} (harus mengandung "${needle}")`);

console.log('=== verify-superadmin.js ===');

// ── 1. Evaluasi penuh app.js (sintaks + init) di JSDOM ────────────────────
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

const dom = new JSDOM(htmlContent, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.supabase = {
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => {},
      signOut: () => Promise.resolve({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
    rpc: () => Promise.resolve({ data: [], error: null }),
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  }),
};
window.Chart = class { constructor() {} destroy() {} };
window.QRCode = class { constructor() {} };
window.print = () => {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
window.BroadcastChannel = class { postMessage() {} close() {} };
window.localStorage.setItem('sb-session', JSON.stringify({}));

try {
  window.eval(jsContent);
  ok(true, 'app.js dievaluasi tanpa error sintaks');
} catch (e) {
  ok(false, `app.js dievaluasi tanpa error sintaks: ${e.message}`);
}

// ── Helper: ekstrak arrow function dari source (template-aware) ───────────
// Mengembalikan teks fungsi mulai dari marker sampai body selesai (blok `{...}`
// atau template literal), dengan pemindai yang memahami string, template
// literal, ekspresi `${...}` bersarang, komentar, dan escape.
// Stack ekspresi dipakai agar `}` penutup `${...}` selalu mengembalikan state
// ke template — terlepas dari depth brace body fungsi.
function extractArrowFn(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  const arrow = src.indexOf('=>', start);
  if (arrow < 0) return null;
  let j = arrow + 2;
  while (j < src.length && /\s/.test(src[j])) j++;
  if (j >= src.length) return null;

  // mode 'brace' → berhenti saat depth body 0; mode 'tpl' → berhenti di backtick penutup
  const mode = src[j] === '{' ? 'brace' : (src[j] === '`' ? 'tpl' : null);
  if (!mode) return null;

  let depth = 0;         // brace body fungsi (state 'code')
  // Stack interpolasi template: tiap entri { n, back } — n = kedalaman objek
  // literal di dalam ekspresi, back = state tujuan saat ekspresi ditutup
  // ('tpl' untuk `${` di template biasa, 'etpl' untuk template bersarang).
  const exprStack = [];
  let state = mode === 'tpl' ? 'tpl' : 'code'; // code | sq | dq | tpl | expr | esq | edq | etpl | line | block

  for (let i = j + (mode === 'tpl' ? 1 : 0); i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
      else if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      else if (c === '/' && n === '/') state = 'line';
      else if (c === '/' && n === '*') state = 'block';
    } else if (state === 'line') {
      if (c === '\n') state = 'code';
    } else if (state === 'block') {
      if (c === '*' && n === '/') { i++; state = 'code'; }
    } else if (state === 'sq' || state === 'dq' || state === 'esq' || state === 'edq') {
      if (c === '\\') i++;
      else if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"')
            || (state === 'esq' && c === "'") || (state === 'edq' && c === '"')) {
        state = (state === 'esq' || state === 'edq') ? 'expr' : 'code';
      }
    } else if (state === 'tpl') {
      if (c === '\\') i++;
      else if (c === '`') {
        if (mode === 'tpl') return src.slice(start, i + 1); // body template literal selesai
        state = 'code';
      }
      else if (c === '$' && n === '{') { state = 'expr'; exprStack.push({ n: 0, back: 'tpl' }); i++; /* skip '{' */ }
    } else if (state === 'expr') {
      if (c === '\\') i++;
      else if (c === '`') state = 'etpl';
      else if (c === "'") state = 'esq';
      else if (c === '"') state = 'edq';
      else if (c === '{') exprStack[exprStack.length - 1].n++;
      else if (c === '}') {
        if (exprStack[exprStack.length - 1].n > 0) exprStack[exprStack.length - 1].n--;
        else state = exprStack.pop().back;
      }
    } else if (state === 'etpl') {
      if (c === '\\') i++;
      else if (c === '`') state = 'expr';
      else if (c === '$' && n === '{') { state = 'expr'; exprStack.push({ n: 0, back: 'etpl' }); i++; /* skip '{' */ }
    }
  }
  return null;
}

// ── 2. Eksekusi fungsi badge asli dari source dengan esc di scope ──────────
window.esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const activitySrc = extractArrowFn(jsContent, 'const superAdminActivityLabel = store => {');
const statusSrc = extractArrowFn(jsContent, 'const superAdminStatusLabel = store => {');
const btnSrc = extractArrowFn(jsContent, 'const superAdminDeleteBtn = store => `');

ok(!!activitySrc, 'Fungsi superAdminActivityLabel ditemukan di source');
ok(!!statusSrc, 'Fungsi superAdminStatusLabel ditemukan di source');
ok(!!btnSrc, 'Fungsi superAdminDeleteBtn ditemukan di source');

if (activitySrc && statusSrc && btnSrc) {
  window.eval(activitySrc.replace('const superAdminActivityLabel', 'window.superAdminActivityLabel'));
  window.eval(statusSrc.replace('const superAdminStatusLabel', 'window.superAdminStatusLabel'));
  window.eval(btnSrc.replace('const superAdminDeleteBtn', 'window.superAdminDeleteBtn'));

  // Badge aktivitas
  const aktif = window.superAdminActivityLabel({ total_transactions: 5, last_transaction_at: '2026-08-01T00:00:00Z' });
  contains(aktif, 'Aktif', 'Aktivitas: toko dengan 5 transaksi → hijau "Aktif"');
  contains(aktif, '>5 transaksi', 'Aktivitas: menampilkan jumlah transaksi');
  contains(aktif, 'Terakhir', 'Aktivitas: menampilkan tanggal transaksi terakhir');
  contains(aktif, 'bg-emerald-100', 'Aktivitas: menggunakan warna hijau');

  const nonaktif = window.superAdminActivityLabel({ total_transactions: 0 });
  contains(nonaktif, 'Tidak Aktif', 'Aktivitas: toko 0 transaksi → merah "Tidak Aktif"');
  contains(nonaktif, 'bg-rose-100', 'Aktivitas: menggunakan warna merah');

  const kosong = window.superAdminActivityLabel({});
  contains(kosong, '—', 'Aktivitas: total_transactions null → dash (tidak salah hitung)');

  // Badge status langganan (regresi P0 #1: kolom Status dikembalikan)
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const past = new Date(Date.now() - 7 * 86400000).toISOString();
  contains(window.superAdminStatusLabel({ business_until: future }), 'Bisnis', 'Status: Bisnis aktif');
  contains(window.superAdminStatusLabel({ premium_until: future }), 'Premium', 'Status: Premium aktif');
  contains(window.superAdminStatusLabel({ trial_ends_at: future }), 'Trial', 'Status: Trial aktif');
  contains(window.superAdminStatusLabel({ trial_ends_at: past }), 'Gratis', 'Status: tanpa langganan aktif → Gratis');

  // Tombol hapus per baris
  const btn = window.superAdminDeleteBtn({ id: 'abc-123', name: 'Toko <b>X</b>' });
  contains(btn, 'data-del-store="abc-123"', 'Tombol Hapus: menyimpan store id');
  contains(btn, 'data-del-name="Toko &lt;b&gt;X&lt;/b&gt;"', 'Tombol Hapus: nama toko di-escape (XSS)');
  contains(btn, '#i-trash', 'Tombol Hapus: ikon trash');
  contains(btn, 'rose', 'Tombol Hapus: gaya destruktif (outline merah)');
}

// ── 3. Kolom Status dikembalikan di tabel (regresi P0 #1) ──────────────────
ok(jsContent.includes('<th class="py-2 pr-4 font-medium">Status</th>'), 'Tabel: header "Status" ada');
ok(jsContent.includes('<th class="py-2 pr-4 font-medium">Aktivitas</th>'), 'Tabel: header "Aktivitas" ada');
ok(jsContent.includes('${superAdminStatusLabel(s)}'), 'Tabel: sel memanggil superAdminStatusLabel(s)');
ok(jsContent.includes('${superAdminActivityLabel(s)}'), 'Tabel: sel memanggil superAdminActivityLabel(s)');

// ── 4. Modal hapus: teks konfirmasi multi-cabang ───────────────────────────
ok(htmlContent.includes('id="superAdminDeleteModal"'), 'Modal hapus ada di index.html');
contains(htmlContent, 'Akun pemilik ikut dihapus', 'Modal: teks konfirmasi akun pemilik');
contains(htmlContent, 'hanya jika ini satu-satunya toko/cabang miliknya', 'Modal: teks konfirmasi multi-cabang');
ok(htmlContent.includes('id="superAdminDeleteInput"'), 'Modal: input ketik nama toko ada');
ok(htmlContent.includes('id="superAdminDeleteConfirmBtn"'), 'Modal: tombol konfirmasi ada');

// ── 4b. Render-test DOM penuh: tabel super admin di JSDOM ─────────────────
// Jalankan fungsi render asli (diekstrak dari source) ke elemen nyata di
// index.html yang sudah dimuat JSDOM, lalu periksa output badge/kolom/tombol.
function renderSuperAdminTable() {
  const fmtSrc = extractArrowFn(jsContent, 'const superAdminFmtDate = v => {');
  const renderSrc = extractArrowFn(jsContent, 'const superAdminRenderTable = (stores) => {');
  if (!fmtSrc || !renderSrc) return null;
  window.eval(fmtSrc.replace('const superAdminFmtDate', 'window.superAdminFmtDate'));
  window.eval(renderSrc.replace('const superAdminRenderTable', 'window.superAdminRenderTable'));
  const stores = [
    {
      id: 'st-1', name: 'Warung Bu Tini', owner_id: 'u-1', owner_email: 'tini@mail.com',
      trial_ends_at: null, premium_until: null, business_until: new Date(Date.now() + 30 * 86400000).toISOString(),
      total_transactions: 12, last_transaction_at: '2026-08-05T09:00:00Z',
    },
    {
      id: 'st-2', name: 'Toko <script>alert(1)</script>', owner_id: 'u-2', owner_email: 'bud@mail.com',
      trial_ends_at: null, premium_until: null, business_until: null,
      total_transactions: 0, last_transaction_at: null,
    },
  ];
  window.superAdminRenderTable(stores);
  const wrapper = window.document.getElementById('superAdminTableWrapper');
  const html = wrapper ? wrapper.innerHTML : '';
  return html;
}

const rendered = renderSuperAdminTable();
if (rendered !== null) {
  contains(rendered, '<th class="py-2 pr-4 font-medium">Status</th>', 'Render: header Status dirender');
  contains(rendered, '<th class="py-2 pr-4 font-medium">Aktivitas</th>', 'Render: header Aktivitas dirender');
  contains(rendered, 'bg-emerald-100', 'Render: badge hijau Aktif untuk toko bertransaksi');
  contains(rendered, '>12 transaksi', 'Render: jumlah transaksi ditampilkan');
  contains(rendered, 'bg-rose-100', 'Render: badge merah Tidak Aktif untuk toko tanpa transaksi');
  contains(rendered, 'Tidak Aktif', 'Render: label Tidak Aktif dirender');
  contains(rendered, '>Bisnis<', 'Render: badge status Bisnis dirender');
  contains(rendered, '>Gratis<', 'Render: badge status Gratis dirender');
  contains(rendered, 'data-del-store="st-1"', 'Render: tombol Hapus membawa store id');
  contains(rendered, 'Toko &lt;script&gt;alert(1)&lt;/script&gt;', 'Render: nama toko di-escape (XSS-safe)');
  contains(rendered, '#i-trash', 'Render: ikon trash di tombol Hapus');
} else {
  ok(false, 'Render tabel: fungsi superAdminRenderTable + superAdminFmtDate berhasil diekstrak');
}

// ── 5. Payload delete_store dari client ────────────────────────────────────
ok(jsContent.includes("action: 'delete_store'"), 'Payload delete: action delete_store');
ok(jsContent.includes('store_id: target.id'), 'Payload delete: store_id dikirim');

// ── 6. Edge Function: kontrak konsisten ────────────────────────────────────
const ef = fs.readFileSync(efPath, 'utf8');
contains(ef, ".or('status.is.null,status.neq.void')", 'EF: filter status konsisten dengan RPC (null + bukan void)');
contains(ef, '.limit(100000)', 'EF: query transaksi pakai limit (tidak terpotong 1000 baris)');
contains(ef, "from('stores')", 'EF: query stores ada');
contains(ef, '.neq(\'id\', storeId)', 'EF: cek cabang lain milik pemilik (multi-cabang)');
contains(ef, 'deleteStoreOnly', 'EF: logika hapus baris-saja vs hapus-akun (multi-cabang aman)');
contains(ef, 'deleteUser(storeRow.owner_id)', 'EF: hapus akun pemilik masih ada (jalur toko terakhir)');

// ── 7. Migration 17: definisi aktivitas & FK log audit ─────────────────────
const mig = fs.readFileSync(migPath, 'utf8');
contains(mig, "IS DISTINCT FROM 'void'", 'Migrasi: aktivitas menghitung semua non-void (termasuk NULL)');
contains(mig, 'total_transactions', 'Migrasi: kolom total_transactions ada di RPC');
contains(mig, 'last_transaction_at', 'Migrasi: kolom last_transaction_at ada di RPC');
contains(mig, 'ON DELETE SET NULL', 'Migrasi: FK admin_action_logs → SET NULL (log audit tetap tersimpan)');
contains(mig, 'DROP FUNCTION IF EXISTS', 'Migrasi: DROP FUNCTION IF EXISTS (atasi error 42P13)');

// ── 8. public/ sinkron dengan root ─────────────────────────────────────────
const publicJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const publicHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
ok(publicJs === jsContent, 'public/app.js identik dengan app.js');
ok(publicHtml === htmlContent, 'public/index.html identik dengan index.html');

console.log(`\n${checks - failures}/${checks} pemeriksaan lulus`);
if (failures > 0) {
  console.error(`\n${failures} GAGAL — perbaiki sebelum commit.`);
  process.exit(1);
}
console.log('\nSemua pemeriksaan lulus ✅');
