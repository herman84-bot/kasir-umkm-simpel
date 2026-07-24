const App = (() => {
  // Escape HTML untuk mencegah XSS di semua innerHTML yang memakai data dari DB/user
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Premium line icons (sprite di index.html). Pakai untuk chrome UI, bukan pesan chat/alert panjang.
  const icon = (name, cls = 'icon') =>
    `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const iconText = (name, label, cls = 'icon') =>
    `${icon(name, cls)} ${label}`;

  const APP_VERSION = '1.2.0';

  // ── Customer Display BroadcastChannel (lazy init) ─────────────────────
  // Channel hanya dibuat jika customer-display.html terbuka (AC11).
  // Tidak ada data sensitif (email/password/token/userId) yang dikirim (AC4).
  let _customerDisplayChannel = null;
  let _customerDisplayHeartbeat = null;
  let _customerDisplayWindow = null;
  let _customerDisplayWindowPoll = null;

  const _teardownCustomerDisplayChannel = () => {
    if (_customerDisplayHeartbeat) {
      clearInterval(_customerDisplayHeartbeat);
      _customerDisplayHeartbeat = null;
    }
    if (_customerDisplayWindowPoll) {
      clearInterval(_customerDisplayWindowPoll);
      _customerDisplayWindowPoll = null;
    }
    if (_customerDisplayChannel) {
      try { _customerDisplayChannel.close(); } catch (_) { /* ignore */ }
      _customerDisplayChannel = null;
    }
    _customerDisplayWindow = null;
  };

  const _initCustomerDisplayChannel = () => {
    if (_customerDisplayChannel) return _customerDisplayChannel;
    _customerDisplayChannel = new BroadcastChannel('kasir-customer-display');
    _customerDisplayChannel.onmessage = (event) => {
      // customer-display.html baru dibuka / retry ready → kirim state awal
      if (event.data && event.data.type === 'customer-display-ready') {
        _broadcastCartState();
      }
    };
    // Heartbeat setiap 5 detik agar customer display tahu kasir masih aktif
    _customerDisplayHeartbeat = setInterval(() => {
      if (_customerDisplayChannel) {
        _customerDisplayChannel.postMessage({ type: 'heartbeat' });
      }
    }, 5000);
    return _customerDisplayChannel;
  };

  const _broadcastCartState = () => {
    if (!_customerDisplayChannel) return;
    const items = getCartItems();
    const totals = calculateCart();
    const store = getStoreSettings();
    if (items.length === 0) {
      _customerDisplayChannel.postMessage({ type: 'idle', payload: {} });
    } else {
      _customerDisplayChannel.postMessage({
        type: 'cart-update',
        payload: {
          items: items.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
          total: totals.total,
          storeName: store.name
        }
      });
    }
  };

  const _broadcastPaymentComplete = (transaction) => {
    if (!_customerDisplayChannel) return;
    const store = getStoreSettings();
    _customerDisplayChannel.postMessage({
      type: 'payment-complete',
      payload: {
        storeName: store.name,
        total: transaction.total,
        paymentMethod: transaction.paymentMethod,
        change: transaction.change
      }
    });
  };

  const _broadcastIdle = () => {
    if (_customerDisplayChannel) {
      _customerDisplayChannel.postMessage({ type: 'idle', payload: {} });
    }
  };

  const openCustomerDisplay = () => {
    _initCustomerDisplayChannel();
    // F2: kirim state segera (siap atau belum, display bisa retry ready)
    _broadcastCartState();
    const win = window.open('customer-display.html', 'customer-display',
      'width=800,height=600,menubar=no,toolbar=no,location=no,status=no');
    if (!win || win.closed) {
      alert('Layar pelanggan diblokir oleh browser. Izinkan pop-up untuk situs ini, lalu coba lagi.');
      return;
    }
    _customerDisplayWindow = win;
    // F4: teardown channel+heartbeat saat jendela customer ditutup
    if (_customerDisplayWindowPoll) clearInterval(_customerDisplayWindowPoll);
    _customerDisplayWindowPoll = setInterval(() => {
      if (!_customerDisplayWindow || _customerDisplayWindow.closed) {
        _teardownCustomerDisplayChannel();
      }
    }, 2000);
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Muat script eksternal sekali (no-op jika sudah ada); dipakai untuk lazy-load CDN
  const loadScript = url => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const STORAGE = {
    products: 'pos_products',
    transactions: 'pos_transactions',
    cashiers: 'pos_cashiers',
    purchases: 'pos_purchases',
    settings: 'pos_settings',
    storeSettings: 'pos_store_settings'
  };

  const defaultStoreSettings = {
    name: 'Kasir UMKM Simpel',
    address: '',
    phone: '',
    note: 'Terima kasih, selamat datang kembali!',
    paperSize: '58'
  };

  // Ambil pengaturan toko dari record store (Supabase), fallback ke default
  const getStoreSettings = () => {
    const s = state.store;
    if (s) {
      return {
        name: s.name || defaultStoreSettings.name,
        address: s.address || '',
        phone: s.phone || '',
        note: s.note || defaultStoreSettings.note,
        paperSize: s.paper_size || '58'
      };
    }
    // Super admin tanpa toko — jangan baca localStorage supaya data toko
    // user sebelumnya tidak bocor ke context admin.
    if (_isSuperAdmin && !state.store) return { ...defaultStoreSettings };
    try {
      return { ...defaultStoreSettings, ...JSON.parse(localStorage.getItem(STORAGE.storeSettings) || '{}') };
    } catch { return { ...defaultStoreSettings }; }
  };

  // Simpan pengaturan toko ke tabel stores (Supabase) + cache lokal
  const saveStoreSettings = async settings => {
    localStorage.setItem(STORAGE.storeSettings, JSON.stringify(settings));
    if (settings.qrisImage !== undefined) {
      localStorage.setItem('qris_image', settings.qrisImage || '');
    }
    if (db && state.storeId) {
      const { error } = await db.from('stores').update({
        name: settings.name,
        address: settings.address,
        phone: settings.phone,
        note: settings.note,
        paper_size: settings.paperSize
      }).eq('id', state.storeId);
      if (error) return { error: error.message };
      if (state.store) {
        state.store = { ...state.store, name: settings.name, address: settings.address,
          phone: settings.phone, note: settings.note, paper_size: settings.paperSize };
      }
      // Sinkronkan nama ke daftar cabang agar switcher/daftar ikut ter-update
      const inList = (state.stores || []).find(s => String(s.id) === String(state.storeId));
      if (inList) inList.name = settings.name;
    }
    return {};
  };

  const getQrisImage = () => localStorage.getItem('qris_image') || '';

  // ── Langganan / masa aktif ────────────────────────────────────────────────
  const SUPPORT_TELEGRAM_URL = 'https://t.me/+veK2jeQuBkQwNzU1';
  const PAKASIR_BASE = 'https://app.pakasir.com';
  const PAKASIR_SLUG = 'kasir-umkm-simpel';

  const makeSubsOrderId = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const ts = `${String(d.getFullYear()).slice(2)}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `KUS-${String(state.storeId||'x').slice(-6)}-${ts}`;
  };

  const buildPakasirUrl = (amount, orderId) => {
    const redirect = encodeURIComponent(location.origin + location.pathname);
    return `${PAKASIR_BASE}/pay/${PAKASIR_SLUG}/${amount}?order_id=${orderId}&redirect=${redirect}`;
  };

  // Short-lived in-memory cache for the server-side subscription check (max 60 s).
  // Stored in a module-level variable — NOT localStorage — so it resets on each page load.
  let _subsCacheResult = null;
  let _subsCacheTs = 0;
  const SUBS_CACHE_TTL_MS = 60 * 1000;

  // Call the check-subscription Edge Function and return { premiumActive, businessActive, daysLeft }.
  // Returns null on 401 or network error (fail-closed: treat as inactive).
  const fetchSubscriptionFromServer = async () => {
    const now = Date.now();
    if (_subsCacheResult !== null && now - _subsCacheTs < SUBS_CACHE_TTL_MS) {
      return _subsCacheResult;
    }
    try {
      const { data, error } = await db.functions.invoke('check-subscription', { body: {} });
      if (error) {
        _subsCacheResult = null;
        _subsCacheTs = 0;
        return null;
      }
      _subsCacheResult = data;
      _subsCacheTs = now;
      return data;
    } catch (e) {
      _subsCacheResult = null;
      _subsCacheTs = 0;
      return null;
    }
  };

  // Invalidate the server-side subscription cache (called on fresh page load / loadStore).
  const invalidateSubscriptionCache = () => {
    _subsCacheResult = null;
    _subsCacheTs = 0;
  };

  // Hitung sisa hari masa aktif (trial atau premium, ambil yang paling lama)
  // Toko utama (pusat) = penambat langganan. Semua cabang berbagi langganan ini.
  const primaryStore = () =>
    (state.stores || []).find(s => s.is_main) || (state.stores || [])[0] || state.store;

  // Hitung sisa hari berdasarkan kolom langganan tertentu pada TOKO UTAMA.
  const daysLeftFor = cols => {
    const s = primaryStore();
    if (!s) return null; // belum ada data toko → jangan blokir
    const candidates = cols.map(c => s[c]).filter(Boolean).map(d => new Date(d).getTime());
    // Kolom belum ada (SQL belum dijalankan) → fallback 30 hari dari created_at (trial)
    if (!candidates.length) {
      if (!s.created_at) return null;
      candidates.push(new Date(s.created_at).getTime() + 30 * 24 * 3600 * 1000);
    }
    const expiry = Math.max(...candidates);
    return Math.ceil((expiry - Date.now()) / (24 * 3600 * 1000));
  };

  // Premium aktif jika trial / premium_until / (atau Bisnis, karena Bisnis mencakup Premium).
  const getSubscriptionDaysLeft = () => daysLeftFor(['trial_ends_at', 'premium_until', 'business_until']);
  // Bisnis aktif jika trial / business_until.
  const getBusinessDaysLeft = () => daysLeftFor(['trial_ends_at', 'business_until']);

  let _currentSubsPlan = null;

  const showSubsOverlay = (plan = null) => {
    const overlay = document.getElementById('subsOverlay');
    if (!overlay) return;
    _currentSubsPlan = plan || PLANS.premium;
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  };

  const startPakasirPayment = async () => {
    const plan = _currentSubsPlan || PLANS.premium;
    const tier = plan.label === 'Bisnis' ? 'business' : 'premium';
    const amount = plan.amount;
    const orderId = makeSubsOrderId();
    const store = primaryStore();
    if (!store) { alert('Data toko belum siap. Coba lagi sebentar.'); return; }
    const payBtn = document.getElementById('subsPayBtn');
    if (payBtn) { payBtn.textContent = 'Menyiapkan...'; payBtn.style.pointerEvents = 'none'; }
    const { error } = await db.from('subscription_orders').insert({
      order_id: orderId, store_id: store.id, tier, amount, status: 'pending'
    });
    if (error) {
      alert('Gagal menyiapkan pembayaran. Pastikan SQL 08_pakasir.sql sudah dijalankan.');
      if (payBtn) { payBtn.innerHTML = iconText('credit', 'Bayar Sekarang via Pakasir'); payBtn.style.pointerEvents = ''; }
      return;
    }
    localStorage.setItem('pending_subs_order', JSON.stringify({ orderId, tier }));
    window.location.href = buildPakasirUrl(amount, orderId);
  };

  const checkPakasirOrderStatus = async () => {
    const raw = localStorage.getItem('pending_subs_order');
    if (!raw) return false;
    let pending;
    try { pending = JSON.parse(raw); } catch { localStorage.removeItem('pending_subs_order'); return false; }
    const { data } = await db.from('subscription_orders').select('status').eq('order_id', pending.orderId).maybeSingle();
    if (data?.status === 'completed') {
      localStorage.removeItem('pending_subs_order');
      invalidateSubscriptionCache();
      await loadStore();
      return true;
    }
    return false;
  };

  const watchPendingSubscription = async () => {
    if (!localStorage.getItem('pending_subs_order')) return;
    if (await checkPakasirOrderStatus()) {
      hideSubsOverlay();
      alert('Pembayaran berhasil! 🎉 Langganan Anda sudah aktif.');
      return;
    }
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      if (await checkPakasirOrderStatus()) {
        clearInterval(timer);
        hideSubsOverlay();
        alert('Pembayaran berhasil! 🎉 Langganan Anda sudah aktif.');
      } else if (tries >= 20) clearInterval(timer);
    }, 3000);
  };

  const hideSubsOverlay = () => {
    const overlay = document.getElementById('subsOverlay');
    if (overlay) { overlay.classList.add('hidden'); overlay.style.display = ''; }
  };

  // ── Model FREEMIUM bertingkat: aplikasi dasar gratis selamanya. ──
  //  Gratis → Premium (Rp25.000) → Bisnis (Rp50.000, mencakup Premium + Multi-Cabang)
  const isPremiumActive = () => {
    const d = getSubscriptionDaysLeft();
    return d === null ? true : d > 0;
  };
  const isBusinessActive = () => {
    const d = getBusinessDaysLeft();
    return d === null ? true : d > 0;
  };

  const PLANS = {
    premium: {
      title: 'Upgrade ke Premium',
      label: 'Premium',
      price: 'Rp25.000',
      amount: 25000,
      features: [
        'QRIS Dinamis — nominal otomatis tertanam di QR',
        'Export laporan PDF',
        'Operator kasir tanpa batas',
        'Kasbon tanpa batas',
        'Dukungan prioritas via Telegram'
      ]
    },
    business: {
      title: 'Upgrade ke Bisnis',
      label: 'Bisnis',
      price: 'Rp50.000',
      amount: 50000,
      features: [
        'Semua fitur Premium',
        'Multi-Cabang tanpa batas',
        'Dashboard Pusat — pantau semua cabang',
        'Stok & transaksi terpisah per cabang',
        'Dukungan prioritas via Telegram'
      ]
    }
  };

  const showUpgradeOverlay = (tier, featureName) => {
    const p = PLANS[tier] || PLANS.premium;
    const title = document.getElementById('subsOverlayTitle');
    const desc = document.getElementById('subsOverlayDesc');
    const price = document.getElementById('subsOverlayPrice');
    const feats = document.getElementById('subsOverlayFeatures');
    if (title) title.textContent = p.title;
    if (desc) desc.textContent = featureName
      ? `${featureName} termasuk paket ${p.label}. Aplikasi dasar tetap gratis selamanya.`
      : 'Fitur dasar tetap gratis selamanya.';
    if (price) price.innerHTML = `${esc(p.price)}<span class="text-base font-medium text-primary">/bulan</span>`;
    if (feats) feats.innerHTML = p.features.map(f => `<p class="btn-icon">${icon('check', 'icon icon-sm text-emerald-600')}<span>${esc(f)}</span></p>`).join('');
    showSubsOverlay(p);
  };

  // Gerbang fitur Premium: true jika boleh lanjut, false + tampilkan upgrade jika tidak.
  // Uses server-side check to prevent client-side bypass via state.stores manipulation.
  const requirePremium = async featureName => {
    if (_isSuperAdmin) return true;
    const serverResult = db ? await fetchSubscriptionFromServer() : null;
    // fail-closed: null (401 / network error) → treat as inactive
    const active = serverResult !== null ? serverResult.premiumActive : false;
    if (active) return true;
    showUpgradeOverlay('premium', featureName);
    return false;
  };
  // Gerbang fitur Bisnis (Multi-Cabang)
  const requireBusiness = async featureName => {
    if (_isSuperAdmin) return true;
    const serverResult = db ? await fetchSubscriptionFromServer() : null;
    const active = serverResult !== null ? serverResult.businessActive : false;
    if (active) return true;
    showUpgradeOverlay('business', featureName);
    return false;
  };

  // Banner: ingatkan trial premium akan habis (≤7 hari). Tidak pernah mengunci aplikasi.
  const checkSubscription = () => {
    const daysLeft = getSubscriptionDaysLeft();
    const banner = document.getElementById('subsBanner');
    if (daysLeft === null) return true;
    if (banner && daysLeft > 0 && daysLeft <= 7) {
      document.getElementById('subsBannerText').textContent =
        `Premium gratis Anda tersisa ${daysLeft} hari. Setelah itu fitur dasar tetap gratis.`;
      banner.classList.remove('hidden');
      document.body.style.paddingTop = '36px';
    }
    return true;
  };

  // ── QRIS Dinamis (Premium): konversi QRIS statis → dinamis bernominal ─────
  const crc16ccitt = str => {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  };

  // Parse payload EMV menjadi daftar [tag, value] level atas
  const parseEmv = payload => {
    const out = [];
    let i = 0;
    while (i + 4 <= payload.length) {
      const tag = payload.slice(i, i + 2);
      const len = parseInt(payload.slice(i + 2, i + 4), 10);
      if (isNaN(len)) break;
      out.push([tag, payload.slice(i + 4, i + 4 + len)]);
      i += 4 + len;
    }
    return out;
  };

  // Buat payload QRIS dinamis: tipe 12 + nominal (tag 54), CRC dihitung ulang
  const makeDynamicQris = (staticPayload, amount) => {
    try {
      const fields = parseEmv(staticPayload).filter(([t]) => t !== '63' && t !== '54');
      const emv = f => f[0] + String(f[1].length).padStart(2, '0') + f[1];
      let result = '';
      let amountInserted = false;
      fields.forEach(f => {
        if (f[0] === '01') f = ['01', '12']; // statis → dinamis
        // Tag 54 (nominal) harus berada sebelum tag 58 (negara)
        if (!amountInserted && Number(f[0]) > 54) {
          const amt = String(Math.round(amount));
          result += '54' + String(amt.length).padStart(2, '0') + amt;
          amountInserted = true;
        }
        result += emv(f);
      });
      result += '6304';
      return result + crc16ccitt(result);
    } catch (e) {
      return null;
    }
  };

  // Decode payload QR dari gambar (BarcodeDetector native, fallback jsQR)
  const decodeQrisImage = base64 => new Promise(resolve => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      // 1) BarcodeDetector native (Chrome Android/desktop)
      if ('BarcodeDetector' in window) {
        try {
          const detector = new BarcodeDetector({ formats: ['qr_code'] });
          const codes = await detector.detect(canvas);
          if (codes.length && codes[0].rawValue) return resolve(codes[0].rawValue);
        } catch (e) { /* lanjut ke jsQR */ }
      }
      // 2) jsQR fallback (lazy-load on first use)
      if (!window.jsQR) {
        try { await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'); } catch { /* skip */ }
      }
      if (window.jsQR) {
        try {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(data.data, data.width, data.height);
          if (code && code.data) return resolve(code.data);
        } catch (e) { /* gagal */ }
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = base64;
  });

  const getQrisPayload = () => localStorage.getItem('qris_payload') || '';

  // ── Supabase ──────────────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://pfmsblktxlnovtajnxvc.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_rF4Ul9n6WS4R00twmmCbdQ_wJ0KAOv6';
  let db = null;
  // Mode recovery: user datang dari link reset password. Jangan masuk dashboard
  // sebelum password baru dibuat — pemegang link tidak boleh dapat akses penuh.
  let passwordRecoveryMode = false;

  const initSupabase = () => {
    if (window.supabase) {
      // detectSessionInUrl WAJIB tetap true (biar link recovery/PKCE tetap
      // diproses SDK jadi sesi) TAPI passwordRecoveryMode sudah di-set (lihat
      // init()) SEBELUM baris ini jalan — jadi walau SDK sempat bikin sesi
      // penuh dari code=... di query string (PKCE flow), guard di
      // enterAppAfterAuth() sudah aktif duluan dan menahan dashboard.
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { detectSessionInUrl: true }
      });
      db.auth.onAuthStateChange((event, changedSession) => {
        if (event === 'PASSWORD_RECOVERY') {
          // Event ini bisa telat datang (setelah dashboard sempat mulai
          // render di edge case tertentu) — showNewPasswordForm() dipanggil
          // FORCE di sini (bukan cuma set flag) supaya dashboard yang
          // terlanjur tampil langsung disembunyikan lagi.
          passwordRecoveryMode = true;
          // Persist berbasis USER ID (bukan flag generik '1'): flag generik
          // tersimpan di localStorage yang SHARED antar semua tab origin ini,
          // jadi tab lain (user lain, sesi lain) ikut terkunci ke form
          // recovery kalau reload — regresi yang ditemukan QA. Dengan uid,
          // guard di init() hanya aktif kalau sesi AKTIF SEKARANG match
          // persis dengan uid yang tercatat.
          if (changedSession?.user?.id) {
            localStorage.setItem('pw_recovery_uid', changedSession.user.id);
          }
          showNewPasswordForm();
        }
      });
      return true;
    }
    return false;
  };

  let _logErrorCount = 0;

  const SENSITIVE_KEY_RE = /pass|password|token|secret|key|credential|pw/i;

  const sanitizeContext = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeContext);
    if (typeof obj !== 'object') return obj;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        result[k] = '[redacted]';
      } else {
        result[k] = sanitizeContext(v);
      }
    }
    return result;
  };

  const logError = async (message, context, err) => {
    console.error(message, context, err);
    if (_logErrorCount >= 10) return;
    _logErrorCount++;
    const truncate = (s, n) => s ? String(s).slice(0, n) : null;
    const payload = {
      store_id: state.storeId || null,
      user_email: state.authUser?.email || null,
      app_version: APP_VERSION,
      message: truncate(message, 1000),
      stack: truncate(err?.stack, 2000),
      url: location.origin + location.pathname,
      context: sanitizeContext(context) || null
    };
    if (!db) return;
    try {
      const { error: insertErr } = await db.from('error_logs').insert(payload);
      if (insertErr) console.warn('logError insert failed:', insertErr);
    } catch (e) {
      console.warn('logError insert failed:', e);
    }
  };

  // Supabase row → app product object
  const fromDbProduct = p => ({
    id: String(p.id),
    code: 'P' + String(p.id).padStart(3, '0'),
    barcode: p.barcode || '',
    name: p.name,
    category: p.category || 'Lainnya',
    price: Number(p.price) || 0,
    cost: Number(p.cost) || 0,
    stock: Number(p.stock) || 0,
    minStock: Number(p.min_stock) || 5,
    expiry_date: p.expiry_date || null,
    image: 'https://via.placeholder.com/260?text=' + encodeURIComponent(p.name)
  });

  // Supabase row → app cashier object
  const fromDbCashier = c => ({
    id: String(c.id),
    name: c.name,
    password: c.password || '1234',
    role: c.role || 'kasir'
  });

  // Supabase row → app purchase object
  const fromDbPurchase = p => ({
    id: p.id,
    supplier: p.supplier,
    date: p.created_at,
    total: Number(p.total),
    status: p.status || 'Diterima',
    items: (p.purchase_items || []).map(item => ({
      id: String(item.product_id || ''),
      name: item.product_name,
      qty: Number(item.quantity),
      price: Number(item.price),
      subtotal: Number(item.subtotal)
    }))
  });

  // Supabase row → app transaction object
  const fromDbTransaction = tx => ({
    id: 'INV' + tx.id,
    dbId: tx.id,
    date: tx.created_at,
    cashier: tx.cashier_name || 'Kasir',
    items: (tx.transaction_items || []).map(item => ({
      id: String(item.product_id || ''),
      name: item.product_name,
      qty: Number(item.quantity),
      price: Number(item.price_at_sale),
      cost: 0,
      subtotal: Number(item.subtotal)
    })),
    subtotal: Number(tx.total_amount),
    discount: Number(tx.discount_amount) || 0,
    tax: 0,
    total: Number(tx.total_amount),
    cash: Number(tx.payment_amount),
    change: Number(tx.change_amount),
    paymentMethod: tx.payment_method || 'Tunai',
    confirmedBy: tx.confirmed_by || null,
    confirmedAt: tx.confirmed_at || null,
    status: tx.status || 'completed',
    voidReason: tx.void_reason || null,
    voidBy: tx.void_by || null,
    voidAt: tx.void_at || null,
    shiftId: tx.shift_id || null,
    paymentCashAmount: Number(tx.payment_cash_amount) || 0,
    paymentNoncashAmount: Number(tx.payment_noncash_amount) || 0
  });

  // ── Session ───────────────────────────────────────────────────────────────
  // ── Auth (Supabase) ───────────────────────────────────────────────────────
  const getAuthSession = async () => {
    if (!db) return null;
    const { data } = await db.auth.getSession();
    return data?.session || null;
  };

  // Login toko via email + password
  const handleLogin = async (email, password) => {
    if (!db) return { error: 'Database tidak tersedia.' };
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return { error: terjemahAuthError(error.message) };
    state.authUser = data.user;
    return { user: data.user };
  };

  // Daftar toko baru: buat akun auth + store + admin cashier
  const handleRegister = async ({ storeName, ownerName, email, password, pin }) => {
    if (!db) return { error: 'Database tidak tersedia.' };
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) return { error: terjemahAuthError(error.message) };
    if (!data.user) return { error: 'Gagal membuat akun.' };

    // Pastikan ada sesi aktif (email confirmation harus dimatikan di Supabase)
    let session = data.session;
    if (!session) {
      const res = await db.auth.signInWithPassword({ email, password });
      if (res.error) {
        return { needConfirm: true };
      }
      session = res.data.session;
    }
    state.authUser = data.user;

    // Buat record toko
    const { data: store, error: sErr } = await db.from('stores')
      .insert({ owner_id: data.user.id, name: storeName.trim() })
      .select().single();
    if (sErr) return { error: 'Gagal membuat toko: ' + sErr.message };

    // Buat kasir admin (pemilik) dengan PIN custom
    const { error: cashierErr } = await db.from('cashiers').insert({
      store_id: store.id, name: ownerName.trim(), password: pin || '1234', role: 'admin'
    });
    if (cashierErr) logError('cashier insert gagal', { storeId: state.storeId }, cashierErr);

    return { user: data.user, store };
  };

  const terjemahAuthError = msg => {
    const m = (msg || '').toLowerCase();
    if (m.includes('invalid login')) return 'Email atau password salah.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'Email sudah terdaftar. Silakan masuk.';
    if (m.includes('password should be at least')) return 'Password minimal 8 karakter.';
    if (m.includes('same as the old password') || m.includes('different from the old')) return 'Password baru tidak boleh sama dengan password lama.';
    if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Format email tidak valid.';
    if (m.includes('email not confirmed')) return 'Email belum dikonfirmasi.';
    if (m.includes('failed to fetch') || m.includes('network')) return 'Koneksi bermasalah. Periksa internet lalu coba lagi.';
    // Jangan tampilkan pesan mentah dari server ke user (bisa memuat detail teknis)
    if (msg) logError('Auth error tanpa terjemahan', { pesan: String(msg).slice(0, 120) }, null);
    return 'Terjadi kesalahan. Coba lagi.';
  };

  const friendlyError = err => {
    const code = err?.code || '';
    const msg = (err?.message || String(err || '')).toLowerCase();
    if (code === '23505' || msg.includes('duplicate key')) return 'Data sudah ada, tidak bisa duplikat.';
    if (code === '23503' || msg.includes('foreign key')) return 'Data terhubung ke data lain, tidak bisa dihapus dulu.';
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('timeout')) return 'Koneksi bermasalah. Pastikan internet aktif dan coba lagi.';
    return 'Terjadi kesalahan. Coba lagi, atau hubungi tim kami jika masalah berlanjut.';
  };

  const showLoginPage = () => {
    const lp = document.getElementById('loginPage');
    lp.classList.remove('hidden');
    lp.style.display = 'flex';
    document.getElementById('appContainer').classList.add('hidden');
    document.getElementById('appContainer').style.display = 'none';
    document.getElementById('helpChatFab')?.classList.add('hidden');
    document.getElementById('helpChatPanel')?.classList.add('hidden');
  };

  const showNewPasswordForm = () => {
    // Urutan penting untuk cegah flicker: siapkan SEMUA visibilitas screen
    // final (form recovery) DULU, baru overlay loading di-fade di ATASNYA.
    // Kalau overlay dilepas duluan, ada frame di mana overlay transparan
    // tapi konten di baliknya masih login form biasa (belum newPasswordForm).
    showLoginPage();
    document.getElementById('loginForm2')?.classList.add('hidden');
    document.getElementById('registerForm')?.classList.add('hidden');
    document.getElementById('tabLogin')?.parentElement?.classList.add('hidden');
    document.getElementById('newPasswordForm')?.classList.remove('hidden');
    hideLoadingOverlay();
  };

  const hideNewPasswordForm = () => {
    document.getElementById('newPasswordForm')?.classList.add('hidden');
    document.getElementById('loginForm2')?.classList.remove('hidden');
    document.getElementById('tabLogin')?.parentElement?.classList.remove('hidden');
  };

  const showApp = () => {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('loginPage').classList.add('hidden');
    const app = document.getElementById('appContainer');
    app.classList.remove('hidden');
    app.style.display = 'flex';
  };

  const showAppToast = (text, type = 'info') => {
    let toast = document.getElementById('appGlobalToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appGlobalToast';
      toast.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[300] rounded-lg px-5 py-3 text-white text-sm font-semibold shadow-sm no-print';
      document.body.appendChild(toast);
    }
    const bgMap = { error: '#e11d48', success: '#059669', info: '#334155' };
    toast.style.background = bgMap[type] || bgMap.info;
    toast.textContent = text;
    // Soft Paper: enter dari bawah, exit lembut
    toast.classList.remove('toast-exit');
    toast.classList.remove('toast-enter');
    // reflow agar animasi enter bisa di-replay
    void toast.offsetWidth;
    toast.classList.add('toast-enter');
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('toast-enter');
      toast.classList.add('toast-exit');
    }, 4000);
  };

  // Setelah login: pemilik toko selalu admin (akses penuh)
  const ADMIN_SCREENS = ['dashboard', 'inventory', 'pembelian', 'kelolaKasir', 'pengaturan'];

  // Hak akses mengikuti OPERATOR yang sedang aktif (admin = semua menu, kasir = terbatas)
  const applyRoleAccess = () => {
    const active = state.cashiers.find(c => c.id === state.selectedCashierId)
      || state.cashiers.find(c => c.role === 'admin') || state.cashiers[0];
    const isAdmin = !active || active.role === 'admin';
    const name = active?.name || state.store?.name || 'Pemilik';
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    const avatar = document.getElementById('userAvatar');
    if (nameEl) nameEl.textContent = name;
    if (roleEl) {
      roleEl.innerHTML = isAdmin ? iconText('crown', 'Admin Toko', 'icon icon-sm') : iconText('receipt', 'Kasir', 'icon icon-sm');
      roleEl.className = isAdmin
        ? 'text-xs px-2 py-0.5 rounded-full bg-primary-active text-white/70'
        : 'text-xs px-2 py-0.5 rounded-full bg-ink text-muted-soft';
    }
    if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    const mobileNameEl = document.getElementById('mobileUserName');
    const mobileRoleEl = document.getElementById('mobileUserRole');
    const mobileAvatar = document.getElementById('mobileUserAvatar');
    if (mobileNameEl) mobileNameEl.textContent = name;
    if (mobileRoleEl) {
      mobileRoleEl.innerHTML = isAdmin ? iconText('crown', 'Admin Toko', 'icon icon-sm') : iconText('receipt', 'Kasir', 'icon icon-sm');
      mobileRoleEl.className = isAdmin
        ? 'text-xs px-2 py-0.5 rounded-full bg-primary-active text-white/70'
        : 'text-xs px-2 py-0.5 rounded-full bg-ink text-muted-soft';
    }
    if (mobileAvatar) mobileAvatar.textContent = name.charAt(0).toUpperCase();
    // Sidebar + bottom nav: menu admin disembunyikan untuk operator kasir
    document.querySelectorAll('[data-role="admin"]').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });
    const wrapper = document.getElementById('cashierSelectWrapper');
    if (wrapper) wrapper.style.display = '';
    renderStoreSwitcher();
    applySuperAdminVisibility();
  };

  const logout = async () => {
    if (!confirm('Yakin ingin keluar dari toko?')) return;
    if (db) await db.auth.signOut();
    state.authUser = null;
    state.store = null;
    state.storeId = null;
    state.cart = {};
    state.cashAmount = 0;
    state.cashiers = [];
    state.selectedCashierId = '';
    state.activeUserId = '';
    state.products = [];
    state.transactions = [];
    state.purchases = [];
    state.debts = [];
    state.stores = [];
    state.draftPurchase = null;
    state.shiftStartTime = null;
    state.currentTransaction = null;
    _subsCacheResult = null;
    _isSuperAdmin = false;
    Object.values(STORAGE).forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('pos_debts');
    localStorage.removeItem('pos_last_user_id');
    localStorage.removeItem('qris_image');
    localStorage.removeItem('qris_payload');
    localStorage.removeItem('offline_tx_queue');
    localStorage.removeItem('debt_queue');
    localStorage.removeItem('pending_subs_order');
    localStorage.removeItem('pw_recovery_uid');
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('active_store_') || k.startsWith('shift_start_') || k.startsWith('onboardingDone_')) {
        localStorage.removeItem(k);
      }
    });
    showLoginPage();
  };
  // ─────────────────────────────────────────────────────────────────────────

  const setLoadingStatus = (msg, pct) => {
    const el = document.getElementById('loadingStatus');
    const bar = document.getElementById('loadingBar');
    if (el) el.textContent = msg;
    if (bar) bar.style.width = pct + '%';
  };

  const hideLoadingOverlay = () => {
    const el = document.getElementById('loadingOverlay');
    if (!el) return;
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    setTimeout(() => el.remove(), 400);
  };
  // ─────────────────────────────────────────────────────────────────────────

  const sampleProducts = [
    { id: 'P001', code: 'P001', barcode: '8991234000011', name: 'Nasi Goreng Spesial', category: 'Makanan', price: 22000, cost: 14000, stock: 12, image: 'https://via.placeholder.com/260?text=Nasi+Goreng' },
    { id: 'P002', code: 'P002', barcode: '8991234000028', name: 'Es Teh Manis', category: 'Minuman', price: 8000, cost: 2500, stock: 20, image: 'https://via.placeholder.com/260?text=Es+Teh' },
    { id: 'P003', code: 'P003', barcode: '8991234000035', name: 'Beras 5kg', category: 'Sembako', price: 65000, cost: 53000, stock: 8, image: 'https://via.placeholder.com/260?text=Beras' },
    { id: 'P004', code: 'P004', barcode: '8991234000042', name: 'Pensil 2B', category: 'ATK', price: 1500, cost: 700, stock: 25, image: 'https://via.placeholder.com/260?text=Pensil' },
    { id: 'P005', code: 'P005', barcode: '8991234000059', name: 'Roti Tawar', category: 'Makanan', price: 12000, cost: 7000, stock: 5, image: 'https://via.placeholder.com/260?text=Roti+Tawar' },
    { id: 'P006', code: 'P006', barcode: '8991234000066', name: 'Mineral Water', category: 'Minuman', price: 5000, cost: 2000, stock: 30, image: 'https://via.placeholder.com/260?text=Air+Mineral' }
  ];

  const sampleCashiers = [
    { id: 'C001', name: 'Kasir A', password: '1234' },
    { id: 'C002', name: 'Kasir B', password: '1234' }
  ];

  const state = {
    products: [],
    transactions: [],
    purchases: [],
    cashiers: [],
    cart: {},
    selectedCategory: 'All',
    searchQuery: '',
    historySearch: '',
    discountPercent: 0,
    discountNominal: 0,
    cashAmount: 0,
    reportRange: '7',
    selectedCashierId: '',
    activeUserId: '',
    debts: [],
    currentTransaction: null,
    draftPurchase: { supplier: '', invoice: '', items: [] },
    scannerContext: 'kasir',
    scannerStream: null,
    scannerDetector: null,
    scannerRAF: null,
    scannerEngine: null,
    authUser: null,
    store: null,
    storeId: null,
    stores: [],
    paymentMethod: 'Tunai',
    shiftStartTime: null
  };

  const dom = {
    screens: document.querySelectorAll('.screen'),
    menuButtons: document.querySelectorAll('.menu-btn'),
    todayDate: document.getElementById('todayDate'),
    statSalesToday: document.getElementById('statSalesToday'),
    statProductsSold: document.getElementById('statProductsSold'),
    statProfit: document.getElementById('statProfit'),
    salesChart: document.getElementById('salesChart'),
    searchInput: document.getElementById('searchInput'),
    categoryFilter: document.getElementById('categoryFilter'),
    productGrid: document.getElementById('productGrid'),
    cartList: document.getElementById('cartList'),
    cartCount: document.getElementById('cartCount'),
    cartSubtotal: document.getElementById('cartSubtotal'),
    cartTax: document.getElementById('cartTax'),
    cartTotal: document.getElementById('cartTotal'),
    discountPercent: document.getElementById('discountPercent'),
    discountNominal: document.getElementById('discountNominal'),
    cashInput: document.getElementById('cashInput'),
    cashChange: document.getElementById('cashChange'),
    payButton: document.getElementById('payButton'),
    printButton: document.getElementById('printButton'),
    inventoryTable: document.getElementById('inventoryTable'),
    addProductButton: document.getElementById('addProductButton'),
    inventoryModal: document.getElementById('inventoryModal'),
    inventoryModalTitle: document.getElementById('inventoryModalTitle'),
    closeInventoryModal: document.getElementById('closeInventoryModal'),
    cancelInventory: document.getElementById('cancelInventory'),
    inventoryForm: document.getElementById('inventoryForm'),
    productId: document.getElementById('productId'),
    productCode: document.getElementById('productCode'),
    productName: document.getElementById('productName'),
    productCategory: document.getElementById('productCategory'),
    productPrice: document.getElementById('productPrice'),
    productCost: document.getElementById('productCost'),
    productStock: document.getElementById('productStock'),
    productImage: document.getElementById('productImage'),
    historyTable: document.getElementById('historyTable'),
    cashierSelect: document.getElementById('cashierSelect'),
    reportRangeSelect: document.getElementById('reportRangeSelect'),
    reportSales: document.getElementById('reportSales'),
    reportTransactions: document.getElementById('reportTransactions'),
    reportItemsSold: document.getElementById('reportItemsSold'),
    exportInventory: document.getElementById('exportInventory'),
    exportHistory: document.getElementById('exportHistory'),
    exportPurchase: document.getElementById('exportPurchase'),
    exportDataButton: document.getElementById('exportDataButton'),
    importDataButton: document.getElementById('importDataButton'),
    backupFileInput: document.getElementById('backupFileInput'),
    historySearchInput: document.getElementById('historySearchInput'),
    purchaseTable: document.getElementById('purchaseTable'),
    addPurchaseButton: document.getElementById('addPurchaseButton'),
    purchaseModal: document.getElementById('purchaseModal'),
    closePurchaseModal: document.getElementById('closePurchaseModal'),
    cancelPurchase: document.getElementById('cancelPurchase'),
    purchaseSupplier: document.getElementById('purchaseSupplier'),
    purchaseInvoice: document.getElementById('purchaseInvoice'),
    purchaseProduct: document.getElementById('purchaseProduct'),
    purchaseCost: document.getElementById('purchaseCost'),
    purchaseQty: document.getElementById('purchaseQty'),
    addPurchaseItem: document.getElementById('addPurchaseItem'),
    purchaseItemsList: document.getElementById('purchaseItemsList'),
    purchaseTotal: document.getElementById('purchaseTotal'),
    savePurchase: document.getElementById('savePurchase'),
    lowStockAlert: document.getElementById('lowStockAlert'),
    topProduct: document.getElementById('topProduct'),
    topCategory: document.getElementById('topCategory'),
    profitMargin: document.getElementById('profitMargin'),
    purchaseTable: document.getElementById('purchaseTable'),
    addPurchaseButton: document.getElementById('addPurchaseButton'),
    cashierGrid: document.getElementById('cashierGrid'),
    addCashierBtn: document.getElementById('addCashierBtn'),
    cashierModal: document.getElementById('cashierModal'),
    closeCashierModal: document.getElementById('closeCashierModal'),
    cancelCashierModal: document.getElementById('cancelCashierModal'),
    cashierForm: document.getElementById('cashierForm'),
    cashierFormId: document.getElementById('cashierFormId'),
    cashierFormName: document.getElementById('cashierFormName'),
    cashierFormPassword: document.getElementById('cashierFormPassword'),
    cashierFormRole: document.getElementById('cashierFormRole'),
    cashierFormError: document.getElementById('cashierFormError'),
    cashierPasswordHint: document.getElementById('cashierPasswordHint'),
    cashierModalTitle: document.getElementById('cashierModalTitle'),
    statTotalCashier: document.getElementById('statTotalCashier'),
    statTotalAdmin: document.getElementById('statTotalAdmin'),
    statTotalKasir: document.getElementById('statTotalKasir'),
    loginModal: document.getElementById('loginModal'),
    loginForm: document.getElementById('loginForm'),
    loginName: document.getElementById('loginName'),
    loginPassword: document.getElementById('loginPassword'),
    loginCancel: document.getElementById('loginCancel'),
    scannerModal: document.getElementById('scannerModal'),
    scanButton: document.getElementById('scanButton'),
    closeScanner: document.getElementById('closeScanner'),
    startScanner: document.getElementById('startScanner'),
    stopScanner: document.getElementById('stopScanner'),
    scannerStatus: document.getElementById('scannerStatus'),
    scannerSubtitle: document.getElementById('scannerSubtitle'),
    scannerArea: document.getElementById('scannerArea'),
    scannerVideo: document.getElementById('scannerVideo'),
    scannerScanLine: document.getElementById('scannerScanLine'),
    scannerPlaceholder: document.getElementById('scannerPlaceholder'),
    scannerResult: document.getElementById('scannerResult'),
    scannerResultName: document.getElementById('scannerResultName'),
    scannerResultCode: document.getElementById('scannerResultCode'),
    scannerNotFound: document.getElementById('scannerNotFound'),
    scannerNotFoundCode: document.getElementById('scannerNotFoundCode'),
    manualBarcodeInput: document.getElementById('manualBarcodeInput'),
    manualBarcodeSubmit: document.getElementById('manualBarcodeSubmit'),
    barcodeInput: document.getElementById('barcodeInput'),
    productBarcode: document.getElementById('productBarcode'),
    inventoryScanButton: document.getElementById('inventoryScanButton'),
    receiptModal: document.getElementById('receiptModal'),
    closeReceipt: document.getElementById('closeReceipt'),
    closeReceiptBottom: document.getElementById('closeReceiptBottom'),
    printReceipt: document.getElementById('printReceipt'),
    receiptDate: document.getElementById('receiptDate'),
    receiptId: document.getElementById('receiptId'),
    receiptCashierName: document.getElementById('receiptCashierName'),
    receiptStoreName: document.getElementById('receiptStoreName'),
    receiptStoreAddress: document.getElementById('receiptStoreAddress'),
    receiptStorePhone: document.getElementById('receiptStorePhone'),
    receiptStoreNote: document.getElementById('receiptStoreNote'),
    receiptDiscountRow: document.getElementById('receiptDiscountRow'),
    receiptTaxRow: document.getElementById('receiptTaxRow'),
    receiptItems: document.getElementById('receiptItems'),
    receiptSubtotal: document.getElementById('receiptSubtotal'),
    receiptDiscount: document.getElementById('receiptDiscount'),
    receiptTax: document.getElementById('receiptTax'),
    receiptTotal: document.getElementById('receiptTotal'),
    receiptCash: document.getElementById('receiptCash'),
    receiptChange: document.getElementById('receiptChange'),
    printThermalBtn: document.getElementById('printThermalBtn'),
    settingStoreName: document.getElementById('settingStoreName'),
    settingStoreAddress: document.getElementById('settingStoreAddress'),
    settingStorePhone: document.getElementById('settingStorePhone'),
    settingStoreNote: document.getElementById('settingStoreNote'),
    settingPaperSize: document.getElementById('settingPaperSize'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    settingsSaved: document.getElementById('settingsSaved'),
    previewStoreName: document.getElementById('previewStoreName'),
    previewStoreAddress: document.getElementById('previewStoreAddress'),
    previewStorePhone: document.getElementById('previewStorePhone'),
    previewStoreNote: document.getElementById('previewStoreNote'),
    productMinStock: document.getElementById('productMinStock'),
    tutupKasirBtn: document.getElementById('tutupKasirBtn'),
    shiftModal: document.getElementById('shiftModal'),
    closeShiftModal: document.getElementById('closeShiftModal'),
    cancelShiftModal: document.getElementById('cancelShiftModal'),
    printShiftBtn: document.getElementById('printShiftBtn'),
    resetShiftBtn: document.getElementById('resetShiftBtn'),
    shiftCashierName: document.getElementById('shiftCashierName'),
    shiftTxCount: document.getElementById('shiftTxCount'),
    shiftTotalSales: document.getElementById('shiftTotalSales'),
    shiftItemsSold: document.getElementById('shiftItemsSold'),
    shiftModalSubtitle: document.getElementById('shiftModalSubtitle'),
    exportPdfBtn: document.getElementById('exportPdfBtn'),
    onboardingOverlay: document.getElementById('onboardingOverlay'),
    cashInputWrapper: document.getElementById('cashInputWrapper'),
    forgotPasswordBtn: document.getElementById('forgotPasswordBtn'),
    forgotPasswordForm: document.getElementById('forgotPasswordForm'),
    resetEmail: document.getElementById('resetEmail'),
    sendResetBtn: document.getElementById('sendResetBtn'),
    paymentConfirmModal: document.getElementById('paymentConfirmModal'),
    closePaymentConfirmModal: document.getElementById('closePaymentConfirmModal'),
    paymentConfirmMethod: document.getElementById('paymentConfirmMethod'),
    paymentConfirmTotal: document.getElementById('paymentConfirmTotal'),
    paymentConfirmCashier: document.getElementById('paymentConfirmCashier'),
    paymentConfirmOk: document.getElementById('paymentConfirmOk'),
    paymentConfirmCancel: document.getElementById('paymentConfirmCancel'),
    deleteAccountBtn: document.getElementById('deleteAccountBtn'),
    deleteAccountModal: document.getElementById('deleteAccountModal'),
    closeDeleteAccountModal: document.getElementById('closeDeleteAccountModal'),
    cancelDeleteAccountModal: document.getElementById('cancelDeleteAccountModal'),
    deleteAccountEmailInput: document.getElementById('deleteAccountEmailInput'),
    deleteAccountConfirmBtn: document.getElementById('deleteAccountConfirmBtn'),
    deleteAccountError: document.getElementById('deleteAccountError')
  };

  let chartInstance = null;

  const _currencyFormatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  const formatCurrency = value => _currencyFormatter.format(value);

  // Tanggal "YYYY-MM-DD" menurut ZONA WAKTU LOKAL perangkat (bukan UTC),
  // agar penjualan dini hari (mis. 00:00–07:00 WIB) tidak terhitung ke hari kemarin.
  const localDay = d => {
    const x = (d instanceof Date) ? d : new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  // Awal hari ini (00:00) waktu lokal, sebagai objek Date.
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  const loadLocalSettings = () => {
    const settingsData = localStorage.getItem(STORAGE.settings);
    let settings = {};
    try {
      settings = settingsData ? JSON.parse(settingsData) : {};
    } catch (e) {
      logError('loadLocalSettings: settings corrupt', { key: STORAGE.settings }, e);
      localStorage.removeItem(STORAGE.settings);
      settings = {};
    }
    state.reportRange = settings.reportRange || '7';
    state.historySearch = settings.historySearch || '';
    // cashiers & purchases now loaded from Supabase; these are temp fallbacks
    const cashiersData = localStorage.getItem(STORAGE.cashiers);
    const purchasesData = localStorage.getItem(STORAGE.purchases);
    try {
      state.cashiers = cashiersData ? JSON.parse(cashiersData) : sampleCashiers;
    } catch (e) {
      logError('loadLocalSettings: cashiers corrupt', { key: STORAGE.cashiers }, e);
      localStorage.removeItem(STORAGE.cashiers);
      state.cashiers = sampleCashiers;
    }
    try {
      state.purchases = purchasesData ? JSON.parse(purchasesData) : [];
    } catch (e) {
      logError('loadLocalSettings: purchases corrupt', { key: STORAGE.purchases }, e);
      localStorage.removeItem(STORAGE.purchases);
      state.purchases = [];
    }
    state.selectedCashierId = settings.selectedCashierId || state.cashiers[0]?.id || '';
    state.activeUserId = settings.activeUserId || state.selectedCashierId;
  };

  // Kunci localStorage untuk menyimpan cabang aktif terakhir (per akun)
  const activeStoreKey = () => 'active_store_' + (state.authUser?.id || '');

  // Memuat SELURUH toko/cabang milik user, lalu menetapkan cabang aktif
  const loadStore = async () => {
    // Invalidate server-side subscription cache so the next requirePremium/requireBusiness
    // call always fetches fresh data from the Edge Function.
    invalidateSubscriptionCache();
    const { data, error } = await db.from('stores').select('*').order('created_at', { ascending: true });
    if (error) { console.warn('loadStore error:', error); return null; }
    state.stores = data || [];

    // Force service worker update for new deployments
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
          registration.update();
        }
      });
    }

    if (!state.stores.length) { state.store = null; state.storeId = null; return null; }

    // Pilih cabang aktif: yang terakhir dipilih (jika masih ada) atau cabang pertama
    const savedId = localStorage.getItem(activeStoreKey());
    let active = state.stores.find(s => String(s.id) === String(savedId)) || state.stores[0];
    // Jika paket Bisnis tidak aktif, kunci ke toko utama (cabang lain tidak bisa dibuka)
    const primary = state.stores.find(s => s.is_main) || state.stores[0];
    // Cek bisnis langsung dari data primary yang baru di-fetch (hindari dead-code via cache yang sudah diinvalidasi)
    const _now = Date.now();
    const _bizExpiries = ['trial_ends_at', 'business_until'].map(c => primary[c]).filter(Boolean).map(d => new Date(d).getTime());
    const bizActiveForLoad = _bizExpiries.length === 0 ? true : Math.max(..._bizExpiries) > _now;
    // Super admin bebas pindah cabang tanpa gate langganan (sama seperti bypass di requireBusiness)
    if (!_isSuperAdmin && !bizActiveForLoad && String(active.id) !== String(primary.id)) {
      active = primary;
    }
    state.store = active;
    state.storeId = active.id;
    localStorage.setItem(activeStoreKey(), String(active.id));

    // Sinkron QRIS dari cloud ke perangkat ini (cloud = sumber utama), per cabang aktif
    if (active.qris_image) {
      localStorage.setItem('qris_image', active.qris_image);
      if (active.qris_payload) localStorage.setItem('qris_payload', active.qris_payload);
      else localStorage.removeItem('qris_payload');
    } else {
      localStorage.removeItem('qris_image');
      localStorage.removeItem('qris_payload');
    }
    return active;
  };

  // Simpan QRIS ke cloud agar tersinkron antar perangkat (abaikan jika kolom belum ada)
  const saveQrisToCloud = async (image, payload) => {
    if (!db || !state.storeId) return;
    const { error } = await db.from('stores')
      .update({ qris_image: image || null, qris_payload: payload || null })
      .eq('id', state.storeId);
    if (error) console.warn('QRIS tidak tersimpan ke cloud (jalankan 04_final_sync.sql):', error.message);
    else if (state.store) { state.store.qris_image = image; state.store.qris_payload = payload; }
  };

  // Memuat seluruh data toko (dipanggil SETELAH login berhasil)
  const loadData = async () => {
    const lastUserId = localStorage.getItem('pos_last_user_id');
    if (lastUserId !== state.authUser?.id) {
      [...Object.values(STORAGE), 'pos_debts', 'qris_image', 'qris_payload', 'offline_tx_queue', 'debt_queue', 'pending_subs_order']
        .forEach(key => localStorage.removeItem(key));
      _isSuperAdmin = false;
    }
    localStorage.setItem('pos_last_user_id', state.authUser?.id ?? '');
    loadLocalSettings();

    setLoadingStatus('Memuat data toko...', 25);
    await loadStore();
    if (!state.storeId) {
      // User login tapi belum punya toko (kasus langka) — kosongkan
      state.products = []; state.transactions = []; state.cashiers = []; state.purchases = [];
      return;
    }

    // Kirim transaksi offline yang tertunda SEBELUM memuat data,
    // agar stok & riwayat yang dimuat sudah termasuk transaksi tersebut
    await flushOfflineQueue();
    await flushDebtQueue();

    try {
      setLoadingStatus('Memuat produk...', 40);
      const { data: products, error: pErr } = await db
        .from('products').select('*').eq('store_id', state.storeId).order('id', { ascending: true });
      if (pErr) throw pErr;
      state.products = products ? products.map(fromDbProduct) : [];

      setLoadingStatus('Memuat kasir...', 55);
      const { data: cashiers } = await db
        .from('cashiers').select('*').eq('store_id', state.storeId).order('id', { ascending: true });
      state.cashiers = cashiers ? cashiers.map(fromDbCashier) : [];
      // Pengaman data lama: minimal harus ada satu admin agar pemilik tidak terkunci
      if (state.cashiers.length && !state.cashiers.some(c => c.role === 'admin')) {
        state.cashiers[0].role = 'admin';
      }
      // Pulihkan operator terakhir (agar kasir tidak naik jadi admin hanya dengan reload)
      const savedOp = state.cashiers.find(c => c.id === state.selectedCashierId);
      state.selectedCashierId = (savedOp || state.cashiers.find(c => c.role === 'admin') || state.cashiers[0])?.id || '';
      state.activeUserId = state.selectedCashierId;

      setLoadingStatus('Memuat transaksi...', 70);
      const { data: transactions, error: tErr } = await db
        .from('transactions').select('*, transaction_items(*)')
        .eq('store_id', state.storeId)
        .order('created_at', { ascending: false }).limit(500);
      if (tErr) throw tErr;
      state.transactions = transactions ? transactions.map(fromDbTransaction) : [];

      setLoadingStatus('Memuat pembelian...', 85);
      const { data: purchases } = await db
        .from('purchases').select('*, purchase_items(*)')
        .eq('store_id', state.storeId)
        .order('created_at', { ascending: false }).limit(200);
      state.purchases = purchases ? purchases.map(fromDbPurchase) : [];

      // Kasbon (tabel bisa belum ada jika 05_kasbon.sql belum dijalankan)
      const { data: debts, error: dErr } = await db
        .from('debts').select('*').eq('store_id', state.storeId)
        .order('created_at', { ascending: false }).limit(500);
      if (dErr) {
        logError('loadData: gagal memuat kasbon', { storeId: state.storeId }, dErr);
        try { state.debts = JSON.parse(localStorage.getItem('pos_debts') || '[]'); } catch { state.debts = []; }
      } else {
        // Antrean kasbon offline tetap tampil di atas data server sampai tersinkron
        state.debts = [...getDebtQueue(), ...(debts || [])];
      }

      setLoadingStatus('Siap!', 100);
    } catch (err) {
      logError('loadData: gagal memuat data toko', { storeId: state.storeId }, err);
      showAppToast('Gagal memuat data toko. Coba refresh halaman.', 'error');
      state.products = [];
      state.transactions = [];
      state.cashiers = [];
      state.purchases = [];
      state.debts = [];
    }

    syncStorage();
  };

  let _syncStorageTimer = null;
  const syncStorage = () => {
    clearTimeout(_syncStorageTimer);
    _syncStorageTimer = setTimeout(() => {
      localStorage.setItem(STORAGE.products, JSON.stringify(state.products));
      localStorage.setItem(STORAGE.transactions, JSON.stringify(state.transactions));
      localStorage.setItem(STORAGE.cashiers, JSON.stringify(state.cashiers.map(({ password: _pw, ...rest }) => rest)));
      localStorage.setItem(STORAGE.purchases, JSON.stringify(state.purchases));
      localStorage.setItem(STORAGE.settings, JSON.stringify({
        selectedCashierId: state.selectedCashierId,
        activeUserId: state.activeUserId,
        reportRange: state.reportRange,
        historySearch: state.historySearch
      }));
    }, 300);
  };

  // ── Multi-Cabang (Premium) ───────────────────────────────────────────────
  // Render dropdown pemilih cabang di header. Hanya tampil bila punya >1 toko.
  const renderStoreSwitcher = () => {
    const wrap = document.getElementById('storeSwitcherWrapper');
    const sel = document.getElementById('storeSwitcher');
    if (!wrap || !sel) return;
    const active = state.cashiers.find(c => c.id === state.selectedCashierId);
    const isAdmin = !active || active.role === 'admin';
    // Switcher hanya berguna untuk pemilik/admin dan saat ada lebih dari satu cabang
    if (!isAdmin || (state.stores || []).length < 2) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    sel.innerHTML = state.stores.map(s =>
      `<option value="${esc(s.id)}">${esc(s.name || 'Toko')}${s.is_main ? ' (Pusat)' : ''}</option>`
    ).join('');
    sel.value = String(state.storeId);
  };

  // Pindah cabang aktif: simpan pilihan, muat ulang data cabang tsb, render ulang
  const switchStore = async id => {
    if (String(id) === String(state.storeId)) return;
    const target = (state.stores || []).find(s => String(s.id) === String(id));
    if (!target) return;
    // Kunci cabang non-utama jika paket Bisnis tidak aktif (trial habis & belum bayar)
    const primaryId = String(primaryStore()?.id);
    if (String(id) !== primaryId && !await requireBusiness('Mengakses cabang selain toko utama')) {
      const sel = document.getElementById('storeSwitcher');
      if (sel) sel.value = String(state.storeId); // kembalikan pilihan dropdown
      return;
    }
    localStorage.setItem(activeStoreKey(), String(id));
    state.cart = {}; state.cashAmount = 0; // keranjang tidak boleh terbawa antar cabang
    setLoadingStatus && setLoadingStatus('Memuat cabang ' + (target.name || '') + '...', 10);
    try {
      await loadData();
    } catch (e) {
      logError('switchStore loadData gagal', { storeId: id }, e);
    }
    if (String(state.storeId) !== String(id)) {
      // Perpindahan tidak jadi (mis. error jaringan atau snap-back langganan) — beri tahu user & revert dropdown
      showAppToast('Gagal pindah cabang. Coba lagi.', 'error');
      if (state.storeId) localStorage.setItem(activeStoreKey(), String(state.storeId));
      const sel = document.getElementById('storeSwitcher');
      if (sel) sel.value = String(state.storeId);
    }
    applyRoleAccess();
    renderAll();
    renderStoreSwitcher();
    const dash = document.getElementById('dashboard');
    if (dash && !dash.classList.contains('hidden')) renderDashboardPusat();
  };

  // Tambah cabang baru (Premium). Gratis dibatasi 1 toko.
  const addBranch = async () => {
    if ((state.stores || []).length >= 1 && !await requireBusiness('Multi-cabang (lebih dari 1 toko)')) return;
    const name = (prompt('Nama cabang baru:') || '').trim();
    if (!name) return;
    let pin = prompt('Masukkan PIN untuk admin cabang baru:', '');
    if (pin === null) return;
    pin = pin.trim();
    if (!pin) { alert('PIN wajib diisi! Penambahan cabang dibatalkan.'); return; }
    if (!db || !state.authUser) { alert('Fitur cabang membutuhkan koneksi & login.'); return; }
    const { data: store, error } = await db.from('stores')
      .insert({ owner_id: state.authUser.id, name }).select().single();
    if (error || !store) { alert('Gagal membuat cabang: ' + friendlyError(error)); return; }
    // Buat admin default untuk cabang baru agar langsung bisa dipakai
    const { error: branchCashierErr } = await db.from('cashiers').insert({
      store_id: store.id, name: 'Pemilik', password: pin, role: 'admin'
    });
    if (branchCashierErr) logError('cashier insert gagal', { storeId: state.storeId }, branchCashierErr);
    state.stores.push(store);
    alert('Cabang "' + name + '" dibuat. PIN admin: ' + pin);
    await switchStore(store.id);
    renderBranchList();
  };

  // Ganti nama cabang
  const renameBranch = async id => {
    const s = (state.stores || []).find(x => String(x.id) === String(id));
    if (!s) return;
    const name = (prompt('Nama baru cabang:', s.name || '') || '').trim();
    if (!name || name === s.name) return;
    const { error } = await db.from('stores').update({ name }).eq('id', id);
    if (error) { alert('Gagal mengubah nama: ' + friendlyError(error)); return; }
    s.name = name;
    if (String(id) === String(state.storeId) && state.store) state.store.name = name;
    renderBranchList();
    renderStoreSwitcher();
    renderSettings();
  };

  // Hapus cabang (beserta seluruh datanya). Cabang terakhir tidak boleh dihapus.
  const deleteBranch = async id => {
    if ((state.stores || []).length <= 1) { alert('Tidak bisa menghapus cabang terakhir.'); return; }
    const s = (state.stores || []).find(x => String(x.id) === String(id));
    if (!s) return;
    // Toko utama (pusat) = penambat langganan. Mencegah hapus agar status langganan tidak berubah.
    if (String(id) === String(primaryStore()?.id)) {
      alert('Toko Utama (Pusat) tidak bisa dihapus karena menjadi acuan langganan. Hapus/ganti cabang lain terlebih dahulu.');
      return;
    }
    if (!confirm('Hapus cabang "' + (s.name || '') + '" beserta SEMUA produk, transaksi, dan datanya? Tindakan ini tidak bisa dibatalkan.')) return;
    const { error } = await db.from('stores').delete().eq('id', id);
    if (error) { alert('Gagal menghapus: ' + friendlyError(error)); return; }
    state.stores = state.stores.filter(x => String(x.id) !== String(id));
    if (String(id) === String(state.storeId)) {
      localStorage.setItem(activeStoreKey(), String(state.stores[0].id));
      await switchStore(state.stores[0].id);
    }
    renderBranchList();
    renderStoreSwitcher();
  };

  // Daftar cabang di halaman Pengaturan
  const renderBranchList = () => {
    const list = document.getElementById('branchList');
    if (!list) return;
    const stores = state.stores || [];
    const primaryId = String(primaryStore()?.id);
    list.innerHTML = stores.map(s => {
      const isActive = String(s.id) === String(state.storeId);
      const isPrimary = String(s.id) === primaryId;
      return `<div class="flex items-center justify-between gap-3 rounded-lg border ${isActive ? 'border-primary bg-primary-light' : 'border-hairline bg-white'} px-4 py-3">
        <div class="min-w-0">
          <p class="font-semibold truncate">${esc(s.name || 'Toko')}${s.is_main ? ' <span class="text-xs text-primary">(Pusat)</span>' : ''}${isActive ? ' <span class="text-xs text-emerald-600">• aktif</span>' : ''}</p>
        </div>
        <div class="flex gap-1 shrink-0">
          ${isActive ? '' : `<button data-branch-switch="${esc(s.id)}" class="rounded-lg bg-primary px-2.5 py-1.5 text-white text-xs hover:bg-primary-active">Buka</button>`}
          <button data-branch-rename="${esc(s.id)}" class="rounded-lg bg-hairline-soft px-2.5 py-1.5 text-body text-xs hover:bg-hairline">Nama</button>
          ${(stores.length > 1 && !isPrimary) ? `<button data-branch-delete="${esc(s.id)}" class="rounded-lg bg-rose-100 px-2.5 py-1.5 text-rose-700 text-xs hover:bg-rose-200">Hapus</button>` : ''}
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-branch-switch]').forEach(b =>
      b.addEventListener('click', () => switchStore(b.dataset.branchSwitch)));
    list.querySelectorAll('[data-branch-rename]').forEach(b =>
      b.addEventListener('click', () => renameBranch(b.dataset.branchRename)));
    list.querySelectorAll('[data-branch-delete]').forEach(b =>
      b.addEventListener('click', () => deleteBranch(b.dataset.branchDelete)));
  };

  // Dashboard Pusat: rekap omzet & transaksi seluruh cabang hari ini.
  // Query lintas-cabang (RLS mengizinkan semua toko milik owner), dikelompokkan di sisi klien.
  const renderDashboardPusat = async () => {
    const panel = document.getElementById('dashboardPusat');
    const body = document.getElementById('dashboardPusatBody');
    if (!panel || !body) return;
    const active = state.cashiers.find(c => c.id === state.selectedCashierId);
    const isAdmin = !active || active.role === 'admin';
    if (!db || !isAdmin || (state.stores || []).length < 2) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    // Awal hari ini waktu lokal, dikonversi ke instant UTC untuk query created_at (timestamptz)
    const startIso = startOfToday().toISOString();
    // Ambil transaksi hari ini SEMUA cabang sekaligus (tanpa filter store_id → RLS membatasi ke milik owner)
    const { data: txs, error } = await db.from('transactions')
      .select('store_id,total_amount').gte('created_at', startIso);
    if (error) { body.innerHTML = `<p class="text-muted text-sm p-4">Gagal memuat rekap: ${esc(error.message)}</p>`; return; }
    const byStore = {};
    (txs || []).forEach(t => {
      const k = String(t.store_id);
      if (!byStore[k]) byStore[k] = { total: 0, count: 0 };
      byStore[k].total += Number(t.total_amount || 0);
      byStore[k].count += 1;
    });
    let grandTotal = 0, grandCount = 0;
    const rows = (state.stores || []).map(s => {
      const d = byStore[String(s.id)] || { total: 0, count: 0 };
      grandTotal += d.total; grandCount += d.count;
      const isActive = String(s.id) === String(state.storeId);
      return `<tr class="${isActive ? 'bg-primary-light' : ''}">
        <td class="px-4 py-3 font-medium">${esc(s.name || 'Toko')}${s.is_main ? ' <span class="text-xs text-primary">(Pusat)</span>' : ''}</td>
        <td class="px-4 py-3 text-right">${formatCurrency(d.total)}</td>
        <td class="px-4 py-3 text-right">${d.count}</td>
      </tr>`;
    }).join('');
    body.innerHTML = `
      <table class="w-full text-sm">
        <thead><tr class="text-left text-muted border-b border-hairline">
          <th class="px-4 py-2 font-medium">Cabang</th>
          <th class="px-4 py-2 font-medium text-right">Omzet Hari Ini</th>
          <th class="px-4 py-2 font-medium text-right">Transaksi</th>
        </tr></thead>
        <tbody class="divide-y border-hairline">${rows}</tbody>
        <tfoot><tr class="border-t-2 border-hairline font-semibold">
          <td class="px-4 py-3">TOTAL Semua Cabang</td>
          <td class="px-4 py-3 text-right text-primary">${formatCurrency(grandTotal)}</td>
          <td class="px-4 py-3 text-right">${grandCount}</td>
        </tr></tfoot>
      </table>`;
  };
  // ──────────────────────────────────────────────────────────────────────────

  const getSelectedCashier = () => {
    return state.cashiers.find(item => item.id === state.selectedCashierId) || state.cashiers[0] || { id: 'C000', name: 'Kasir' };
  };

  const renderCashierSelect = () => {
    dom.cashierSelect.innerHTML = state.cashiers.map(item => `
      <option value="${esc(item.id)}">${esc(item.name)}</option>
    `).join('');
    if (!state.cashiers.some(item => item.id === state.selectedCashierId)) {
      state.selectedCashierId = state.cashiers[0]?.id || '';
    }
    dom.cashierSelect.value = state.selectedCashierId;
  };

  // ── Kelola Kasir ──────────────────────────────────────────────────────────
  const renderCashierManagement = () => {
    if (!dom.cashierGrid) return;
    const activeId = state.selectedCashierId;
    const admins = state.cashiers.filter(c => c.role === 'admin').length;
    const kasirs = state.cashiers.filter(c => c.role !== 'admin').length;
    if (dom.statTotalCashier) dom.statTotalCashier.textContent = state.cashiers.length;
    if (dom.statTotalAdmin) dom.statTotalAdmin.textContent = admins;
    if (dom.statTotalKasir) dom.statTotalKasir.textContent = kasirs;

    dom.cashierGrid.innerHTML = state.cashiers.map(c => {
      const isAdmin = c.role === 'admin';
      const isSelf = c.id === activeId;
      const initial = esc(c.name.charAt(0).toUpperCase());
      const roleLabel = isAdmin ? iconText('crown', 'Admin', 'icon icon-sm') : iconText('receipt', 'Kasir', 'icon icon-sm');
      const roleBg = isAdmin ? 'bg-primary-light text-primary' : 'bg-surface-soft text-body';
      const avatarBg = isAdmin ? 'bg-primary' : 'bg-surface-soft0';
      return `
        <div class="rounded-xl bg-white border border-hairline shadow-sm p-5 flex flex-col gap-4">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-full ${avatarBg} flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">${initial}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="font-semibold text-ink truncate">${esc(c.name)}</p>
                ${isSelf ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Anda</span>' : ''}
              </div>
              <span class="text-xs px-2 py-0.5 rounded-full ${roleBg} font-medium mt-1 inline-block">${roleLabel}</span>
            </div>
          </div>
          <div class="flex gap-2">
            <button data-edit-cashier="${c.id}"
              class="flex-1 rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-body hover:bg-surface-soft transition font-medium">
              ${iconText('edit', 'Edit')}
            </button>
            <button data-delete-cashier="${c.id}" ${isSelf ? 'disabled title="Tidak bisa hapus akun sendiri"' : ''}
              class="btn-icon flex-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 hover:bg-rose-100 transition font-medium ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}">
              ${iconText('trash', 'Hapus')}
            </button>
          </div>
        </div>
      `;
    }).join('');

    dom.cashierGrid.querySelectorAll('[data-edit-cashier]').forEach(btn => {
      btn.addEventListener('click', () => openCashierModal(btn.dataset.editCashier));
    });
    dom.cashierGrid.querySelectorAll('[data-delete-cashier]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => deleteCashier(btn.dataset.deleteCashier));
    });
  };

  const openCashierModal = (id = '') => {
    dom.cashierFormError.classList.add('hidden');
    dom.cashierForm.reset();
    dom.cashierFormId.value = id;
    if (id) {
      const c = state.cashiers.find(x => x.id === id);
      if (!c) return;
      dom.cashierModalTitle.textContent = 'Edit Kasir';
      dom.cashierFormName.value = c.name;
      dom.cashierFormRole.value = c.role || 'kasir';
      dom.cashierPasswordHint.classList.remove('hidden');
      dom.cashierFormPassword.required = false;
      dom.cashierFormPassword.placeholder = 'Kosongkan jika tidak ingin ubah';
    } else {
      dom.cashierModalTitle.textContent = 'Tambah Kasir Baru';
      dom.cashierPasswordHint.classList.add('hidden');
      dom.cashierFormPassword.required = true;
      dom.cashierFormPassword.placeholder = 'Masukkan password';
    }
    dom.cashierModal.classList.remove('hidden');
    dom.cashierFormName.focus();
  };

  const closeCashierModalFn = () => {
    dom.cashierModal.classList.add('hidden');
  };

  const openDeleteAccountModal = () => {
    dom.deleteAccountEmailInput.value = '';
    dom.deleteAccountError.classList.add('hidden');
    dom.deleteAccountConfirmBtn.disabled = true;
    dom.deleteAccountConfirmBtn.classList.remove('bg-rose-600', 'hover:bg-rose-700', 'text-white', 'cursor-pointer');
    dom.deleteAccountConfirmBtn.classList.add('bg-hairline-soft', 'text-muted-soft', 'cursor-not-allowed');
    dom.deleteAccountModal.classList.remove('hidden');
    dom.deleteAccountEmailInput.focus();
  };

  const closeDeleteAccountModal = () => {
    dom.deleteAccountModal.classList.add('hidden');
  };

  const handleDeleteAccount = async () => {
    const emailInput = dom.deleteAccountEmailInput.value.trim();
    const userEmail = state.authUser?.email || '';
    if (emailInput.toLowerCase() !== userEmail.toLowerCase()) {
      dom.deleteAccountError.textContent = 'Email tidak cocok. Silakan ketik ulang email Anda dengan benar.';
      dom.deleteAccountError.classList.remove('hidden');
      return;
    }
    dom.deleteAccountError.classList.add('hidden');
    dom.deleteAccountConfirmBtn.textContent = 'Menghapus...';
    dom.deleteAccountConfirmBtn.disabled = true;
    try {
      const { error } = await db.functions.invoke('delete-account', { body: {} });
      if (error) throw error;
      // Bersihkan semua localStorage secara eksplisit setelah penghapusan berhasil
      Object.values(STORAGE).forEach(key => localStorage.removeItem(key));
      localStorage.removeItem('qris_image');
      localStorage.removeItem('qris_payload');
      localStorage.removeItem('pending_subs_order');
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('active_store_') || k.startsWith('shift_start_') || k.startsWith('onboardingDone_')) {
          localStorage.removeItem(k);
        }
      });
      await db.auth.signOut();
      closeDeleteAccountModal();
      showLoginPage();
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'Gagal menghapus akun. Coba lagi atau hubungi support.';
      dom.deleteAccountError.textContent = msg;
      dom.deleteAccountError.classList.remove('hidden');
      dom.deleteAccountConfirmBtn.textContent = 'Hapus Akun Saya';
      dom.deleteAccountConfirmBtn.disabled = false;
    }
  };

  const saveCashier = async event => {
    event.preventDefault();
    dom.cashierFormError.classList.add('hidden');
    const id = dom.cashierFormId.value;
    const name = dom.cashierFormName.value.trim();
    const password = dom.cashierFormPassword.value.trim();
    const role = dom.cashierFormRole.value;

    if (!name) { showCashierError('Nama kasir tidak boleh kosong.'); return; }
    if (!id && !password) { showCashierError('Password wajib diisi untuk kasir baru.'); return; }

    // Cek nama duplikat
    const duplicate = state.cashiers.find(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== id);
    if (duplicate) { showCashierError('Nama kasir sudah digunakan.'); return; }

    if (db) {
      const numId = parseInt(id);
      if (!isNaN(numId)) {
        // Update
        const payload = { name, role };
        if (password) payload.password = password;
        const { error } = await db.from('cashiers').update(payload).eq('id', numId);
        if (error) { showCashierError('Gagal simpan: ' + friendlyError(error)); return; }
        const idx = state.cashiers.findIndex(c => c.id === id);
        if (idx >= 0) {
          state.cashiers[idx] = { ...state.cashiers[idx], name, role, ...(password ? { password } : {}) };
        }
      } else {
        // Insert
        const { data, error } = await db.from('cashiers')
          .insert({ name, password, role, store_id: state.storeId }).select().single();
        if (error) { showCashierError('Gagal tambah: ' + friendlyError(error)); return; }
        state.cashiers.push(fromDbCashier(data));
      }
    } else {
      // localStorage fallback
      if (id) {
        const idx = state.cashiers.findIndex(c => c.id === id);
        if (idx >= 0) state.cashiers[idx] = { ...state.cashiers[idx], name, role, ...(password ? { password } : {}) };
      } else {
        state.cashiers.push({ id: `C${Date.now()}`, name, password, role });
      }
    }

    syncStorage();
    renderCashierSelect();
    renderCashierManagement();
    closeCashierModalFn();
  };

  const showCashierError = msg => {
    dom.cashierFormError.textContent = msg;
    dom.cashierFormError.classList.remove('hidden');
  };

  const deleteCashier = async id => {
    const c = state.cashiers.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`Hapus kasir "${c.name}"? Aksi ini tidak bisa dibatalkan.`)) return;
    const numId = parseInt(id);
    if (db && !isNaN(numId)) {
      const { error } = await db.from('cashiers').delete().eq('id', numId);
      if (error) { alert('Gagal hapus kasir: ' + friendlyError(error)); return; }
    }
    state.cashiers = state.cashiers.filter(x => x.id !== id);
    syncStorage();
    renderCashierSelect();
    renderCashierManagement();
  };
  // ─────────────────────────────────────────────────────────────────────────

  const escapeCSV = value => `"${String(value).replace(/"/g, '""')}"`;

  const downloadCSV = (filename, rows) => {
    const csvContent = rows.map(row => row.map(cell => escapeCSV(cell)).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportInventoryCSV = () => {
    const rows = [[
      'Kode Produk', 'Nama Produk', 'Kategori', 'Harga Jual', 'Harga Modal', 'Stok'
    ]];
    state.products.forEach(product => {
      rows.push([product.code, product.name, product.category, product.price, product.cost, product.stock]);
    });
    downloadCSV('inventory_umkm.csv', rows);
  };

  const exportHistoryCSV = () => {
    const rows = [[
      'Waktu', 'Invoice', 'Kasir', 'Total', 'Tunai', 'Kembalian', 'Produk'
    ]];
    state.transactions.forEach(tx => {
      rows.push([
        new Date(tx.date).toLocaleString('id-ID'),
        tx.id,
        tx.cashier || '-',
        tx.total,
        tx.cash,
        tx.change,
        tx.items.map(item => `${item.name} x${item.qty}`).join(' | ')
      ]);
    });
    downloadCSV('riwayat_transaksi_umkm.csv', rows);
  };

  const exportPurchasesCSV = () => {
    const rows = [[
      'Tanggal', 'Invoice', 'Supplier', 'Total', 'Produk', 'Status'
    ]];
    state.purchases.forEach(order => {
      rows.push([
        new Date(order.date).toLocaleString('id-ID'),
        order.id,
        order.supplier,
        order.total,
        order.items.map(item => `${item.name} x${item.qty}`).join(' | '),
        order.status
      ]);
    });
    downloadCSV('pembelian_umkm.csv', rows);
  };

  const exportAppBackup = () => {
    const payload = {
      products: state.products,
      transactions: state.transactions,
      purchases: state.purchases,
      cashiers: state.cashiers,
      settings: {
        selectedCashierId: state.selectedCashierId,
        activeUserId: state.activeUserId,
        reportRange: state.reportRange,
        historySearch: state.historySearch
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'kasir_umkm_backup.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importAppBackup = event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        state.products = data.products || state.products;
        state.transactions = data.transactions || state.transactions;
        state.purchases = data.purchases || state.purchases;
        state.cashiers = data.cashiers || state.cashiers;
        if (data.settings) {
          state.selectedCashierId = data.settings.selectedCashierId || state.selectedCashierId;
          state.activeUserId = data.settings.activeUserId || state.activeUserId;
          state.reportRange = data.settings.reportRange || state.reportRange;
          state.historySearch = data.settings.historySearch || state.historySearch;
        }
        syncStorage();
        renderAll();
        alert('Data berhasil dipulihkan dari backup.');
      } catch (error) {
        alert('Gagal memulihkan data. Pastikan file backup benar.');
      }
    };
    reader.readAsText(file);
  };

  const getFilteredTransactions = () => {
    const query = state.historySearch.trim().toLowerCase();
    if (!query) return state.transactions;
    return state.transactions.filter(tx =>
      tx.id.toString().includes(query) ||
      (tx.cashier || '').toLowerCase().includes(query) ||
      tx.items.some(item => (item.name || '').toLowerCase().includes(query))
    );
  };

  const renderReportSummary = () => {
    const days = Number(state.reportRange) || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    cutoff.setHours(0, 0, 0, 0); // mulai dari awal hari (lokal) agar penjualan pagi ikut terhitung
    const filtered = state.transactions.filter(tx => new Date(tx.date) >= cutoff);
    const totalSales = filtered.reduce((sum, tx) => sum + tx.total, 0);
    const totalTrans = filtered.length;
    const totalItems = filtered.reduce((sum, tx) => sum + tx.items.reduce((qty, item) => qty + item.qty, 0), 0);
    dom.reportSales.textContent = formatCurrency(totalSales);
    dom.reportTransactions.textContent = totalTrans;
    dom.reportItemsSold.textContent = totalItems;

    const lowStockProducts = state.products.filter(product => product.stock >= 0 && product.stock <= (product.minStock || 5));
    dom.lowStockAlert.textContent = lowStockProducts.length ? `${lowStockProducts.length} produk stok rendah, segera kulakan lagi.` : 'Tidak ada stok kritis.';

    const productQtyMap = {};
    state.transactions.forEach(tx => {
      tx.items.forEach(item => {
        productQtyMap[item.id] = (productQtyMap[item.id] || 0) + item.qty;
      });
    });
    const bestProduct = state.products.slice().sort((a, b) =>
      (productQtyMap[b.id] || 0) - (productQtyMap[a.id] || 0)
    )[0];
    dom.topProduct.textContent = bestProduct ? `${bestProduct.name}` : '-';

    const categorySales = {};
    state.transactions.forEach(tx => {
      tx.items.forEach(item => {
        const product = state.products.find(p => p.id === item.id);
        if (!product) return;
        categorySales[product.category] = (categorySales[product.category] || 0) + item.qty;
      });
    });
    const topCategory = Object.keys(categorySales).sort((a, b) => categorySales[b] - categorySales[a])[0] || '-';
    dom.topCategory.textContent = topCategory;

    const totalProfit = state.transactions.reduce((sum, tx) => sum + tx.items.reduce((itemSum, item) => itemSum + item.qty * (item.price - item.cost), 0) - tx.tax, 0);
    const margin = totalSales > 0 ? Math.round((totalProfit / totalSales) * 100) : 0;
    dom.profitMargin.textContent = `${margin}%`;
  };

  const renderPurchaseHistory = () => {
    if (!state?.purchases) {
      dom.purchaseTable.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-muted">Belum ada data pembelian.</td></tr>';
      return;
    }
    dom.purchaseTable.innerHTML = state.purchases.slice().reverse().map(order => {
      const time = new Date(order.date).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' });
      return `
        <tr class="border-b border-hairline">
          <td class="p-3">${time}</td>
          <td class="p-3">#${esc(order.id)}</td>
          <td class="p-3">${esc(order.supplier)}</td>
          <td class="p-3 font-semibold">${formatCurrency(order.total)}</td>
          <td class="p-3">${esc(order.items.length)} produk</td>
          <td class="p-3">${esc(order.status)}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="6" class="p-8 text-center text-muted">Belum ada data pembelian.</td></tr>';
  };

  const getActiveUser = () => {
    return state.cashiers.find(item => item.id === state.activeUserId) || getSelectedCashier();
  };

  const showLoginModal = () => {
    dom.loginModal.classList.remove('hidden');
  };

  const hideLoginModal = () => {
    dom.loginModal.classList.add('hidden');
    dom.loginForm.reset();
  };

  const showPaymentConfirmModal = (method, total, cashierName) => {
    dom.paymentConfirmMethod.textContent = method;
    dom.paymentConfirmTotal.textContent = formatCurrency(total);
    dom.paymentConfirmCashier.textContent = cashierName;
    dom.paymentConfirmModal.classList.remove('hidden');
  };

  const hidePaymentConfirmModal = () => {
    dom.paymentConfirmModal.classList.add('hidden');
  };

  const authenticateUser = async (name, password) => {
    const user = state.cashiers.find(item => item.name.toLowerCase() === name.toLowerCase() && item.password === password);
    if (!user) return false;
    state.activeUserId = user.id;
    state.selectedCashierId = user.id;
    renderCashierSelect();
    syncStorage();
    hideLoginModal();
    // Terapkan hak akses operator baru; kasir tidak boleh tetap di layar admin
    applyRoleAccess();

    await loadActiveShift();

    const currentScreen = document.querySelector('main section.screen:not(.hidden)')?.id;
    if (user.role !== 'admin' && ADMIN_SCREENS.includes(currentScreen)) {
      showScreen('kasir');
    } else if (currentScreen === 'kasir') {
      await checkOrOpenShift();
    }
    return true;
  };

  const openScannerModal = (context = 'kasir') => {
    state.scannerContext = context;
    dom.scannerModal.classList.remove('hidden');
    dom.scannerModal.style.display = 'flex';
    dom.scannerStatus.textContent = 'Siap memindai.';
    dom.scannerResult.classList.add('hidden');
    dom.scannerNotFound.classList.add('hidden');
    dom.manualBarcodeInput.value = '';
    if (context === 'inventory') {
      dom.scannerSubtitle.textContent = 'Scan barcode untuk mengisi kode produk.';
    } else {
      dom.scannerSubtitle.textContent = 'Scan barcode untuk mencari dan menambah produk ke keranjang.';
    }
    // Auto-buka kamera agar langsung bisa dipakai
    startBarcodeScanner();
  };

  const closeScannerModal = () => {
    dom.scannerModal.classList.add('hidden');
    dom.scannerModal.style.display = '';
    stopBarcodeScanner();
  };

  const handleScannedCode = code => {
    const trimmed = code.trim();
    if (!trimmed) return;

    if (state.scannerContext === 'inventory') {
      dom.productBarcode.value = trimmed;
      dom.scannerStatus.textContent = `Barcode diset: ${trimmed}`;
      dom.scannerResult.classList.remove('hidden');
      dom.scannerNotFound.classList.add('hidden');
      dom.scannerResultName.textContent = trimmed;
      dom.scannerResultCode.textContent = 'Barcode berhasil direkam untuk produk ini.';
      setTimeout(() => closeScannerModal(), 1200);
      return;
    }

    const product = state.products.find(p =>
      p.barcode === trimmed || p.code === trimmed || p.id === trimmed
    );

    if (product) {
      dom.scannerResult.classList.remove('hidden');
      dom.scannerNotFound.classList.add('hidden');
      dom.scannerResultName.textContent = product.name;
      dom.scannerResultCode.textContent = `Kode: ${product.code} | Barcode: ${product.barcode || '-'} | Stok: ${product.stock}`;
      dom.scannerStatus.textContent = `Ditemukan: ${product.name}`;
      addToCart(product.id);
      setTimeout(() => closeScannerModal(), 1000);
    } else {
      dom.scannerNotFound.classList.remove('hidden');
      dom.scannerResult.classList.add('hidden');
      dom.scannerNotFoundCode.textContent = `Kode "${trimmed}" tidak cocok dengan produk manapun.`;
      dom.barcodeInput.value = trimmed;
      state.searchQuery = trimmed;
      dom.searchInput.value = trimmed;
      renderProducts();
      dom.scannerStatus.textContent = `Barcode terdeteksi: ${trimmed} (tidak ditemukan)`;
    }
  };

  const startBarcodeScanner = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      dom.scannerStatus.textContent = 'Kamera tidak tersedia. Pastikan buka lewat HTTPS dan izinkan kamera.';
      return;
    }
    dom.scannerStatus.textContent = 'Membuka kamera...';
    dom.scannerResult.classList.add('hidden');
    dom.scannerNotFound.classList.add('hidden');

    // Native BarcodeDetector (Chrome Android/Desktop) — paling andal
    if ('BarcodeDetector' in window) {
      try {
        await startNativeScanner();
        return;
      } catch (e) {
        dom.scannerStatus.textContent = 'Beralih ke mode cadangan...';
      }
    }
    // Fallback: Quagga
    startQuaggaScanner();
  };

  const startNativeScanner = async () => {
    state.scannerEngine = 'native';
    const formats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'];
    let supported = formats;
    try {
      const avail = await window.BarcodeDetector.getSupportedFormats();
      supported = formats.filter(f => avail.includes(f));
      if (!supported.length) supported = undefined;
    } catch { /* pakai default */ }
    state.scannerDetector = new window.BarcodeDetector(supported ? { formats: supported } : undefined);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false
    });
    state.scannerStream = stream;
    const video = dom.scannerVideo;
    video.srcObject = stream;
    video.classList.remove('hidden');
    dom.scannerPlaceholder.classList.add('hidden');
    dom.scannerScanLine.classList.remove('hidden');
    await video.play();
    dom.scannerStatus.textContent = 'Arahkan kamera ke barcode...';

    const tick = async () => {
      if (state.scannerEngine !== 'native' || !state.scannerDetector) return;
      try {
        const codes = await state.scannerDetector.detect(video);
        if (codes && codes.length) {
          const code = codes[0].rawValue;
          handleScannedCode(code);
          stopBarcodeScanner();
          return;
        }
      } catch { /* frame gagal, lanjut */ }
      state.scannerRAF = requestAnimationFrame(tick);
    };
    state.scannerRAF = requestAnimationFrame(tick);
  };

  const startQuaggaScanner = async () => {
    if (typeof Quagga === 'undefined') {
      dom.scannerStatus.textContent = 'Memuat library scanner...';
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js');
      } catch (e) {
        dom.scannerStatus.textContent = 'Scanner tidak tersedia di perangkat ini. Gunakan input manual.';
        return;
      }
    }
    state.scannerEngine = 'quagga';
    dom.scannerPlaceholder.classList.add('hidden');
    Quagga.init({
      inputStream: {
        type: 'LiveStream',
        target: dom.scannerArea,
        constraints: { facingMode: 'environment' }
      },
      decoder: { readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader', 'upc_reader'] },
      locate: true
    }, err => {
      if (err) {
        dom.scannerStatus.textContent = 'Kamera gagal dibuka. Pastikan izin kamera sudah diberikan, atau gunakan input manual di bawah.';
        dom.scannerPlaceholder.classList.remove('hidden');
        return;
      }
      Quagga.start();
      dom.scannerScanLine.classList.remove('hidden');
      dom.scannerStatus.textContent = 'Arahkan kamera ke barcode...';
    });
    Quagga.onDetected(result => {
      const code = result.codeResult.code;
      handleScannedCode(code);
      stopBarcodeScanner();
    });
  };

  const stopBarcodeScanner = () => {
    // Hentikan engine native
    if (state.scannerRAF) { cancelAnimationFrame(state.scannerRAF); state.scannerRAF = null; }
    state.scannerDetector = null;
    if (state.scannerStream) {
      state.scannerStream.getTracks().forEach(t => t.stop());
      state.scannerStream = null;
    }
    if (dom.scannerVideo) {
      dom.scannerVideo.srcObject = null;
      dom.scannerVideo.classList.add('hidden');
    }
    // Hentikan Quagga
    if (state.scannerEngine === 'quagga' && typeof Quagga !== 'undefined') {
      try { Quagga.stop(); Quagga.offDetected(); } catch (e) { /* ignore */ }
    }
    state.scannerEngine = null;
    if (dom.scannerScanLine) dom.scannerScanLine.classList.add('hidden');
    if (dom.scannerPlaceholder) dom.scannerPlaceholder.classList.remove('hidden');
    if (dom.scannerStatus && !dom.scannerStatus.textContent.startsWith('Ditemukan:')) {
      dom.scannerStatus.textContent = 'Scanner dihentikan.';
    }
  };

  const resetPurchaseDraft = () => {
    state.draftPurchase = { supplier: '', invoice: `PO${Date.now()}`, items: [] };
    dom.purchaseSupplier.value = '';
    dom.purchaseInvoice.value = state.draftPurchase.invoice;
    dom.purchaseQty.value = 1;
    dom.purchaseCost.value = '';
    dom.purchaseItemsList.innerHTML = '<p class="text-muted">Belum ada item pembelian.</p>';
    dom.purchaseTotal.textContent = formatCurrency(0);
  };

  const renderPurchaseOptions = () => {
    if (!dom.purchaseProduct) {
      console.warn('Element purchaseProduct tidak ditemukan');
      return;
    }

    // Pastikan state.products sudah ter-load
    const products = state.products || [];
    
    if (products.length === 0) {
      dom.purchaseProduct.innerHTML = '<option value="">Belum ada produk - tambahkan produk di menu Inventory terlebih dahulu</option>';
      console.log('renderPurchaseOptions: tidak ada produk di state.products');
      return;
    }
    
    dom.purchaseProduct.innerHTML = '<option value="">-- Pilih Produk --</option>' + products.map(product => `
      <option value="${product.id}">${esc(product.name)} (Stok: ${product.stock})</option>
    `).join('');
    console.log(`renderPurchaseOptions: ${products.length} produk dimuat ke dropdown`);
  };

  const renderPurchaseDraft = () => {
    if (!state.draftPurchase.items.length) {
      dom.purchaseItemsList.innerHTML = '<p class="text-muted">Belum ada item pembelian.</p>';
      dom.purchaseTotal.textContent = formatCurrency(0);
      return;
    }
    let total = 0;
    dom.purchaseItemsList.innerHTML = state.draftPurchase.items.map(item => {
      const subtotal = item.qty * item.price;
      total += subtotal;
      return `
        <div class="flex items-center justify-between gap-3 rounded-lg bg-white p-3 border border-hairline mb-3">
          <div>
            <p class="font-semibold">${esc(item.name)}</p>
            <p class="text-muted text-sm">Qty ${item.qty} x ${formatCurrency(item.price)}</p>
          </div>
          <span class="font-semibold">${formatCurrency(subtotal)}</span>
        </div>
      `;
    }).join('');
    dom.purchaseTotal.textContent = formatCurrency(total);
  };

  const openPurchaseModal = async () => {
    resetPurchaseDraft();
    
    // Tampilkan loading state di modal
    dom.purchaseProduct.innerHTML = '<option value=\"\">Memuat produk...</option>';
    dom.purchaseProduct.disabled = true;
    dom.purchaseModal.classList.remove('hidden');
    
    // Pastikan data produk sudah ter-load dari server
    if (!state.products || state.products.length === 0) {
      try {
        await loadData();
      } catch (err) {
        console.error('Gagal memuat data untuk pembelian:', err);
        showAppToast('Gagal memuat data produk. Silakan refresh halaman.', 'error');
        closePurchaseModal();
        return;
      }
    }
    
    // Enable dropdown dan render options setelah data siap
    dom.purchaseProduct.disabled = false;
    renderPurchaseOptions();
  };

  const closePurchaseModal = () => {
    dom.purchaseModal.classList.add('hidden');
  };

  const addPurchaseItemToDraft = () => {
    const productId = dom.purchaseProduct.value;
    const qty = Number(dom.purchaseQty.value) || 1;
    const costInput = Number(dom.purchaseCost.value) || 0;
    const product = state.products.find(item => item.id === productId);
    if (!product) return;
    const existing = state.draftPurchase.items.find(item => item.id === productId);
    if (existing) {
      existing.qty += qty;
      existing.price = costInput;
    } else {
      state.draftPurchase.items.push({ id: product.id, name: product.name, price: costInput, qty });
    }
    dom.purchaseProduct.value = '';
    dom.purchaseQty.value = 1;
    dom.purchaseCost.value = '';
    renderPurchaseDraft();
  };

  const savePurchaseOrder = async () => {
    if (!dom.purchaseSupplier.value.trim() || !state.draftPurchase.items.length) {
      alert('Isi supplier dan tambahkan item pembelian terlebih dahulu.');
      return;
    }
    const total = state.draftPurchase.items.reduce((sum, item) => sum + item.qty * item.price, 0);
    const purchaseId = dom.purchaseInvoice.value.trim() || `PO${Date.now()}`;

    const purchase = {
      id: purchaseId,
      supplier: dom.purchaseSupplier.value.trim(),
      date: new Date().toISOString(),
      items: state.draftPurchase.items,
      total,
      status: 'Diterima'
    };

    if (db) {
      try {
        // Insert purchase header
        const { error: poErr } = await db.from('purchases').insert({
          id: purchaseId,
          store_id: state.storeId,
          supplier: purchase.supplier,
          total,
          status: 'Diterima'
        });
        if (poErr) throw poErr;

        // Insert purchase items
        const itemRows = state.draftPurchase.items.map(item => ({
          purchase_id: purchaseId,
          product_id: parseInt(item.id) || null,
          product_name: item.name,
          quantity: item.qty,
          price: item.price,
          subtotal: item.qty * item.price
        }));
        const { error: itemsErr } = await db.from('purchase_items').insert(itemRows);
        if (itemsErr) throw itemsErr;
      } catch (err) {
        alert('Gagal menyimpan pembelian: ' + friendlyError(err));
        return;
      }
    }

    state.purchases.unshift(purchase);

    // Update stock locally and in Supabase
    for (const item of state.draftPurchase.items) {
      const product = state.products.find(prod => prod.id === item.id);
      if (product) {
        product.stock += item.qty;
        product.cost = item.price;
        if (db) {
          const numId = parseInt(product.id);
          if (!isNaN(numId)) {
            const { error: stockErr } = await db.from('products').update({ stock: product.stock, cost: product.cost }).eq('id', numId);
            if (stockErr) logError('savePurchaseOrder: stok/cost gagal update', { productId: numId }, stockErr);
          }
        }
      }
    }

    syncStorage();
    renderInventory();
    renderPurchaseHistory();
    renderReportSummary();
    closePurchaseModal();
    alert('Pembelian berhasil disimpan dan stok diperbarui.');
  };

  const getFilteredProducts = () => {
    return state.products.filter(product => {
      const matchesCategory = state.selectedCategory === 'All' || product.category === state.selectedCategory;
      const query = state.searchQuery.trim().toLowerCase();
      const matchesSearch = !query ||
        product.name.toLowerCase().includes(query) ||
        product.code.toLowerCase().includes(query) ||
        (product.barcode && product.barcode.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  };

  const getCartItems = () => Object.values(state.cart);

  const calculateCart = () => {
    const items = getCartItems();
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const discountPercent = Math.max(0, Math.min(100, state.discountPercent));
    const discountNominal = Math.max(0, state.discountNominal);
    const discountFromPercent = Math.round(subtotal * discountPercent / 100);
    const discount = discountNominal > 0 ? Math.min(discountNominal, subtotal) : discountFromPercent;
    const taxable = Math.max(0, subtotal - discount);
    const tax = 0; // UMKM umumnya non-PKP: tidak memungut PPN
    const total = Math.max(0, taxable + tax);
    let cash = Math.max(0, Number(state.cashAmount) || 0);
    let change = Math.max(0, cash - total);
    if (state.paymentMethod === 'Split') {
      cash = Number(document.getElementById('splitCashInput')?.value) || 0;
      change = 0;
    }
    return { subtotal, discount, tax, total, cash, change };
  };

  const updateDashboard = () => {
    const today = localDay(new Date());
    const todayTransactions = state.transactions.filter(tx => localDay(tx.date) === today && tx.status !== 'void');
    const totalSalesToday = todayTransactions.reduce((sum, tx) => sum + tx.total, 0);
    // Statistik dihitung dari transaksi HARI INI saja, laba pakai harga modal produk
    const productCost = id => state.products.find(p => p.id === id)?.cost || 0;
    const totalProductsSold = todayTransactions.reduce((sum, tx) => sum + tx.items.reduce((qtySum, item) => qtySum + item.qty, 0), 0);
    const totalProfit = todayTransactions.reduce((sum, tx) =>
      sum + tx.items.reduce((itemSum, item) => itemSum + item.qty * (item.price - (item.cost || productCost(item.id))), 0) - (tx.discount || 0), 0);

    const updateUI = (refunds) => {
      const finalSales = Math.max(0, totalSalesToday - refunds);
      const finalProfit = Math.max(0, totalProfit - refunds);
      dom.statSalesToday.textContent = formatCurrency(finalSales);
      dom.statProductsSold.textContent = totalProductsSold;
      dom.statProfit.textContent = formatCurrency(finalProfit);
    };

    if (db && state.storeId) {
      db.from('transaction_returns')
        .select('refund_amount')
        .eq('store_id', state.storeId)
        .gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString())
        .then(({ data }) => {
          const refunds = (data || []).reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);
          updateUI(refunds);
        }).catch(err => {
          console.error(err);
          updateUI(0);
        });
    } else {
      updateUI(0);
    }
  };

  const renderSalesChart = () => {
    const dates = [];
    const amounts = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const isoDate = localDay(date);
      dates.push(date.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' }));
      const dayTotal = state.transactions
        .filter(tx => localDay(tx.date) === isoDate && tx.status !== 'void')
        .reduce((sum, tx) => sum + tx.total, 0);
      amounts.push(dayTotal);
    }

    if (chartInstance) {
      chartInstance.data.labels = dates;
      chartInstance.data.datasets[0].data = amounts;
      chartInstance.update();
      return;
    }

    chartInstance = new Chart(dom.salesChart.getContext('2d'), {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: 'Pendapatan',
          data: amounts,
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34,211,238,0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#0284c7'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } }
        },
        plugins: { legend: { display: false } }
      }
    });
  };

  const renderProducts = () => {
    const filtered = getFilteredProducts();
    dom.productGrid.innerHTML = filtered.map(product => {
      const isCritical = product.stock <= (product.minStock || 5);
      return `
        <article data-id="${esc(product.id)}" class="group cursor-pointer overflow-hidden rounded-xl border border-hairline bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
          <img src="${esc(product.image)}" alt="${esc(product.name)}" class="h-44 w-full object-cover" />
          <div class="p-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h4 class="text-lg font-semibold">${esc(product.name)}</h4>
                <p class="text-muted text-sm">${esc(product.category)}</p>
              </div>
              <span class="rounded-lg bg-surface-soft px-3 py-1 text-xs text-body">Stok: ${esc(product.stock)}${isCritical ? ' · rendah' : ''}</span>
            </div>
            <div class="mt-4 flex items-center justify-between">
              <span class="text-xl font-semibold text-ink">${formatCurrency(product.price)}</span>
              <span class="rounded-full px-3 py-1 text-xs font-semibold ${isCritical ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}">${isCritical ? 'Kritis' : 'Tersedia'}</span>
            </div>
          </div>
        </article>
      `;
    }).join('') || '<div class="col-span-full rounded-xl border border-dashed border-hairline bg-surface-soft p-8 text-center text-muted">Tidak ada produk sesuai filter.</div>';

    dom.productGrid.querySelectorAll('article[data-id]').forEach(card => {
      card.addEventListener('click', () => addToCart(card.dataset.id));
    });
  };

  const isExpired = (expiryDate) => {
    if (!expiryDate) return false;
    const today = new Date();
    today.setHours(0,0,0,0);
    return today > new Date(expiryDate);
  };

  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) return { label: '-', class: 'text-muted' };
    const today = new Date();
    today.setHours(0,0,0,0);
    const exp = new Date(expiryDate);
    const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: 'KEDALUWARSA', class: 'bg-rose-100 text-rose-800' };
    if (diffDays < 30) return { label: `Dekat (${diffDays} hr)`, class: 'bg-amber-100 text-amber-800' };
    return { label: 'Aman', class: 'bg-emerald-100 text-emerald-800' };
  };

  // Soft Paper: tandai item keranjang yang baru ditambah agar hanya baris itu yang dianimasikan
  let _cartEnterId = null;
  const addToCart = productId => {
    const product = state.products.find(item => item.id === productId);
    if (!product || product.stock <= 0) return;
    if (product.expiry_date && isExpired(product.expiry_date)) {
        alert('Produk ini sudah kedaluwarsa dan diblokir dari penjualan!');
        return;
    }

    if (!state.cart[productId]) {
      state.cart[productId] = { ...product, qty: 1 };
    } else {
      const nextQty = state.cart[productId].qty + 1;
      if (nextQty <= product.stock) state.cart[productId].qty = nextQty;
    }
    _cartEnterId = productId;
    state.cashAmount = 0;
    renderCart();
  };

  const updateCartItem = (productId, qty) => {
    const cartItem = state.cart[productId];
    if (!cartItem) return;
    if (qty <= 0) {
      delete state.cart[productId];
    } else if (qty <= cartItem.stock) {
      cartItem.qty = qty;
    }
    renderCart();
  };

  const removeCartItem = productId => {
    delete state.cart[productId];
    renderCart();
  };

  const renderCart = () => {
    const items = getCartItems();
    const totals = calculateCart();

    const enterId = _cartEnterId;
    _cartEnterId = null;
    dom.cartList.innerHTML = items.length ? items.map(item => `
      <div class="rounded-xl border border-hairline bg-surface-soft p-4${String(item.id) === String(enterId) ? ' cart-item-enter' : ''}">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h4 class="font-semibold text-ink">${esc(item.name)}</h4>
            <p class="text-muted text-sm">${formatCurrency(item.price)} x ${esc(item.qty)}</p>
          </div>
          <button data-remove="${esc(item.id)}" class="rounded-full bg-rose-100 px-3 py-2 text-rose-700">Hapus</button>
        </div>
        <div class="mt-3 flex items-center gap-2 text-sm text-body">
          <button data-decrease="${esc(item.id)}" class="rounded-lg border border-hairline bg-white px-3 py-2">−</button>
          <span class="font-semibold">${esc(item.qty)}</span>
          <button data-increase="${esc(item.id)}" class="rounded-lg border border-hairline bg-white px-3 py-2">+</button>
          <span class="ml-auto font-semibold text-ink">${formatCurrency(item.price * item.qty)}</span>
        </div>
      </div>
    `).join('') : '<div class="rounded-xl border border-dashed border-hairline bg-surface-soft p-8 text-center text-muted">Keranjang kosong. Tambahkan produk untuk memulai transaksi.</div>';

    dom.cartList.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => removeCartItem(btn.dataset.remove));
    });
    dom.cartList.querySelectorAll('[data-increase]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.increase;
        updateCartItem(id, state.cart[id].qty + 1);
      });
    });
    dom.cartList.querySelectorAll('[data-decrease]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.decrease;
        updateCartItem(id, state.cart[id].qty - 1);
      });
    });

    dom.cartCount.textContent = `${items.length} item`;
    dom.cartSubtotal.textContent = formatCurrency(totals.subtotal);
    dom.cartTax.textContent = formatCurrency(totals.tax);
    dom.cartTotal.textContent = formatCurrency(totals.total);
    dom.cashChange.textContent = formatCurrency(totals.change);
    // Jangan timpa input yang sedang diketik user
    const active = document.activeElement;
    if (active !== dom.discountPercent) dom.discountPercent.value = state.discountPercent;
    if (active !== dom.discountNominal) dom.discountNominal.value = state.discountNominal;
    if (active !== dom.cashInput) dom.cashInput.value = state.cashAmount;

    // Broadcast cart state ke customer display (jika channel aktif)
    _broadcastCartState();
  };

  const renderInventory = () => {
    // Update filter kategori dari data produk yang ada
    const cats = ['All', ...new Set(state.products.map(p => p.category).filter(Boolean))];
    const currentCat = dom.categoryFilter.value;
    dom.categoryFilter.innerHTML = cats.map(c =>
      `<option value="${esc(c)}"${c === currentCat ? ' selected' : ''}>${c === 'All' ? 'Semua Kategori' : esc(c)}</option>`
    ).join('');

    dom.inventoryTable.innerHTML = state.products.map(product => {
      const isLowStock = product.stock <= (product.minStock || 5);
      const criticalClass = isLowStock ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800';
      const rowClass = isLowStock ? 'border-b border-rose-200 bg-rose-50/30' : 'border-b border-hairline';
      const expStatus = getExpiryStatus(product.expiry_date);
      return `
        <tr class="${rowClass}">
          <td class="p-3 font-semibold">${esc(product.code)}</td>
          <td class="p-3">${esc(product.name)}${isLowStock ? ' <span class="text-rose-500 text-xs font-bold">⚠ Stok Rendah</span>' : ''}</td>
          <td class="p-3 text-xs text-muted font-mono">${esc(product.barcode || '-')}</td>
          <td class="p-3">${esc(product.category)}</td>
          <td class="p-3">${formatCurrency(product.price)}</td>
          <td class="p-3"><span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold ${criticalClass}">${product.stock} / min ${product.minStock || 5}</span></td>
          <td class="p-3"><span class="inline-flex rounded-full px-2 py-1 text-xs font-semibold ${expStatus.class}">${expStatus.label}</span></td>
          <td class="p-3 space-x-2 whitespace-nowrap">
            <button data-adjust="${product.id}" class="btn-icon rounded-lg bg-amber-600 px-3 py-2 text-white text-sm" title="Sesuaikan Stok">${icon('settings')}</button>
            <button data-ledger="${product.id}" class="btn-icon rounded-lg bg-primary px-3 py-2 text-white text-sm" title="Kartu Stok">${icon('clipboard')}</button>
            <button data-edit="${product.id}" class="rounded-lg bg-ink px-4 py-2 text-white text-sm">Edit</button>
            <button data-delete="${product.id}" class="rounded-lg bg-rose-600 px-4 py-2 text-white text-sm">Hapus</button>
          </td>
        </tr>
      `;
    }).join('');

    dom.inventoryTable.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openInventoryModal(btn.dataset.edit));
    });
    dom.inventoryTable.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteProduct(btn.dataset.delete));
    });
    dom.inventoryTable.querySelectorAll('[data-adjust]').forEach(btn => {
      btn.addEventListener('click', () => openAdjustmentModal(btn.dataset.adjust));
    });
    dom.inventoryTable.querySelectorAll('[data-ledger]').forEach(btn => {
      btn.addEventListener('click', () => openLedgerModal(btn.dataset.ledger));
    });
  };

  const renderHistory = () => {
    const transactions = getFilteredTransactions().slice().reverse();
    dom.historyTable.innerHTML = transactions.map(tx => {
      const time = new Date(tx.date).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short', year: 'numeric' });
      const productCount = tx.items.reduce((sum, item) => sum + item.qty, 0);
      const isToday = new Date(tx.date).toDateString() === new Date().toDateString();
      const diffDays = Math.ceil((new Date() - new Date(tx.date)) / (1000 * 60 * 60 * 24));
      const canReturn = tx.status !== 'void' && diffDays <= 3;
      const isVoided = tx.status === 'void';
      const rowClass = isVoided ? 'border-b border-hairline opacity-60 bg-rose-50/20' : 'border-b border-hairline';

      return `
        <tr class="${rowClass}">
          <td class="p-3">${time}</td>
          <td class="p-3">#${esc(tx.id)}</td>
          <td class="p-3">${esc(tx.cashier || '-')}</td>
          <td class="p-3 font-semibold">${formatCurrency(tx.total)}</td>
          <td class="p-3">${esc(productCount)} item</td>
          <td class="p-3"><span class="rounded-full px-2 py-0.5 text-xs font-medium ${tx.paymentMethod === 'Tunai' ? 'bg-green-100 text-green-700' : tx.paymentMethod === 'QRIS' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}">${esc(tx.paymentMethod || 'Tunai')}</span></td>
          <td class="p-3">${tx.paymentMethod === 'Tunai' || !tx.paymentMethod ? formatCurrency(tx.cash) : '-'}</td>
          <td class="p-3">${tx.paymentMethod === 'Tunai' || !tx.paymentMethod ? formatCurrency(tx.change) : '-'}</td>
          <td class="p-3 space-x-1 whitespace-nowrap">
            <button data-reprint="${esc(tx.id)}" class="btn-icon rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs text-body hover:bg-surface-soft transition whitespace-nowrap">${iconText('printer', 'Struk', 'icon icon-sm')}</button>
            ${isVoided ? `
              <span class="inline-block rounded-full bg-rose-100 text-rose-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider">VOID</span>
            ` : `
              ${isToday ? `<button data-void="${esc(tx.id)}" class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-100 transition whitespace-nowrap">🚫 Void</button>` : ''}
              ${canReturn ? `<button data-return="${esc(tx.id)}" class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100 transition whitespace-nowrap">↩️ Retur</button>` : ''}
            `}
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="9" class="p-8 text-center text-muted">Belum ada transaksi.</td></tr>';

    // Cetak ulang struk dari riwayat
    dom.historyTable.querySelectorAll('[data-reprint]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tx = state.transactions.find(t => t.id === btn.dataset.reprint);
        if (!tx) return;
        populateReceipt(tx);
        if (dom.printThermalBtn) dom.printThermalBtn._receiptData = tx;
        dom.receiptModal.classList.remove('hidden');
      });
    });

    // Void and Return click event listeners
    dom.historyTable.querySelectorAll('[data-void]').forEach(btn => {
      btn.addEventListener('click', () => voidTransaction(btn.dataset.void));
    });
    dom.historyTable.querySelectorAll('[data-return]').forEach(btn => {
      btn.addEventListener('click', () => processReturn(btn.dataset.return));
    });
  };

  const showScreen = screenId => {
    // Super admin screen hanya boleh dibuka oleh super admin terverifikasi
    if (screenId === 'screen-superadmin' && !_isSuperAdmin) {
      screenId = 'dashboard';
    }
    // Operator kasir tidak boleh membuka layar khusus admin
    const activeOp = state.cashiers.find(c => c.id === state.selectedCashierId);
    if (activeOp && activeOp.role !== 'admin' && ADMIN_SCREENS.includes(screenId)) {
      screenId = 'kasir';
    }
    if (screenId === 'kasir' && db && state.authUser && state.storeId && !_isSuperAdmin) {
      checkOrOpenShift();
    }
    dom.screens.forEach(screen => {
      const isTarget = screen.id === screenId;
      screen.classList.toggle('hidden', !isTarget);
      // Soft Paper: animasi enter hanya di layar aktif (bukan re-render ulang data)
      if (isTarget) {
        screen.classList.remove('screen-enter');
        void screen.offsetWidth;
        screen.classList.add('screen-enter');
      } else {
        screen.classList.remove('screen-enter');
      }
    });
    // Update sidebar and bottom nav active state
    document.querySelectorAll('.menu-btn, .bottom-nav-btn').forEach(btn => {
      const isActive = btn.dataset.screen === screenId;
      btn.classList.toggle('text-white', isActive);
      btn.classList.toggle('text-muted-soft', !isActive);
      btn.classList.toggle('bg-primary-active', isActive);
    });
    _activeScreenId = screenId;
    if (screenId === 'dashboard') { updateDashboard(); renderSalesChart(); renderReportSummary(); renderDashboardPusat(); }
    if (screenId === 'kasir') { renderProducts(); renderCart(); }
    if (screenId === 'inventory') renderInventory();
    if (screenId === 'riwayat') renderHistory();
    if (screenId === 'pembelian') renderPurchaseHistory();
    if (screenId === 'kasbon') { renderKasbon(); refreshDebtsFromServer(); }
    if (screenId === 'kelolaKasir') renderCashierManagement();
    if (screenId === 'pengaturan') renderSettings();
    if (screenId === 'screen-superadmin') superAdminLoadStores();
  };

  const showInventoryModal = (title = 'Tambah Produk') => {
    dom.inventoryModalTitle.textContent = title;
    dom.inventoryModal.classList.remove('hidden');
  };

  const hideInventoryModal = () => {
    dom.inventoryModal.classList.add('hidden');
    dom.inventoryForm.reset();
    dom.productId.value = '';
    dom.productCode.value = '';
    dom.productImage.value = 'https://via.placeholder.com/200';
  };

  const generateProductCode = () => {
    const maxNum = state.products.reduce((max, p) => {
      const n = parseInt(String(p.id || p.code).replace(/\D/g, ''));
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return 'P' + String(maxNum + 1).padStart(3, '0');
  };

  const openInventoryModal = productId => {
    if (!productId) {
      dom.inventoryForm.reset();
      dom.productId.value = '';
      dom.productCode.value = generateProductCode();
      dom.productImage.value = 'https://via.placeholder.com/200';
      if (document.getElementById('productExpiry')) document.getElementById('productExpiry').value = '';
      showInventoryModal('Tambah Produk');
      return;
    }
    const product = state.products.find(item => item.id === productId);
    if (!product) return;
    dom.productId.value = product.id;
    dom.productCode.value = product.code;
    dom.productName.value = product.name;
    dom.productCategory.value = product.category;
    dom.productPrice.value = product.price;
    dom.productCost.value = product.cost;
    dom.productStock.value = product.stock;
    dom.productImage.value = product.image || 'https://via.placeholder.com/200';
    dom.productBarcode.value = product.barcode || '';
    if (dom.productMinStock) dom.productMinStock.value = product.minStock || 5;
    if (document.getElementById('productExpiry')) document.getElementById('productExpiry').value = product.expiry_date || '';
    showInventoryModal('Edit Produk');
  };

  const deleteProduct = async productId => {
    if (!confirm('Hapus produk ini dari inventory?')) return;
    const numId = parseInt(productId);
    if (db && !isNaN(numId)) {
      const { error } = await db.from('products').delete().eq('id', numId);
      if (error) { alert('Gagal hapus produk: ' + friendlyError(error)); return; }
    }
    state.products = state.products.filter(item => item.id !== productId);
    syncStorage();
    renderInventory();
    renderProducts();
  };

  const BLOCKED_KEYWORDS = ['rokok', 'tembakau', 'cigarette', 'tobacco', 'vape', 'vaping', 'vapor', 'e-cig', 'ecig', 'shisha', 'hookah', 'marlboro', 'sampoerna', 'gudang garam', 'dji sam soe', 'la lights', 'camel', 'dunhill'];
  const isTobaccoProduct = text => BLOCKED_KEYWORDS.some(k => text.toLowerCase().includes(k));

  const saveProduct = async event => {
    event.preventDefault();
    const existingId = dom.productId.value;
    const name = dom.productName.value.trim();
    const category = dom.productCategory.value.trim();
    if (isTobaccoProduct(name) || isTobaccoProduct(category)) {
      alert('Produk tembakau dan vape tidak diizinkan di aplikasi ini.');
      return;
    }
    const pExp = document.getElementById('productExpiry');
    const dbPayload = {
      name,
      barcode: dom.productBarcode.value.trim() || null,
      category,
      price: Number(dom.productPrice.value) || 0,
      cost: Number(dom.productCost.value) || 0,
      stock: Number(dom.productStock.value) || 0,
      min_stock: Number(dom.productMinStock ? dom.productMinStock.value : 5) || 5,
      expiry_date: pExp && pExp.value ? pExp.value : null
    };

    let finalId = existingId;

    if (db) {
      const numId = parseInt(existingId);
      if (!isNaN(numId)) {
        // Update existing
        const { error } = await db.from('products').update(dbPayload).eq('id', numId);
        if (error) { alert('Gagal simpan produk: ' + friendlyError(error)); return; }
      } else {
        // Insert new
        const { data, error } = await db.from('products')
          .insert({ ...dbPayload, store_id: state.storeId }).select().single();
        if (error) { alert('Gagal tambah produk: ' + friendlyError(error)); return; }
        finalId = String(data.id);
      }
    }

    const productData = {
      id: finalId,
      code: 'P' + String(finalId).padStart(3, '0'),
      barcode: dbPayload.barcode || '',
      name: dbPayload.name,
      category: dbPayload.category,
      price: dbPayload.price,
      cost: dbPayload.cost,
      stock: dbPayload.stock,
      minStock: dbPayload.min_stock || 5,
      expiry_date: dbPayload.expiry_date,
      image: dom.productImage.value.trim() || 'https://via.placeholder.com/260'
    };

    const existingIndex = state.products.findIndex(item => item.id === existingId);
    if (existingIndex >= 0) {
      state.products[existingIndex] = productData;
    } else {
      state.products.push(productData);
    }
    syncStorage();
    renderInventory();
    renderProducts();
    hideInventoryModal();
  };

  // ── Antrean transaksi offline: simpan lokal saat gagal, sinkron saat online ─
  const OFFLINE_QUEUE_KEY = 'offline_tx_queue';
  const getOfflineQueue = () => {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; }
  };
  const generateClientId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now() + '-' + Math.random().toString(36).slice(2);
  };
  let paymentInFlight = false;
  let offlineQueueFlushing = false;
  const setPaymentUiBusy = busy => {
    const label = busy ? 'Menyimpan...' : 'Bayar';
    if (dom.payButton) {
      dom.payButton.disabled = !!busy;
      if (busy) {
        if (!dom.payButton.dataset.idleLabel) dom.payButton.dataset.idleLabel = dom.payButton.textContent || 'Bayar';
        dom.payButton.textContent = label;
      } else if (dom.payButton.dataset.idleLabel) {
        dom.payButton.textContent = dom.payButton.dataset.idleLabel;
      }
    }
    if (dom.paymentConfirmOk) {
      dom.paymentConfirmOk.disabled = !!busy;
      if (busy) {
        if (!dom.paymentConfirmOk.dataset.idleLabel) {
          dom.paymentConfirmOk.dataset.idleLabel = dom.paymentConfirmOk.textContent || 'Ya, Simpan';
        }
        dom.paymentConfirmOk.textContent = 'Menyimpan...';
      } else if (dom.paymentConfirmOk.dataset.idleLabel) {
        dom.paymentConfirmOk.textContent = dom.paymentConfirmOk.dataset.idleLabel;
      }
    }
  };
  const queueOfflineTransaction = entry => {
    const q = getOfflineQueue();
    const client_id = entry.client_id || generateClientId();
    q.push({ ...entry, client_id });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
  };
  // Pastikan items+stok lengkap untuk header yang sudah ada (idempotent: sisa items diinsert, sisa stok didecrement)
  const ensureSaleComplete = async (txId, items) => {
    if (!txId || !items || !items.length) return true;
    const { data: existingItems, error: lookupErr } = await db
      .from('transaction_items')
      .select('product_id, quantity')
      .eq('transaction_id', txId);
    if (lookupErr) throw lookupErr;

    const existingMap = new Map();
    if (Array.isArray(existingItems)) {
      existingItems.forEach(row => {
        const pid = row.product_id ? String(row.product_id) : null;
        if (pid) {
          existingMap.set(pid, (existingMap.get(pid) || 0) + Number(row.quantity || 0));
        }
      });
    }

    const missingItems = [];
    items.forEach(item => {
      const itemIdStr = String(item.id);
      const existingQty = existingMap.get(itemIdStr) || 0;
      const missingQty = item.qty - existingQty;
      if (missingQty > 0) {
        missingItems.push({
          ...item,
          qty: missingQty
        });
      }
    });

    if (missingItems.length === 0) return true; // sudah lengkap

    const itemRows = missingItems.map(item => ({
      transaction_id: txId,
      product_id: parseInt(item.id) || null,
      product_name: item.name,
      quantity: item.qty,
      price_at_sale: item.price,
      subtotal: item.qty * item.price
    }));
    const { error: itemsErr } = await db.from('transaction_items').insert(itemRows);
    if (itemsErr) throw itemsErr;

    for (const item of missingItems) {
      const numId = parseInt(item.id);
      if (isNaN(numId)) continue;
      if (!Number.isFinite(item.qty) || item.qty <= 0) continue;
      const { error: stockErr } = await db.rpc('decrement_stock', { p_product_id: numId, p_qty: item.qty });
      if (stockErr) throw stockErr;
    }
    return true;
  };

  const flushOfflineQueue = async () => {
    if (!db || !navigator.onLine || !state.storeId) return 0;
    if (offlineQueueFlushing) return 0;
    offlineQueueFlushing = true;
    try {
      const q = getOfflineQueue();
      if (!q.length) return 0;
      const remaining = [];
      let synced = 0;
      for (const entry of q) {
        // Legacy tanpa client_id: fallback stabil, jangan generate UUID baru di flush
        const clientId = entry.client_id || (entry.date + '-' + entry.total);
        const storeId = entry.store_id || state.storeId;
        try {
          const { data: tx, error: txErr } = await db.from('transactions').insert({
            store_id: storeId,
            cashier_name: entry.cashier,
            total_amount: entry.total,
            payment_amount: entry.cash,
            change_amount: entry.change,
            discount_amount: entry.discount || 0,
            payment_method: entry.paymentMethod || 'Tunai',
            confirmed_by: entry.confirmedBy || null,
            confirmed_at: entry.confirmedAt || null,
            created_at: entry.date,
            client_id: clientId,
            shift_id: entry.shiftId || null,
            status: entry.status || 'completed',
            payment_cash_amount: entry.paymentCashAmount || 0,
            payment_noncash_amount: entry.paymentNoncashAmount || 0
          }).select().single();
          if (txErr) throw txErr;
          await ensureSaleComplete(tx.id, entry.items || []);
          synced++;
        } catch (e) {
          // Duplikat (store_id, client_id) → pastikan items+stok lengkap dulu, baru drop
          if (e && e.code === '23505') {
            try {
              const { data: existing } = await db.from('transactions')
                .select('id')
                .eq('store_id', storeId)
                .eq('client_id', clientId)
                .maybeSingle();
              if (existing && existing.id) {
                await ensureSaleComplete(existing.id, entry.items || []);
                synced++;
                continue;
              }
              // 23505 tapi lookup gagal temukan → biarkan remaining coba lagi
              remaining.push(entry);
            } catch (reconcileErr) {
              logError('flushOfflineQueue: reconcile 23505 gagal', { clientId }, reconcileErr);
              remaining.push(entry);
            }
            continue;
          }
          remaining.push(entry);
        }
      }
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
      if (synced > 0) console.log(`${synced} transaksi offline tersinkron ke cloud.`);
      return synced;
    } finally {
      offlineQueueFlushing = false;
    }
  };

  // ── Kirim struk via WhatsApp (gratis — sekaligus promosi aplikasi) ────────
  const sendReceiptWhatsApp = data => {
    const store = getStoreSettings();
    const rp = n => 'Rp' + Number(n || 0).toLocaleString('id-ID');
    const lines = [];
    lines.push(`*${store.name}*`);
    if (store.address) lines.push(store.address);
    lines.push('--------------------------------');
    lines.push(`No: ${data.id || '-'}`);
    lines.push(`Tgl: ${new Date(data.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
    lines.push(`Kasir: ${data.cashier || '-'}`);
    lines.push('--------------------------------');
    data.items.forEach(item => {
      lines.push(`${item.name}`);
      lines.push(`  ${item.qty} x ${rp(item.price)} = ${rp(item.qty * item.price)}`);
    });
    lines.push('--------------------------------');
    if (data.discount > 0) lines.push(`Diskon: -${rp(data.discount)}`);
    lines.push(`*TOTAL: ${rp(data.total)}*`);
    lines.push(`${data.paymentMethod || 'Tunai'}: ${rp(data.cash)}`);
    lines.push(`Kembali: ${rp(data.change)}`);
    lines.push('--------------------------------');
    lines.push(store.note || 'Terima kasih!');
    lines.push('');
    lines.push('_Struk digital dari Kasir UMKM Simpel_');
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  };

  const handlePayment = async () => {
    if (paymentInFlight) return;
    const cartItems = getCartItems();
    if (!cartItems.length) {
      alert('Keranjang masih kosong. Tambahkan produk terlebih dahulu.');
      return;
    }
    const totals = calculateCart();
    if (totals.total <= 0) {
      alert('Total transaksi tidak valid. Periksa diskon dan jumlah produk.');
      return;
    }
    if (state.paymentMethod === 'Split') {
      const valCash = Number(document.getElementById('splitCashInput')?.value) || 0;
      const valNonCash = Number(document.getElementById('splitNonCashInput')?.value) || 0;
      if (valCash + valNonCash !== totals.total) {
        alert('Total porsi split (Tunai + Non-Tunai) harus sama dengan Total Akhir: ' + formatCurrency(totals.total));
        return;
      }
      const cashier = getSelectedCashier();
      showPaymentConfirmModal('Split Payment', totals.total, cashier.name);
    } else if (state.paymentMethod === 'Tunai') {
      if (totals.cash < totals.total) {
        alert('Jumlah tunai belum cukup. Mohon masukkan nominal yang sesuai.');
        return;
      }
      // Cash: proceed directly without modal, confirmed_by/confirmed_at stay null
      await _executePayment(cartItems, totals, null, null);
    } else {
      // QRIS/Transfer: show modal so cashier confirms receipt before saving
      const cashier = getSelectedCashier();
      showPaymentConfirmModal(state.paymentMethod, totals.total, cashier.name);
      // Actual save is triggered by paymentConfirmOk click (wired in initEventListeners)
    }
  };

  const _executePayment = async (cartItems, totals, confirmedBy, confirmedAt, opts) => {
    const alreadyLocked = opts && opts.alreadyLocked;
    if (!alreadyLocked) {
      if (paymentInFlight) return;
      paymentInFlight = true;
      setPaymentUiBusy(true);
    }
    try {
      if (state.paymentMethod === 'Split') {
        const valCash = Number(document.getElementById('splitCashInput')?.value) || 0;
        totals.cash = valCash;
        totals.change = 0;
      } else if (state.paymentMethod !== 'Tunai') {
        // QRIS/Transfer: nominal bayar otomatis = total, tanpa kembalian
        state.cashAmount = totals.total;
        totals.cash = totals.total;
        totals.change = 0;
      }

      const cashier = getSelectedCashier();
      let invoiceId = `INV${Date.now()}`;
      let dbTx = null;
      // Satu client_id per percobaan bayar (online + offline queue + flush)
      const clientId = generateClientId();

      const valCash = state.paymentMethod === 'Split' ? (Number(document.getElementById('splitCashInput')?.value) || 0) : (state.paymentMethod === 'Tunai' ? totals.total : 0);
      const valNonCash = state.paymentMethod === 'Split' ? (Number(document.getElementById('splitNonCashInput')?.value) || 0) : (state.paymentMethod !== 'Tunai' ? totals.total : 0);

      if (db) {
        try {
          // Insert transaction header
          const { data: tx, error: txErr } = await db.from('transactions').insert({
            store_id: state.storeId,
            cashier_name: cashier.name,
            total_amount: totals.total,
            payment_amount: totals.cash,
            change_amount: totals.change,
            discount_amount: totals.discount || 0,
            payment_method: state.paymentMethod || 'Tunai',
            confirmed_by: confirmedBy,
            confirmed_at: confirmedAt,
            shift_id: state.activeShift ? state.activeShift.id : null,
            status: 'completed',
            payment_cash_amount: valCash,
            payment_noncash_amount: valNonCash,
            client_id: clientId
          }).select().single();
          if (txErr) throw txErr;

          dbTx = tx;
          invoiceId = 'INV' + tx.id;

          // Insert transaction items
          const itemRows = cartItems.map(item => ({
            transaction_id: tx.id,
            product_id: parseInt(item.id) || null,
            product_name: item.name,
            quantity: item.qty,
            price_at_sale: item.price,
            subtotal: item.qty * item.price
          }));
          const { error: itemsErr } = await db.from('transaction_items').insert(itemRows);
          if (itemsErr) throw itemsErr;

          // Update stock in Supabase (atomic — prevents race condition between concurrent tabs)
          for (const item of cartItems) {
            const numId = parseInt(item.id);
            if (isNaN(numId)) continue;
            if (!Number.isFinite(item.qty) || item.qty <= 0) continue;
            const { error: stockErr } = await db.rpc('decrement_stock', { p_product_id: numId, p_qty: item.qty });
            if (stockErr) throw stockErr;
          }
        } catch (err) {
          const errCode = err && err.code;
          const cartSnapshot = cartItems.map(item => ({ id: item.id, name: item.name, qty: item.qty, price: item.price }));
          // Unique (store_id, client_id) → header sudah ada; reconcile items+stok, jangan antrian baru
          if (errCode === '23505') {
            try {
              const { data: existing } = await db.from('transactions')
                .select('id')
                .eq('store_id', state.storeId)
                .eq('client_id', clientId)
                .maybeSingle();
              if (existing && existing.id) {
                await ensureSaleComplete(existing.id, cartSnapshot);
                dbTx = existing;
                invoiceId = 'INV' + existing.id;
              } else {
                logError('_executePayment: 23505 tanpa baris client_id', { clientId }, err);
                alert('Transaksi mungkin sudah tercatat. Periksa riwayat sebelum mencoba lagi.');
                return;
              }
            } catch (lookupErr) {
              logError('_executePayment: reconcile 23505 gagal', { clientId }, lookupErr);
              alert('Gagal memastikan transaksi di server. Periksa riwayat atau coba lagi saat koneksi stabil.');
              return;
            }
          } else if (dbTx) {
            // Header sudah ter-insert; partial → repair idempotent; gagal repair = jangan anggap sukses lokal
            logError('_executePayment: partial setelah header', { txId: dbTx.id, clientId }, err);
            try {
              await ensureSaleComplete(dbTx.id, cartSnapshot);
            } catch (repairErr) {
              logError('_executePayment: repair partial gagal', { txId: dbTx.id, clientId }, repairErr);
              // Simpan antrean dengan client_id sama agar flush bisa resolve items+stok (tanpa double header)
              queueOfflineTransaction({
                store_id: state.storeId,
                cashier: cashier.name,
                total: totals.total,
                cash: totals.cash,
                change: totals.change,
                discount: totals.discount || 0,
                paymentMethod: state.paymentMethod || 'Tunai',
                confirmedBy: confirmedBy,
                confirmedAt: confirmedAt,
                items: cartSnapshot,
                date: new Date().toISOString(),
                client_id: clientId,
                shiftId: state.activeShift ? state.activeShift.id : null,
                status: 'completed',
                paymentCashAmount: valCash,
                paymentNoncashAmount: valNonCash
              });
              alert('Transaksi tersimpan sebagian di server. Akan dilengkapi otomatis saat koneksi stabil. Struk tetap bisa dicetak.');
            }
          } else if (typeof isNetworkError === 'function' ? isNetworkError(err) : /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(err?.message || '')) {
            // Network: cek dulu apakah header sudah masuk (timeout setelah commit)
            let recovered = false;
            try {
              const { data: existing } = await db.from('transactions')
                .select('id')
                .eq('store_id', state.storeId)
                .eq('client_id', clientId)
                .maybeSingle();
              if (existing && existing.id) {
                await ensureSaleComplete(existing.id, cartSnapshot);
                dbTx = existing;
                invoiceId = 'INV' + existing.id;
                recovered = true;
              }
            } catch (recoverErr) {
              // lookup gagal (masih offline) → antrean offline
              logError('_executePayment: recover setelah network gagal', { clientId }, recoverErr);
            }
            if (!recovered) {
              queueOfflineTransaction({
                store_id: state.storeId,
                cashier: cashier.name,
                total: totals.total,
                cash: totals.cash,
                change: totals.change,
                discount: totals.discount || 0,
                paymentMethod: state.paymentMethod || 'Tunai',
                confirmedBy: confirmedBy,
                confirmedAt: confirmedAt,
                items: cartSnapshot,
                date: new Date().toISOString(),
                client_id: clientId,
                shiftId: state.activeShift ? state.activeShift.id : null,
                status: 'completed',
                paymentCashAmount: valCash,
                paymentNoncashAmount: valNonCash
              });
              alert('Koneksi bermasalah — transaksi DISIMPAN OFFLINE dan akan otomatis tersinkron saat internet kembali. Struk tetap bisa dicetak.');
            }
          } else {
            logError('_executePayment: gagal simpan transaksi', { clientId }, err);
            alert('Gagal menyimpan transaksi. ' + (err?.message || 'Coba lagi atau periksa koneksi.'));
            return;
          }
        }
      } else {
        queueOfflineTransaction({
          store_id: state.storeId,
          cashier: cashier.name,
          total: totals.total,
          cash: totals.cash,
          change: totals.change,
          discount: totals.discount || 0,
          paymentMethod: state.paymentMethod || 'Tunai',
          confirmedBy: confirmedBy,
          confirmedAt: confirmedAt,
          items: cartItems.map(item => ({ id: item.id, name: item.name, qty: item.qty, price: item.price })),
          date: new Date().toISOString(),
          client_id: clientId,
          shiftId: state.activeShift ? state.activeShift.id : null,
          status: 'completed',
          paymentCashAmount: valCash,
          paymentNoncashAmount: valNonCash
        });
      }

      const transaction = {
        id: invoiceId,
        dbId: dbTx ? dbTx.id : null,
        clientId: clientId,
        date: new Date().toISOString(),
        cashier: cashier.name,
        items: cartItems.map(item => ({ id: item.id, name: item.name, qty: item.qty, price: item.price, cost: item.cost, subtotal: item.qty * item.price })),
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
        cash: totals.cash,
        change: totals.change,
        paymentMethod: state.paymentMethod || 'Tunai',
        confirmedBy: confirmedBy,
        confirmedAt: confirmedAt,
        status: 'completed',
        paymentCashAmount: valCash,
        paymentNoncashAmount: valNonCash,
        shiftId: state.activeShift ? state.activeShift.id : null
      };

      state.transactions.unshift(transaction);
      state.currentTransaction = transaction;
      cartItems.forEach(item => {
        const product = state.products.find(productItem => productItem.id === item.id);
        if (product) product.stock = Math.max(0, product.stock - item.qty);
      });
      state.cart = {};
      state.cashAmount = 0;
      state.discountPercent = 0;
      state.discountNominal = 0;
      syncStorage();
      // F3: payment-complete SEBELUM renderCart (yang akan broadcast idle karena cart kosong)
      _broadcastPaymentComplete(transaction);
      renderCart();
      renderInventory();
      renderHistory();
      updateDashboard();
      renderSalesChart();
      setPaymentMethod('Tunai'); // kembalikan default untuk transaksi berikutnya
      // Langsung tampilkan struk agar kasir tinggal klik cetak
      populateReceipt(transaction);
      if (dom.printThermalBtn) dom.printThermalBtn._receiptData = transaction;
      dom.receiptModal.classList.remove('hidden');
    } finally {
      paymentInFlight = false;
      setPaymentUiBusy(false);
    }
  };

  const openReceipt = () => {
    let receiptData = null;
    if (getCartItems().length) {
      const totals = calculateCart();
      receiptData = { items: getCartItems(), ...totals, date: new Date().toISOString() };
    } else if (state.currentTransaction) {
      receiptData = state.currentTransaction;
    }
    if (!receiptData) {
      alert('Keranjang kosong. Tambahkan transaksi terlebih dahulu untuk melihat struk.');
      return;
    }
    populateReceipt(receiptData);
    if (dom.printThermalBtn) dom.printThermalBtn._receiptData = receiptData;
    dom.receiptModal.classList.remove('hidden');
  };

  const populateReceipt = (data) => {
    const store = getStoreSettings();
    const cashier = getSelectedCashier();

    dom.receiptStoreName.textContent = store.name;
    dom.receiptStoreAddress.textContent = store.address || '';
    dom.receiptStorePhone.textContent = store.phone ? 'Telp: ' + store.phone : '';
    dom.receiptStoreNote.textContent = store.note || 'Terima kasih!';
    dom.receiptStoreAddress.style.display = store.address ? '' : 'none';
    dom.receiptStorePhone.style.display = store.phone ? '' : 'none';

    dom.receiptId.textContent = data.id || '-';
    dom.receiptDate.textContent = new Date(data.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    dom.receiptCashierName.textContent = data.cashier || cashier.name;

    dom.receiptItems.innerHTML = data.items.map(item => `
      <div>
        <div class="flex justify-between font-medium">${esc(item.name)}<span>${formatCurrency(item.price * item.qty)}</span></div>
        <div class="text-muted ml-1">${item.qty} x ${formatCurrency(item.price)}</div>
      </div>
    `).join('');

    dom.receiptSubtotal.textContent = formatCurrency(data.subtotal);
    dom.receiptDiscount.textContent = formatCurrency(data.discount || 0);
    dom.receiptTax.textContent = formatCurrency(data.tax || 0);
    dom.receiptTotal.textContent = formatCurrency(data.total);
    const pm = data.paymentMethod || state.paymentMethod || 'Tunai';
    const pmLabel = document.getElementById('receiptPaymentMethodLabel');
    if (pmLabel) pmLabel.textContent = pm;
    dom.receiptCash.textContent = formatCurrency(data.cash);
    dom.receiptChange.textContent = formatCurrency(data.change);

    dom.receiptDiscountRow.style.display = data.discount > 0 ? '' : 'none';
    dom.receiptTaxRow.style.display = data.tax > 0 ? '' : 'none';
  };

  const printThermal = data => {
    const store = getStoreSettings();
    const cashier = getSelectedCashier();
    const thermalCSS = document.getElementById('thermalStyle').textContent;
    const paperWidth = store.paperSize === '80' ? '80mm' : '58mm';

    const itemsHtml = data.items.map(item => `
      <div class="row-item">
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-total">${formatCurrency(item.price * item.qty)}</span>
      </div>
      <div class="item-detail">${item.qty} x ${formatCurrency(item.price)}</div>
    `).join('');

    const discountHtml = data.discount > 0
      ? `<div class="row"><span>Diskon</span><span>-${formatCurrency(data.discount)}</span></div>` : '';
    const taxHtml = data.tax > 0
      ? `<div class="row"><span>Pajak 11%</span><span>${formatCurrency(data.tax)}</span></div>` : '';

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Struk</title>
<style>
${thermalCSS}
body { width: ${paperWidth}; }
@media print { @page { size: ${paperWidth} auto; margin: 0; } }
</style>
</head><body>
<p class="center big">${esc(store.name)}</p>
${store.address ? `<p class="center">${esc(store.address)}</p>` : ''}
${store.phone ? `<p class="center">Telp: ${esc(store.phone)}</p>` : ''}
<div class="separator"></div>
<div class="row"><span>No</span><span>${esc(data.id || '-')}</span></div>
<div class="row"><span>Tgl</span><span>${new Date(data.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
<div class="row"><span>Kasir</span><span>${esc(data.cashier || cashier.name)}</span></div>
<div class="separator"></div>
${itemsHtml}
<div class="separator"></div>
<div class="row"><span>Subtotal</span><span>${formatCurrency(data.subtotal)}</span></div>
${discountHtml}${taxHtml}
<div class="separator-solid"></div>
<div class="total-row"><span>TOTAL</span><span>${formatCurrency(data.total)}</span></div>
<div class="row"><span>${esc(data.paymentMethod || 'Tunai')}</span><span>${formatCurrency(data.cash)}</span></div>
<div class="row bold"><span>Kembali</span><span>${formatCurrency(data.change)}</span></div>
<div class="separator"></div>
<p class="footer">${esc(store.note || 'Terima kasih!')}</p>
<br/><br/>
</body></html>`;

    const win = window.open('', '_blank', `width=300,height=500`);
    if (!win) { alert('Popup diblokir browser. Izinkan popup untuk cetak struk.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  // ── Cetak Bluetooth via RawBT (printer thermal Bluetooth di Android) ──────
  const buildPlainReceipt = data => {
    const store = getStoreSettings();
    const cashier = getSelectedCashier();
    const width = store.paperSize === '80' ? 46 : 32;
    const line = ch => ch.repeat(width);
    const center = t => {
      t = String(t).slice(0, width);
      const pad = Math.max(0, Math.floor((width - t.length) / 2));
      return ' '.repeat(pad) + t;
    };
    const row = (l, r) => {
      l = String(l); r = String(r);
      const space = Math.max(1, width - l.length - r.length);
      return l + ' '.repeat(space) + r;
    };
    const rp = n => 'Rp' + Number(n || 0).toLocaleString('id-ID');

    const out = [];
    out.push(center(store.name));
    if (store.address) out.push(center(store.address));
    if (store.phone) out.push(center('Telp: ' + store.phone));
    out.push(line('-'));
    out.push(row('No', data.id || '-'));
    out.push(row('Tgl', new Date(data.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })));
    out.push(row('Kasir', data.cashier || cashier.name));
    out.push(line('-'));
    data.items.forEach(item => {
      out.push(item.name.slice(0, width));
      out.push(row('  ' + item.qty + ' x ' + rp(item.price), rp(item.price * item.qty)));
    });
    out.push(line('-'));
    out.push(row('Subtotal', rp(data.subtotal)));
    if (data.discount > 0) out.push(row('Diskon', '-' + rp(data.discount)));
    out.push(line('='));
    out.push(row('TOTAL', rp(data.total)));
    out.push(row(data.paymentMethod || 'Tunai', rp(data.cash)));
    out.push(row('Kembali', rp(data.change)));
    out.push(line('-'));
    out.push(center(store.note || 'Terima kasih!'));
    out.push('');
    out.push('');
    return out.join('\n');
  };

  const printViaRawBT = data => {
    const text = buildPlainReceipt(data);
    // Skema intent: buka RawBT jika terpasang, jika tidak arahkan ke Play Store
    const intentUrl = 'intent:' + encodeURIComponent(text) +
      '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;' +
      'S.browser_fallback_url=' + encodeURIComponent('https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter') + ';end;';
    try {
      window.location.href = intentUrl;
    } catch (e) {
      window.location.href = 'rawbt:' + encodeURIComponent(text);
    }
  };

  // ── Pengaturan Toko ───────────────────────────────────────────────────────
  const renderSettings = () => {
    applySuperAdminVisibility();
    const versionEl = document.getElementById('appVersionDisplay');
    if (versionEl) versionEl.textContent = APP_VERSION;
    if (_isSuperAdmin && !state.storeId) return;
    renderBranchList();
    const store = getStoreSettings();
    if (dom.settingStoreName) dom.settingStoreName.value = store.name;
    if (dom.settingStoreAddress) dom.settingStoreAddress.value = store.address;
    if (dom.settingStorePhone) dom.settingStorePhone.value = store.phone;
    if (dom.settingStoreNote) dom.settingStoreNote.value = store.note;
    if (dom.settingPaperSize) dom.settingPaperSize.value = store.paperSize;
    updateSettingsPreview(store);
    // Tampilkan preview QRIS jika sudah diupload
    const qrisImg = getQrisImage();
    const wrapper = document.getElementById('qrisPreviewWrapper');
    const previewImg = document.getElementById('qrisPreviewImg');
    if (wrapper && previewImg) {
      if (qrisImg) {
        previewImg.src = qrisImg;
        wrapper.classList.remove('hidden');
      } else {
        wrapper.classList.add('hidden');
      }
    }
  };

  const updateSettingsPreview = store => {
    if (dom.previewStoreName) dom.previewStoreName.textContent = store.name || 'NAMA TOKO';
    if (dom.previewStoreAddress) dom.previewStoreAddress.textContent = store.address || 'Alamat toko';
    if (dom.previewStorePhone) dom.previewStorePhone.textContent = store.phone ? 'Telp: ' + store.phone : 'No. Telepon';
    if (dom.previewStoreNote) dom.previewStoreNote.textContent = store.note || 'Terima kasih!';
  };
  // ─────────────────────────────────────────────────────────────────────────

  const closeReceipt = () => {
    dom.receiptModal.classList.add('hidden');
    // Setelah struk ditutup, kembalikan customer display ke idle
    _broadcastIdle();
  };

  // ── Feature: Export PDF Laporan ──────────────────────────────────────────
  const exportReportPDF = () => {
    const store = getStoreSettings();
    const days = Number(state.reportRange) || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    cutoff.setHours(0, 0, 0, 0); // mulai dari awal hari (lokal) agar penjualan pagi ikut terhitung
    const filtered = state.transactions.filter(tx => new Date(tx.date) >= cutoff);
    const totalSales = filtered.reduce((sum, tx) => sum + tx.total, 0);
    const totalTrans = filtered.length;
    const totalItems = filtered.reduce((sum, tx) => sum + tx.items.reduce((s, i) => s + i.qty, 0), 0);
    const totalProfit = filtered.reduce((sum, tx) => sum + tx.items.reduce((s, i) => s + i.qty * (i.price - i.cost), 0) - (tx.tax || 0), 0);

    const txRows = filtered.slice(0, 100).map(tx => {
      const time = new Date(tx.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #E7E2DB">${time}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #E7E2DB">${esc(tx.id)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #E7E2DB">${esc(tx.cashier || '-')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #E7E2DB;text-align:right">${formatCurrency(tx.total)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #E7E2DB">${esc(tx.paymentMethod || 'Tunai')}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Laporan ${esc(store.name)}</title>
<style>
  body{font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:12px;color:#44403C;padding:0;margin:0}
  h1{margin:0 0 4px;font-size:20px}
  .header{background:#CC6B49;color:#fff;padding:20px 24px}
  .content{padding:20px 24px}
  .stats{display:flex;gap:16px;margin:16px 0;flex-wrap:wrap}
  .stat{flex:1;min-width:120px;background:#F5F2EB;border:1px solid #E7E2DB;border-radius:8px;padding:12px;text-align:center}
  .stat-val{font-size:18px;font-weight:bold;color:#26231F}
  .stat-lbl{font-size:10px;color:#78716C;text-transform:uppercase;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:#EDE7DB;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#44403C}
  @media print{@page{size:A4;margin:15mm}}
</style></head><body>
<div class="header">
  <h1>${esc(store.name)}</h1>
  <p style="margin:0;opacity:.8;font-size:12px">Laporan ${days === 1 ? 'Hari Ini' : days + ' Hari Terakhir'} — Dicetak: ${new Date().toLocaleDateString('id-ID', {day:'2-digit',month:'long',year:'numeric'})}</p>
</div>
<div class="content">
  <div class="stats">
    <div class="stat"><div class="stat-val">${formatCurrency(totalSales)}</div><div class="stat-lbl">Total Penjualan</div></div>
    <div class="stat"><div class="stat-val">${totalTrans}</div><div class="stat-lbl">Transaksi</div></div>
    <div class="stat"><div class="stat-val">${totalItems}</div><div class="stat-lbl">Item Terjual</div></div>
    <div class="stat"><div class="stat-val">${formatCurrency(totalProfit)}</div><div class="stat-lbl">Est. Keuntungan</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Waktu</th><th>Invoice</th><th>Kasir</th><th style="text-align:right">Total</th><th>Metode</th>
    </tr></thead>
    <tbody>${txRows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada transaksi pada periode ini.</td></tr>'}</tbody>
  </table>
</div>
<script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}<\/script>
</body></html>`;

    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) { alert('Popup diblokir. Izinkan popup untuk export PDF.'); return; }
    win.document.write(html);
    win.document.close();
  };

  // ── Feature: Shift / Tutup Kasir & Supervisor Otorisasi ───────────────────
  const loadActiveShift = async () => {
    if (!db || !state.storeId || !state.selectedCashierId) return null;
    if (/^C\d+$/.test(String(state.selectedCashierId))) {
      state.activeShift = null;
      state.shiftStartTime = null;
      return null;
    }
    try {
      const { data, error } = await db
        .from('cashier_shifts')
        .select('*')
        .eq('store_id', state.storeId)
        .eq('cashier_id', state.selectedCashierId)
        .is('closed_at', null)
        .order('opened_at', { ascending: false })
        .limit(1);
      if (!error && data && data.length > 0) {
        state.activeShift = data[0];
        state.shiftStartTime = new Date(state.activeShift.opened_at);
        return state.activeShift;
      }
    } catch (e) {
      console.error('Error loadActiveShift:', e);
    }
    state.activeShift = null;
    state.shiftStartTime = null;
    return null;
  };

  const checkOrOpenShift = async () => {
    const active = await loadActiveShift();
    if (!active) {
      openBukaShiftModal();
    } else {
      hideBukaShiftModal();
    }
  };

  const openBukaShiftModal = () => {
    const modal = document.getElementById('openShiftModalEl');
    if (modal) {
      modal.classList.remove('hidden');
      const input = document.getElementById('openShiftCashFloat');
      if (input) {
        input.value = '100000';
        input.focus();
      }
    }
  };

  const hideBukaShiftModal = () => {
    const modal = document.getElementById('openShiftModalEl');
    if (modal) {
      modal.classList.add('hidden');
    }
  };

  const openTutupShiftModal = async () => {
    const cashier = getSelectedCashier();
    if (!state.activeShift) {
      alert('Tidak ada shift aktif saat ini.');
      return;
    }

    const shiftStart = new Date(state.activeShift.opened_at);
    const shiftTx = state.transactions.filter(tx => 
      tx.status !== 'void' && 
      tx.shiftId === state.activeShift.id
    );
    const totalSales = shiftTx.reduce((sum, tx) => sum + tx.total, 0);
    const totalItems = shiftTx.reduce((sum, tx) => sum + tx.items.reduce((s, i) => s + i.qty, 0), 0);
    const startStr = shiftStart.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    // Calculate Tunai sales + split cash portions
    const cashSales = shiftTx.reduce((sum, tx) => {
      if (tx.paymentMethod === 'Tunai') {
        return sum + tx.total;
      } else if (tx.paymentMethod === 'Split') {
        return sum + (tx.paymentCashAmount || 0);
      }
      return sum;
    }, 0);

    // Calculate refunds in this shift
    let refundAmount = 0;
    if (db) {
      const { data: shiftReturns } = await db
        .from('transaction_returns')
        .select('*')
        .eq('store_id', state.storeId)
        .gte('created_at', state.activeShift.opened_at);
      refundAmount = (shiftReturns || []).reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);
    }

    const expectedCash = Number(state.activeShift.cash_float_amount) + cashSales - refundAmount;

    if (dom.shiftCashierName) dom.shiftCashierName.textContent = cashier.name;
    if (dom.shiftTxCount) dom.shiftTxCount.textContent = shiftTx.length;
    if (dom.shiftTotalSales) dom.shiftTotalSales.textContent = formatCurrency(totalSales);
    if (dom.shiftItemsSold) dom.shiftItemsSold.textContent = totalItems;
    if (dom.shiftModalSubtitle) dom.shiftModalSubtitle.textContent = `Shift dimulai: ${startStr}`;

    const elFloat = document.getElementById('shiftModalFloat');
    const elCashSales = document.getElementById('shiftModalCashSales');
    const elRefunds = document.getElementById('shiftModalRefunds');
    const elExpected = document.getElementById('shiftModalExpected');
    const elActual = document.getElementById('shiftActualCashInput');
    const elDiscrepancy = document.getElementById('shiftDiscrepancy');
    const elNote = document.getElementById('shiftNoteInput');

    if (elFloat) elFloat.textContent = formatCurrency(state.activeShift.cash_float_amount);
    if (elCashSales) elCashSales.textContent = formatCurrency(cashSales);
    if (elRefunds) elRefunds.textContent = formatCurrency(refundAmount);
    if (elExpected) elExpected.textContent = formatCurrency(expectedCash);
    if (elActual) elActual.value = expectedCash;
    if (elNote) elNote.value = '';

    const recalculateClosingDiscrepancy = () => {
      const actual = Number(elActual?.value) || 0;
      const discrepancy = actual - expectedCash;
      if (elDiscrepancy) {
        elDiscrepancy.textContent = formatCurrency(discrepancy);
        if (discrepancy === 0) {
          elDiscrepancy.className = "text-green-600 font-bold text-sm";
        } else if (discrepancy > 0) {
          elDiscrepancy.className = "text-blue-600 font-bold text-sm";
        } else {
          elDiscrepancy.className = "text-rose-600 font-bold text-sm";
        }
      }
    };

    elActual?.removeEventListener('input', recalculateClosingDiscrepancy);
    elActual?.addEventListener('input', recalculateClosingDiscrepancy);
    recalculateClosingDiscrepancy();

    if (dom.shiftModal) {
      dom.shiftModal.classList.remove('hidden');
    }
  };

  const closeShiftModal = () => {
    if (dom.shiftModal) {
      dom.shiftModal.classList.add('hidden');
    }
  };

  const printShiftReport = async () => {
    const store = getStoreSettings();
    const cashier = getSelectedCashier();
    if (!state.activeShift) return;

    const shiftStart = new Date(state.activeShift.opened_at);
    const shiftTx = state.transactions.filter(tx => 
      tx.status !== 'void' && 
      tx.shiftId === state.activeShift.id
    );
    const totalSales = shiftTx.reduce((sum, tx) => sum + tx.total, 0);
    const totalItems = shiftTx.reduce((sum, tx) => sum + tx.items.reduce((s, i) => s + i.qty, 0), 0);
    const thermalCSS = document.getElementById('thermalStyle').textContent;

    const cashSales = shiftTx.reduce((sum, tx) => {
      if (tx.paymentMethod === 'Tunai') {
        return sum + tx.total;
      } else if (tx.paymentMethod === 'Split') {
        return sum + (tx.paymentCashAmount || 0);
      }
      return sum;
    }, 0);

    let refundAmount = 0;
    if (db) {
      const { data: shiftReturns } = await db
        .from('transaction_returns')
        .select('*')
        .eq('store_id', state.storeId)
        .gte('created_at', state.activeShift.opened_at);
      refundAmount = (shiftReturns || []).reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);
    }
    const expected = Number(state.activeShift.cash_float_amount) + cashSales - refundAmount;

    const txRows = shiftTx.slice(0, 50).map(tx => {
      const time = new Date(tx.date).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' });
      return `<div class="row"><span>${time} ${esc(tx.id.slice(-6))}</span><span>${formatCurrency(tx.total)}</span></div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Laporan Shift</title>
<style>${thermalCSS}</style></head><body>
<p class="center big">${esc(store.name)}</p>
<p class="center">LAPORAN SHIFT</p>
<div class="separator"></div>
<div class="row"><span>Kasir</span><span>${esc(cashier.name)}</span></div>
<div class="row"><span>Mulai</span><span>${shiftStart.toLocaleString('id-ID')}</span></div>
<div class="row"><span>Cetak</span><span>${new Date().toLocaleString('id-ID')}</span></div>
<div class="separator"></div>
<div class="row"><span>Modal Awal</span><span>${formatCurrency(state.activeShift.cash_float_amount)}</span></div>
<div class="row"><span>Penjualan Tunai</span><span>${formatCurrency(cashSales)}</span></div>
<div class="row"><span>Refund Tunai</span><span>${formatCurrency(refundAmount)}</span></div>
<div class="row"><span>Sistem Total Kas</span><span>${formatCurrency(expected)}</span></div>
<div class="separator"></div>
<div class="row"><span>Transaksi</span><span>${shiftTx.length}</span></div>
<div class="row"><span>Item Terjual</span><span>${totalItems}</span></div>
<div class="separator-solid"></div>
<div class="total-row"><span>TOTAL OMZET</span><span>${formatCurrency(totalSales)}</span></div>
<div class="separator"></div>
${txRows}
<br/><br/>
<script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}<\/script>
</body></html>`;

    const win = window.open('', '_blank', 'width=300,height=500');
    if (!win) { alert('Popup diblokir.'); return; }
    win.document.write(html);
    win.document.close();
  };

  const submitTutupShift = async () => {
    if (!state.activeShift) return;
    if (!confirm('Tutup shift ini sekarang? Anda akan keluar dan shift baru harus dibuka sebelum bertransaksi kembali.')) return;
    
    const elActual = document.getElementById('shiftActualCashInput');
    const elNote = document.getElementById('shiftNoteInput');
    const actual = Number(elActual?.value) || 0;
    
    const shiftTx = state.transactions.filter(tx => 
      tx.status !== 'void' && 
      tx.shiftId === state.activeShift.id
    );
    const cashSales = shiftTx.reduce((sum, tx) => {
      if (tx.paymentMethod === 'Tunai') {
        return sum + tx.total;
      } else if (tx.paymentMethod === 'Split') {
        return sum + (tx.paymentCashAmount || 0);
      }
      return sum;
    }, 0);

    let refundAmount = 0;
    if (db) {
      const { data: shiftReturns } = await db
        .from('transaction_returns')
        .select('*')
        .eq('store_id', state.storeId)
        .gte('created_at', state.activeShift.opened_at);
      refundAmount = (shiftReturns || []).reduce((sum, r) => sum + Number(r.refund_amount || 0), 0);
    }
    const expected = Number(state.activeShift.cash_float_amount) + cashSales - refundAmount;
    const discrepancy = actual - expected;
    const note = elNote?.value || '';

    if (db && !String(state.activeShift.id).startsWith('offline')) {
      const { error } = await db
        .from('cashier_shifts')
        .update({
          closed_at: new Date().toISOString(),
          expected_cash: expected,
          actual_cash: actual,
          discrepancy: discrepancy,
          note: note
        })
        .eq('id', state.activeShift.id);
      if (error) {
        alert('Gagal menutup shift di database: ' + error.message);
        return;
      }
    }

    state.activeShift = null;
    state.shiftStartTime = null;
    localStorage.removeItem('shift_start_' + (state.storeId || ''));
    
    closeShiftModal();
    alert('Shift berhasil ditutup.');
    
    await checkOrOpenShift();
  };

  const requestAdminPin = () => {
    return new Promise((resolve) => {
      const modal = document.getElementById('pinAuthModal');
      const form = document.getElementById('pinAuthForm');
      const input = document.getElementById('pinAuthInput');
      const cancelBtn = document.getElementById('cancelPinAuth');

      if (!modal || !form || !input) {
        resolve(false);
        return;
      }

      input.value = '';
      modal.classList.remove('hidden');
      input.focus();

      const cleanup = () => {
        modal.classList.add('hidden');
        form.removeEventListener('submit', onSubmit);
        cancelBtn.removeEventListener('click', onCancel);
      };

      const onSubmit = (e) => {
        e.preventDefault();
        const pin = input.value;
        if (state.cashiers.some(c => c.role === 'admin' && c.password === pin)) {
          cleanup();
          resolve(true);
        } else {
          alert('PIN Admin salah atau tidak memiliki akses!');
          input.value = '';
          input.focus();
        }
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      form.addEventListener('submit', onSubmit);
      cancelBtn.addEventListener('click', onCancel);
    });
  };

  const requestVoidReason = () => {
    return new Promise((resolve) => {
      const modal = document.getElementById('voidModal');
      const form = document.getElementById('voidForm');
      const input = document.getElementById('voidReasonInput');
      const cancelBtn = document.getElementById('cancelVoidModal');

      if (!modal || !form || !input) {
        resolve(null);
        return;
      }

      input.value = '';
      modal.classList.remove('hidden');
      input.focus();

      const cleanup = () => {
        modal.classList.add('hidden');
        form.removeEventListener('submit', onSubmit);
        cancelBtn.removeEventListener('click', onCancel);
      };

      const onSubmit = (e) => {
        e.preventDefault();
        const reason = input.value.trim();
        cleanup();
        resolve(reason);
      };

      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      form.addEventListener('submit', onSubmit);
      cancelBtn.addEventListener('click', onCancel);
    });
  };

  const requestReturnDetails = (tx) => {
    return new Promise((resolve) => {
      const modal = document.getElementById('returnModal');
      const itemsList = document.getElementById('returnItemsList');
      const reasonSelect = document.getElementById('returnReasonSelect');
      const actionSelect = document.getElementById('returnActionSelect');
      const submitBtn = document.getElementById('submitReturnBtn');
      const cancelBtn = document.getElementById('cancelReturnModal');
      const closeBtn = document.getElementById('closeReturnModal');

      if (!modal || !itemsList || !reasonSelect || !actionSelect || !submitBtn) {
        resolve(null);
        return;
      }

      itemsList.innerHTML = tx.items.map(item => `
        <div class="flex items-center justify-between border-b border-hairline-soft py-3">
          <div class="flex-1">
            <p class="font-semibold text-ink">${esc(item.name)}</p>
            <p class="text-xs text-muted">${formatCurrency(item.price)} • Beli: ${item.qty} pcs</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-soft">Retur:</span>
            <input type="number" min="0" max="${item.qty}" value="0" data-product-id="${item.id}" data-price="${item.price}" class="return-qty-input w-20 text-center rounded-xl border border-hairline px-2 py-1.5 focus:border-ink focus:border-2 focus:ring-0" />
          </div>
        </div>
      `).join('');

      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      const cleanup = () => {
        modal.classList.add('hidden');
        modal.style.display = '';
        submitBtn.removeEventListener('click', onSubmit);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
      };

      const onSubmit = () => {
        const returnedItems = [];
        let totalRefund = 0;
        const inputs = itemsList.querySelectorAll('.return-qty-input');
        inputs.forEach(input => {
          const qty = Number(input.value) || 0;
          if (qty > 0) {
            const price = Number(input.dataset.price) || 0;
            returnedItems.push({
              productId: input.dataset.productId,
              qty: qty,
              price: price
            });
            totalRefund += qty * price;
          }
        });

        if (returnedItems.length === 0) {
          alert('Mohon tentukan jumlah barang yang ingin diretur (minimal 1).');
          return;
        }

        const reason = reasonSelect.value;
        const action = actionSelect.value;

        cleanup();
        resolve({
          items: returnedItems,
          totalRefund: action === 'refund' ? totalRefund : 0,
          reason: reason,
          action: action
        });
      };

      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      submitBtn.addEventListener('click', onSubmit);
      cancelBtn.addEventListener('click', onCancel);
      closeBtn.addEventListener('click', onCancel);
    });
  };

  const voidTransaction = async (txId) => {
    const isAuthorized = await requestAdminPin();
    if (!isAuthorized) return;

    const reason = await requestVoidReason();
    if (!reason) return;

    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) {
      alert('Transaksi tidak ditemukan.');
      return;
    }

    const adminUser = state.cashiers.find(c => c.role === 'admin');
    const adminName = adminUser ? adminUser.name : 'Supervisor';
    const rawTxId = tx.dbId || parseInt(txId.replace('INV', ''));

    if (db) {
      try {
        const { error: txErr } = await db
          .from('transactions')
          .update({
            status: 'void',
            void_reason: reason,
            void_by: adminName,
            void_at: new Date().toISOString()
          })
          .eq('id', rawTxId);
        if (txErr) throw txErr;

        for (const item of tx.items) {
          const numId = parseInt(item.id);
          if (isNaN(numId)) continue;
          if (item.qty <= 0) continue;
          const { error: stockErr } = await db.rpc('increment_stock', { p_product_id: numId, p_qty: item.qty });
          if (stockErr) throw stockErr;
        }

        showAppToast('Transaksi berhasil dibatalkan (void)!', 'success');
      } catch (err) {
        logError('voidTransaction: gagal membatalkan transaksi', { txId }, err);
        alert('Gagal membatalkan transaksi di database: ' + err.message);
        return;
      }
    }

    tx.status = 'void';
    tx.voidReason = reason;
    tx.voidBy = adminName;
    tx.voidAt = new Date().toISOString();

    tx.items.forEach(item => {
      const product = state.products.find(p => p.id === item.id);
      if (product) product.stock = Number(product.stock) + Number(item.qty);
    });

    syncStorage();
    renderInventory();
    renderHistory();
    updateDashboard();
    renderSalesChart();
  };

  const processReturn = async (txId) => {
    const isAuthorized = await requestAdminPin();
    if (!isAuthorized) return;

    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) {
      alert('Transaksi tidak ditemukan.');
      return;
    }

    const result = await requestReturnDetails(tx);
    if (!result) return;

    const adminUser = state.cashiers.find(c => c.role === 'admin');
    const adminName = adminUser ? adminUser.name : 'Supervisor';
    const cashier = getSelectedCashier();
    const rawTxId = tx.dbId || parseInt(txId.replace('INV', ''));

    if (db) {
      try {
        const { data: ret, error: retErr } = await db
          .from('transaction_returns')
          .insert({
            transaction_id: rawTxId,
            store_id: state.storeId,
            cashier_name: cashier.name,
            refund_amount: result.totalRefund,
            return_reason: result.reason,
            authorized_by: adminName
          })
          .select()
          .single();
        if (retErr) throw retErr;

        const returnItemRows = result.items.map(item => ({
          return_id: ret.id,
          product_id: parseInt(item.productId) || null,
          quantity: item.qty,
          price_at_return: item.price
        }));
        const { error: itemsErr } = await db.from('return_items').insert(returnItemRows);
        if (itemsErr) throw itemsErr;

        for (const item of result.items) {
          const numId = parseInt(item.productId);
          if (isNaN(numId)) continue;
          const { error: stockErr } = await db.rpc('increment_stock', { p_product_id: numId, p_qty: item.qty });
          if (stockErr) throw stockErr;
        }

        showAppToast('Retur barang berhasil diproses!', 'success');
      } catch (err) {
        logError('processReturn: gagal memproses retur', { txId }, err);
        alert('Gagal memproses retur di database: ' + err.message);
        return;
      }
    }

    result.items.forEach(item => {
      const product = state.products.find(p => p.id === item.productId);
      if (product) product.stock = Number(product.stock) + Number(item.qty);
    });

    syncStorage();
    renderInventory();
    renderHistory();
    updateDashboard();
    renderSalesChart();
  };

  // ── Feature: Onboarding ──────────────────────────────────────────────────
  const showOnboarding = (storeName) => {
    if (localStorage.getItem('onboardingDone_' + (state.storeId || ''))) return;
    const overlay = dom.onboardingOverlay;
    if (!overlay) return;
    const welcomeText = document.getElementById('onboardingWelcomeText');
    if (welcomeText) welcomeText.textContent = `Toko "${storeName}" siap digunakan.`;
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  };

  const hideOnboarding = (goToInventory = false) => {
    localStorage.setItem('onboardingDone_' + (state.storeId || ''), '1');
    const overlay = dom.onboardingOverlay;
    if (overlay) { overlay.classList.add('hidden'); overlay.style.display = ''; }
    if (goToInventory) showScreen('inventory');
  };

  const bindOnboarding = () => {
    const step1 = document.getElementById('onboardingStep1');
    const step2 = document.getElementById('onboardingStep2');
    const step3 = document.getElementById('onboardingStep3');
    const dot1 = document.getElementById('ob-dot1');
    const dot2 = document.getElementById('ob-dot2');
    const dot3 = document.getElementById('ob-dot3');

    const goToStep = (n) => {
      [step1, step2, step3].forEach((s, i) => s && s.classList.toggle('hidden', i !== n - 1));
      [dot1, dot2, dot3].forEach((d, i) => {
        if (!d) return;
        d.className = i === n - 1 ? 'w-2 h-2 rounded-full bg-primary' : 'w-2 h-2 rounded-full bg-muted';
      });
    };

    document.getElementById('onboardingNext1')?.addEventListener('click', () => goToStep(2));
    document.getElementById('onboardingNext2')?.addEventListener('click', () => goToStep(3));
    document.getElementById('onboardingFinish')?.addEventListener('click', () => hideOnboarding(true));
  };

  // ── Feature: Payment Method ──────────────────────────────────────────────
  const setPaymentMethod = (method) => {
    state.paymentMethod = method;
    document.querySelectorAll('.paymethod-btn').forEach(btn => {
      const active = btn.dataset.paymethod === method;
      btn.className = `paymethod-btn flex-1 rounded-lg border-2 px-2 py-2.5 text-xs sm:px-3 sm:py-3 sm:text-sm font-semibold transition ${active ? 'border-primary bg-primary-light text-primary' : 'border-hairline bg-white text-body hover:border-hairline'}`;
    });
    const splitWrapper = document.getElementById('splitInputWrapper');
    if (dom.cashInputWrapper) {
      dom.cashInputWrapper.style.display = method === 'Tunai' ? '' : 'none';
    }
    if (splitWrapper) {
      splitWrapper.style.display = method === 'Split' ? 'block' : 'none';
    }
    if (method !== 'Tunai' && method !== 'Split') {
      const totals = calculateCart();
      state.cashAmount = totals.total;
    }
    if (method === 'Split') {
      const totals = calculateCart();
      const splitCash = document.getElementById('splitCashInput');
      const splitNonCash = document.getElementById('splitNonCashInput');
      if (splitCash) splitCash.value = Math.round(totals.total / 2);
      if (splitNonCash) splitNonCash.value = totals.total - Math.round(totals.total / 2);
    }
    if (method === 'QRIS') {
      const totalsCheck = calculateCart();
      if (totalsCheck.total <= 0) {
        alert('Keranjang masih kosong. Tambahkan produk dulu sebelum memilih QRIS.');
        setPaymentMethod('Tunai');
        return;
      }
      const qrisImg = getQrisImage();
      if (qrisImg) {
        const totals = calculateCart();
        const modalImg = document.getElementById('qrisModalImg');
        const modalQr = document.getElementById('qrisModalQr');
        const modalBadge = document.getElementById('qrisDynamicBadge');
        const modalTotal = document.getElementById('qrisModalTotal');
        const qrisModal = document.getElementById('qrisModal');

        // Premium + payload terbaca → QR dinamis bernominal; selain itu gambar statis
        const payload = getQrisPayload();
        const premiumOk = _subsCacheResult !== null ? _subsCacheResult.premiumActive : false;
        const dynamicPayload = (premiumOk && payload) ? makeDynamicQris(payload, totals.total) : null;
        if (dynamicPayload && window.QRCode && modalQr) {
          modalQr.innerHTML = '';
          new QRCode(modalQr, { text: dynamicPayload, width: 224, height: 224, correctLevel: QRCode.CorrectLevel.M });
          modalQr.classList.remove('hidden');
          if (modalImg) modalImg.classList.add('hidden');
          if (modalBadge) modalBadge.classList.remove('hidden');
        } else {
          if (modalQr) modalQr.classList.add('hidden');
          if (modalImg) { modalImg.src = qrisImg; modalImg.classList.remove('hidden'); }
          if (modalBadge) modalBadge.classList.add('hidden');
        }

        if (modalTotal) modalTotal.textContent = formatCurrency(totals.total);
        if (qrisModal) qrisModal.classList.remove('hidden');
      } else {
        alert('Gambar QRIS belum diupload. Silakan upload di menu Pengaturan → QRIS Statis.');
        setPaymentMethod('Tunai');
        return;
      }
    }
    renderCart();
  };

  // --- INVENTORY RULES LOGIC ---
  let opnameData = [];

  const openAdjustmentModal = (productId) => {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    document.getElementById('adjProductId').value = product.id;
    document.getElementById('adjCurrentStock').textContent = product.stock;
    document.getElementById('adjustmentForm').reset();
    document.getElementById('adjDirection').value = 'kurang';
    document.getElementById('adjustmentModalTitle').textContent = `Sesuaikan Stok: ${product.name}`;
    document.getElementById('adjustmentModal').classList.remove('hidden');
  };

  const closeAdjustmentModal = () => {
    document.getElementById('adjustmentModal').classList.add('hidden');
  };

  const secureAdjustStock = async ({ productId, qtyAdjusted, reason, note, cashier, refType, adminPin }) => {
    const { error } = await db.rpc('secure_adjust_stock', {
      p_product_id: parseInt(productId, 10),
      p_qty_adjusted: qtyAdjusted,
      p_reason: reason,
      p_note: note,
      p_cashier: cashier,
      p_ref_type: refType,
      p_admin_pin: adminPin
    });
    if (error) throw error;
  };

  const saveAdjustment = async (e) => {
    e.preventDefault();
    const pid = document.getElementById('adjProductId').value;
    const direction = document.getElementById('adjDirection').value;
    const qty = parseInt(document.getElementById('adjQty').value, 10);
    const reason = document.getElementById('adjReason').value;
    const note = document.getElementById('adjNote').value;
    const product = state.products.find(p => p.id === pid);

    if (!product || !qty || !reason) return;
    const adjustedQty = direction === 'kurang' ? -qty : qty;
    if (product.stock + adjustedQty < 0) {
      alert('Stok tidak boleh negatif!');
      return;
    }

    const user = state.cashiers.find(c => c.id === state.selectedCashierId);
    if (user && user.role !== 'admin') {
      alert('Hanya admin yang bisa menyesuaikan stok.');
      return;
    }

    const pin = prompt('Masukkan PIN/Password Admin untuk konfirmasi penyesuaian stok:');
    if (!pin) return;

    if (db) {
      try {
        await secureAdjustStock({
          productId: pid,
          qtyAdjusted: adjustedQty,
          reason,
          note,
          cashier: getSelectedCashier()?.name || 'Admin',
          refType: 'adjustment',
          adminPin: pin
        });
      } catch (error) {
        logError('saveAdjustment: secure_adjust_stock gagal', { productId: pid, refType: 'adjustment' }, error);
        alert('Gagal sesuaikan stok: ' + friendlyError(error));
        return;
      }
    }

    product.stock += adjustedQty;
    syncStorage();
    renderInventory();
    renderProducts();
    closeAdjustmentModal();
    alert('Stok berhasil disesuaikan!');
  };

  const openLedgerModal = async (productId) => {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    document.getElementById('ledgerProductName').textContent = product.name;
    const tbody = document.getElementById('ledgerTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Memuat riwayat...</td></tr>';
    document.getElementById('ledgerModal').classList.remove('hidden');
    document.getElementById('ledgerModal').classList.add('flex');

    if (db) {
      const { data, error } = await db.from('stock_ledgers').select('*').eq('product_id', parseInt(productId, 10)).order('created_at', { ascending: false }).limit(50);
      if (error) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Gagal memuat data</td></tr>';
      } else if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Belum ada riwayat mutasi</td></tr>';
      } else {
        tbody.innerHTML = data.map(row => {
          const time = new Date(row.created_at).toLocaleString('id-ID');
          const typeMap = { sale: 'Penjualan', purchase: 'Pembelian', return: 'Retur', void: 'Batal', adjustment: 'Penyesuaian', opname: 'Opname' };
          const typeName = typeMap[row.reference_type] || row.reference_type;
          const qtyText = row.qty_changed > 0 ? `<span class="text-emerald-600 font-bold">+${row.qty_changed}</span>` : `<span class="text-rose-600 font-bold">${row.qty_changed}</span>`;
          return `
            <tr class="border-b border-hairline-soft hover:bg-surface-soft">
              <td class="p-3">${time}</td>
              <td class="p-3">${esc(row.cashier_name || '-')}</td>
              <td class="p-3">${esc(typeName)}</td>
              <td class="p-3">${qtyText}</td>
              <td class="p-3 font-semibold">${row.balance_stock}</td>
            </tr>
          `;
        }).join('');
      }
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center">Offline mode tidak mendukung Kartu Stok</td></tr>';
    }
  };

  const closeLedgerModal = () => {
    document.getElementById('ledgerModal').classList.add('hidden');
    document.getElementById('ledgerModal').classList.remove('flex');
  };

  const startOpname = () => {
    opnameData = state.products.map(p => ({
      ...p,
      physical: ''
    }));
    renderOpnameTable();
    document.getElementById('applyOpnameButton').classList.remove('hidden');
    document.getElementById('opnameSummary').classList.remove('hidden');
  };

  const renderOpnameTable = () => {
    const tbody = document.getElementById('opnameTable');
    let totalLoss = 0;
    let diffCount = 0;
    tbody.innerHTML = opnameData.map(p => {
      let diff = 0;
      let loss = 0;
      if (p.physical !== '') {
        diff = parseInt(p.physical, 10) - p.stock;
        loss = diff * (p.cost || 0);
        if (diff !== 0) {
            totalLoss += loss;
            diffCount++;
        }
      }
      const lossText = loss === 0 ? '-' : (loss < 0 ? `<span class="text-rose-600">${formatCurrency(Math.abs(loss))}</span>` : `<span class="text-emerald-600">+${formatCurrency(loss)}</span>`);
      const diffText = diff === 0 ? '-' : (diff < 0 ? `<span class="text-rose-600">${diff}</span>` : `<span class="text-emerald-600">+${diff}</span>`);
      return `
        <tr class="border-b border-hairline-soft hover:bg-surface-soft">
          <td class="p-3 font-medium">${esc(p.name)}</td>
          <td class="p-3">${p.stock}</td>
          <td class="p-3"><input type="number" min="0" value="${p.physical}" data-opname-id="${p.id}" class="opname-input w-24 rounded border border-hairline px-2 py-1 focus:border-ink focus:border-2 focus:ring-0" /></td>
          <td class="p-3">${p.physical === '' ? '-' : diffText}</td>
          <td class="p-3">${p.physical === '' ? '-' : lossText}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('opnameTotalLoss').innerHTML = totalLoss < 0 ? `<span class="text-rose-600 font-bold">${formatCurrency(Math.abs(totalLoss))} (Rugi)</span>` : `<span class="text-emerald-600 font-bold">${formatCurrency(totalLoss)} (Untung)</span>`;
    document.getElementById('opnameItemCount').textContent = diffCount;

    document.querySelectorAll('.opname-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const id = e.target.dataset.opnameId;
        const item = opnameData.find(i => i.id === id);
        if (item) item.physical = e.target.value;
        renderOpnameTable();
      });
    });
  };

  let applyOpnameBusy = false;
  const applyOpname = async () => {
    if (applyOpnameBusy) return;
    const changes = opnameData.filter(p => p.physical !== '' && parseInt(p.physical, 10) !== p.stock);
    if (changes.length === 0) { alert('Tidak ada selisih stok untuk diterapkan.'); return; }

    const pin = prompt('Masukkan PIN/Password Admin untuk konfirmasi opname:');
    if (!pin) return;

    if (!db) {
      alert('Tidak bisa stok opname dalam mode offline.');
      return;
    }

    const user = state.cashiers.find(c => c.id === state.selectedCashierId);
    if (user && user.role !== 'admin') {
      alert('Hanya admin yang bisa konfirmasi stok opname!');
      return;
    }

    applyOpnameBusy = true;
    const applyBtn = document.getElementById('applyOpnameButton');
    if (applyBtn) applyBtn.disabled = true;
    try {
      for (const p of changes) {
        const diff = parseInt(p.physical, 10) - p.stock;
        try {
          await secureAdjustStock({
            productId: p.id,
            qtyAdjusted: diff,
            reason: 'Koreksi Administratif',
            note: 'Hasil Stok Opname',
            cashier: getSelectedCashier()?.name || 'Admin',
            refType: 'opname',
            adminPin: pin
          });
        } catch (error) {
          logError('applyOpname: secure_adjust_stock gagal', { productId: p.id, refType: 'opname' }, error);
          syncStorage();
          renderInventory();
          renderProducts();
          renderOpnameTable();
          alert('Sebagian stok opname sudah tersimpan. Item yang gagal masih terlihat di tabel, silakan coba lagi.');
          return;
        }
        const appliedStock = parseInt(p.physical, 10);
        const realP = state.products.find(rp => rp.id === p.id);
        if (realP) realP.stock = appliedStock;
        // Tandai item ini selesai agar retry setelah gagal di item berikutnya
        // tidak mengirim ulang koreksi yang sudah sukses di server.
        p.stock = appliedStock;
        p.physical = String(appliedStock);
      }
      syncStorage();
      renderInventory();
      renderProducts();
      alert('Hasil stok opname berhasil diterapkan!');

      if (applyBtn) applyBtn.classList.add('hidden');
      document.getElementById('opnameSummary')?.classList.add('hidden');
      const tbody = document.getElementById('opnameTable');
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-muted">Stok opname selesai.</td></tr>';
      opnameData = [];
    } finally {
      applyOpnameBusy = false;
      if (applyBtn) applyBtn.disabled = false;
    }
  };

  const bindEvents = () => {
    // Inventory adjustment / ledger / opname — bind sekali di sini (bukan di loadStore).
    // loadStore bisa dipanggil ulang saat ganti cabang → listener dobel → RPC terpanggil berkali-kali.
    document.getElementById('closeAdjustmentModal')?.addEventListener('click', closeAdjustmentModal);
    document.getElementById('adjustmentForm')?.addEventListener('submit', saveAdjustment);
    document.getElementById('closeLedgerModal')?.addEventListener('click', closeLedgerModal);
    document.getElementById('startOpnameButton')?.addEventListener('click', startOpname);
    document.getElementById('applyOpnameButton')?.addEventListener('click', applyOpname);

    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebar = document.getElementById('mainSidebar');
    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('sidebar-collapsed');
      });
    }
    dom.menuButtons.forEach(button => {
      button.addEventListener('click', () => showScreen(button.dataset.screen));
    });

    // Bottom nav buttons (mobile)
    document.querySelectorAll('.bottom-nav-btn').forEach(button => {
      button.addEventListener('click', () => showScreen(button.dataset.screen));
    });

    dom.searchInput.addEventListener('input', event => {
      state.searchQuery = event.target.value;
      renderProducts();
    });

    dom.categoryFilter.addEventListener('change', event => {
      state.selectedCategory = event.target.value;
      renderProducts();
    });

    dom.discountPercent.addEventListener('input', event => {
      state.discountPercent = Number(event.target.value) || 0;
      state.discountNominal = 0;
      dom.discountNominal.value = 0;
      renderCart();
    });

    dom.discountNominal.addEventListener('input', event => {
      state.discountNominal = Number(event.target.value) || 0;
      state.discountPercent = 0;
      dom.discountPercent.value = 0;
      renderCart();
    });

    dom.cashInput.addEventListener('input', event => {
      state.cashAmount = Number(event.target.value) || 0;
      renderCart();
    });

    dom.cashierSelect.addEventListener('change', event => {
      const targetId = event.target.value;
      if (targetId === state.selectedCashierId) return;
      // Ganti operator wajib verifikasi PIN
      const target = state.cashiers.find(c => c.id === targetId);
      dom.cashierSelect.value = state.selectedCashierId; // tahan dulu sampai PIN benar
      if (!target) return;
      dom.loginName.value = target.name;
      dom.loginPassword.value = '';
      showLoginModal();
      setTimeout(() => dom.loginPassword.focus(), 100);
    });

    // Kelola Kasir
    dom.addCashierBtn?.addEventListener('click', async () => {
      // Gratis: maksimal 2 operator (1 admin + 1 kasir). Lebih dari itu = Premium.
      if (state.cashiers.length >= 2 && !await requirePremium('Lebih dari 2 operator kasir')) return;
      openCashierModal();
    });
    dom.closeCashierModal?.addEventListener('click', closeCashierModalFn);
    dom.cancelCashierModal?.addEventListener('click', closeCashierModalFn);
    dom.cashierForm?.addEventListener('submit', saveCashier);
    document.getElementById('toggleCashierPassword')?.addEventListener('click', () => {
      const inp = dom.cashierFormPassword;
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    dom.reportRangeSelect.addEventListener('change', event => {
      state.reportRange = event.target.value;
      renderReportSummary();
      syncStorage();
    });

    let _historySearchTimer = null;
    dom.historySearchInput.addEventListener('input', event => {
      state.historySearch = event.target.value;
      clearTimeout(_historySearchTimer);
      _historySearchTimer = setTimeout(() => {
        renderHistory();
        syncStorage();
      }, 200);
    });

    dom.exportInventory.addEventListener('click', () => exportInventoryCSV());
    dom.exportHistory.addEventListener('click', () => exportHistoryCSV());

    dom.payButton.addEventListener('click', handlePayment);
    dom.printButton.addEventListener('click', openReceipt);
    dom.closeReceipt.addEventListener('click', closeReceipt);
    dom.closeReceiptBottom.addEventListener('click', closeReceipt);
    dom.printReceipt.addEventListener('click', () => window.print());
    dom.addProductButton.addEventListener('click', () => openInventoryModal(''));
    dom.closeInventoryModal.addEventListener('click', hideInventoryModal);
    dom.cancelInventory.addEventListener('click', hideInventoryModal);
    dom.inventoryForm.addEventListener('submit', saveProduct);
    dom.scanButton.addEventListener('click', () => openScannerModal('kasir'));
    dom.inventoryScanButton.addEventListener('click', () => openScannerModal('inventory'));
    dom.closeScanner.addEventListener('click', closeScannerModal);
    dom.startScanner.addEventListener('click', startBarcodeScanner);
    dom.stopScanner.addEventListener('click', stopBarcodeScanner);
    dom.manualBarcodeSubmit.addEventListener('click', () => {
      handleScannedCode(dom.manualBarcodeInput.value);
    });
    dom.manualBarcodeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleScannedCode(dom.manualBarcodeInput.value);
    });
    dom.barcodeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const code = dom.barcodeInput.value.trim();
        if (!code) return;
        const product = state.products.find(p =>
          p.barcode === code || p.code === code || p.id === code
        );
        if (product) {
          addToCart(product.id);
          dom.barcodeInput.value = '';
        } else {
          state.searchQuery = code;
          dom.searchInput.value = code;
          renderProducts();
        }
      }
    });
    dom.addPurchaseButton.addEventListener('click', openPurchaseModal);
    dom.closePurchaseModal.addEventListener('click', closePurchaseModal);
    dom.cancelPurchase.addEventListener('click', closePurchaseModal);
    dom.addPurchaseItem.addEventListener('click', addPurchaseItemToDraft);
    dom.purchaseProduct.addEventListener('change', () => {
      const productId = dom.purchaseProduct.value;
      if (!productId) {
        dom.purchaseCost.value = '';
        return;
      }
      const product = state.products.find(item => item.id === productId);
      if (product) {
        const existingInDraft = state.draftPurchase.items.find(item => item.id === productId);
        dom.purchaseCost.value = existingInDraft ? existingInDraft.price : product.cost;
      } else {
        dom.purchaseCost.value = '';
      }
    });
    dom.savePurchase.addEventListener('click', savePurchaseOrder);
    dom.exportPurchase.addEventListener('click', exportPurchasesCSV);
    dom.exportDataButton.addEventListener('click', exportAppBackup);
    dom.importDataButton.addEventListener('click', () => dom.backupFileInput.click());
    dom.backupFileInput.addEventListener('change', importAppBackup);
    dom.loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      const success = await authenticateUser(dom.loginName.value.trim(), dom.loginPassword.value.trim());
      if (!success) {
        alert('Nama atau password salah. Coba lagi.');
      }
    });
    dom.loginCancel.addEventListener('click', hideLoginModal);

    dom.paymentConfirmCancel.addEventListener('click', hidePaymentConfirmModal);
    dom.closePaymentConfirmModal.addEventListener('click', hidePaymentConfirmModal);
    dom.paymentConfirmOk.addEventListener('click', async () => {
      if (paymentInFlight) return;
      paymentInFlight = true;
      setPaymentUiBusy(true);
      hidePaymentConfirmModal();
      const cartItems = getCartItems();
      const totals = calculateCart();
      const cashier = getSelectedCashier();
      const confirmedBy = cashier.name;
      const confirmedAt = new Date().toISOString();
      await _executePayment(cartItems, totals, confirmedBy, confirmedAt, { alreadyLocked: true });
    });

    document.addEventListener('click', event => {
      if (event.target === dom.inventoryModal) hideInventoryModal();
      if (event.target === dom.receiptModal) closeReceipt();
      if (event.target === dom.scannerModal) closeScannerModal();
      if (event.target === dom.purchaseModal) closePurchaseModal();
      if (event.target === dom.loginModal) hideLoginModal();
      if (event.target === dom.paymentConfirmModal) hidePaymentConfirmModal();
    });

    // ── Login / Register (Supabase Auth) ──
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const loginForm2 = document.getElementById('loginForm2');
    const registerForm = document.getElementById('registerForm');
    const authError = document.getElementById('authError');
    const authSuccess = document.getElementById('authSuccess');
    const logoutButton = document.getElementById('logoutButton');
    const mobileLogoutButton = document.getElementById('mobileLogoutButton');

    const showAuthError = msg => {
      authSuccess.classList.add('hidden');
      authError.textContent = msg;
      authError.classList.remove('hidden');
    };
    const clearAuthMsg = () => {
      authError.classList.add('hidden');
      authSuccess.classList.add('hidden');
    };

    const activateTab = which => {
      clearAuthMsg();
      const onLogin = which === 'login';
      loginForm2.classList.toggle('hidden', !onLogin);
      registerForm.classList.toggle('hidden', onLogin);
      tabLogin.className = onLogin
        ? 'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold bg-white text-ink shadow-sm transition min-h-[44px]'
        : 'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted hover:text-body transition min-h-[44px]';
      tabRegister.className = !onLogin
        ? 'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold bg-white text-ink shadow-sm transition min-h-[44px]'
        : 'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted hover:text-body transition min-h-[44px]';
    };
    tabLogin?.addEventListener('click', () => activateTab('login'));
    tabRegister?.addEventListener('click', () => activateTab('register'));

    // Toggle lihat password (semua tombol .toggle-pw)
    document.querySelectorAll('.toggle-pw').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById(btn.dataset.toggle);
        if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
      });
    });

    // MASUK
    loginForm2?.addEventListener('submit', async event => {
      event.preventDefault();
      clearAuthMsg();
      const btn = document.getElementById('loginSubmitBtn');
      btn.textContent = 'Memeriksa...'; btn.disabled = true;
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPass').value;
      const res = await handleLogin(email, password);
      btn.textContent = 'Masuk'; btn.disabled = false;
      if (res.error) { showAuthError(res.error); return; }
      // Login manual berhasil = user membuktikan tahu password asli — aman
      // bebaskan dari flag recovery yang mungkin masih nyangkut (mis. user
      // pernah mulai proses reset lalu batal, tapi ingat password lama).
      passwordRecoveryMode = false;
      localStorage.removeItem('pw_recovery_uid');
      await enterAppAfterAuth();
    });

    // DAFTAR
    registerForm?.addEventListener('submit', async event => {
      event.preventDefault();
      clearAuthMsg();
      const btn = document.getElementById('registerSubmitBtn');
      btn.textContent = 'Memproses...'; btn.disabled = true;
      const res = await handleRegister({
        storeName: document.getElementById('regStoreName').value,
        ownerName: document.getElementById('regOwnerName').value,
        email: document.getElementById('regEmail').value.trim(),
        password: document.getElementById('regPass').value,
        pin: document.getElementById('regPin').value
      });
      btn.textContent = 'Daftar & Buat Toko'; btn.disabled = false;
      if (res.error) { showAuthError(res.error); return; }
      if (res.needConfirm) {
        authError.classList.add('hidden');
        authSuccess.textContent = 'Akun dibuat! Silakan cek email Anda untuk konfirmasi, lalu masuk.';
        authSuccess.classList.remove('hidden');
        activateTab('login');
        return;
      }
      passwordRecoveryMode = false;
      localStorage.removeItem('pw_recovery_uid');
      const regStoreName2 = document.getElementById('regStoreName')?.value || 'Toko';
      await enterAppAfterAuth();
      // Show onboarding for new registrations
      if (!localStorage.getItem('onboardingDone_' + (state.storeId || ''))) {
        showOnboarding(regStoreName2);
      }
    });

    logoutButton?.addEventListener('click', logout);
    mobileLogoutButton?.addEventListener('click', logout);

    // ── Thermal print ──
    dom.printThermalBtn?.addEventListener('click', () => {
      const data = dom.printThermalBtn._receiptData;
      if (data) printThermal(data);
    });

    // ── Cetak Bluetooth (RawBT) — hanya tampil di Android ──
    const printBluetoothBtn = document.getElementById('printBluetoothBtn');
    if (printBluetoothBtn && /android/i.test(navigator.userAgent)) {
      printBluetoothBtn.classList.remove('hidden');
      printBluetoothBtn.addEventListener('click', () => {
        const data = dom.printThermalBtn?._receiptData;
        if (data) printViaRawBT(data);
      });
    }

    // ── Pengaturan ──
    const settingInputs = [dom.settingStoreName, dom.settingStoreAddress, dom.settingStorePhone, dom.settingStoreNote];
    settingInputs.forEach(inp => {
      inp?.addEventListener('input', () => {
        updateSettingsPreview({
          name: dom.settingStoreName?.value,
          address: dom.settingStoreAddress?.value,
          phone: dom.settingStorePhone?.value,
          note: dom.settingStoreNote?.value
        });
      });
    });

    dom.saveSettingsBtn?.addEventListener('click', async () => {
      const store = {
        name: dom.settingStoreName.value.trim() || 'Kasir UMKM Simpel',
        address: dom.settingStoreAddress.value.trim(),
        phone: dom.settingStorePhone.value.trim(),
        note: dom.settingStoreNote.value.trim(),
        paperSize: dom.settingPaperSize.value
      };
      dom.saveSettingsBtn.disabled = true;
      dom.saveSettingsBtn.textContent = 'Menyimpan...';
      const res = await saveStoreSettings(store);
      dom.saveSettingsBtn.disabled = false;
      dom.saveSettingsBtn.innerHTML = iconText('save', 'Simpan Pengaturan');
      if (res.error) { alert('Gagal menyimpan: ' + friendlyError(res.error)); return; }
      updateSettingsPreview(store);
      dom.settingsSaved.classList.remove('hidden');
      setTimeout(() => dom.settingsSaved.classList.add('hidden'), 2500);
    });

    // ── Layar Pelanggan ──
    document.getElementById('openCustomerDisplayBtn')?.addEventListener('click', openCustomerDisplay);

    // ── Langganan ──
    document.getElementById('subsBannerBtn')?.addEventListener('click', () => showUpgradeOverlay('premium'));
    document.getElementById('subsPayBtn')?.addEventListener('click', e => { e.preventDefault(); startPakasirPayment(); });
    document.getElementById('subsRecheckBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('subsRecheckBtn');
      btn.textContent = 'Memeriksa...';
      let active = await checkPakasirOrderStatus();
      if (!active) {
        await loadStore();
        const serverResult = db ? await fetchSubscriptionFromServer() : null;
        active = serverResult !== null ? serverResult.premiumActive : false;
      }
      btn.textContent = '🔄 Sudah bayar — cek status';
      if (active) {
        hideSubsOverlay();
        const banner = document.getElementById('subsBanner');
        if (banner) { banner.classList.add('hidden'); document.body.style.paddingTop = ''; }
        alert('Langganan aktif! 🎉 Semua fitur sudah terbuka.');
      } else {
        alert('Pembayaran belum terdeteksi. Jika baru saja membayar, tunggu beberapa detik lalu coba lagi.');
      }
    });
    document.getElementById('subsCloseBtn')?.addEventListener('click', hideSubsOverlay);

    // ── QRIS file upload ──
    document.getElementById('qrisFileInput')?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { alert('File harus berupa gambar.'); return; }
      if (file.size > 2 * 1024 * 1024) { alert('Ukuran gambar maksimal 2MB.'); return; }
      const reader = new FileReader();
      reader.onload = async ev => {
        const base64 = ev.target.result;
        localStorage.setItem('qris_image', base64);
        const wrapper = document.getElementById('qrisPreviewWrapper');
        const previewImg = document.getElementById('qrisPreviewImg');
        if (previewImg) previewImg.src = base64;
        if (wrapper) wrapper.classList.remove('hidden');
        // Decode isi QR untuk fitur QRIS dinamis (premium)
        localStorage.removeItem('qris_payload');
        const payload = await decodeQrisImage(base64);
        if (payload && payload.startsWith('000201')) {
          localStorage.setItem('qris_payload', payload);
          alert('QRIS berhasil dibaca. Fitur QRIS Dinamis (nominal otomatis tertanam) aktif untuk pengguna Premium.');
        } else {
          alert('Gambar tersimpan, tapi isi QR tidak terbaca — QRIS Dinamis tidak tersedia. Coba upload gambar yang lebih jelas/tidak terpotong jika ingin fitur nominal otomatis.');
        }
        // Sinkron ke cloud agar perangkat lain ikut dapat
        await saveQrisToCloud(base64, payload && payload.startsWith('000201') ? payload : null);
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('qrisDeleteBtn')?.addEventListener('click', () => {
      if (!confirm('Hapus gambar QRIS?')) return;
      localStorage.removeItem('qris_image');
      localStorage.removeItem('qris_payload');
      saveQrisToCloud(null, null);
      const wrapper = document.getElementById('qrisPreviewWrapper');
      const fileInput = document.getElementById('qrisFileInput');
      if (wrapper) wrapper.classList.add('hidden');
      if (fileInput) fileInput.value = '';
    });
    // ── QRIS modal ──
    document.getElementById('closeQrisModal')?.addEventListener('click', () => {
      const m = document.getElementById('qrisModal');
      if (m) m.classList.add('hidden');
      setPaymentMethod('Tunai');
    });
    document.getElementById('qrisConfirmBtn')?.addEventListener('click', () => {
      const m = document.getElementById('qrisModal');
      if (m) m.classList.add('hidden');
    });

    // ── Feature 1: Forgot Password ──
    dom.forgotPasswordBtn?.addEventListener('click', () => {
      const form = dom.forgotPasswordForm;
      if (form) form.classList.toggle('hidden');
    });
    dom.sendResetBtn?.addEventListener('click', async () => {
      const email = dom.resetEmail?.value.trim();
      if (!email) { alert('Masukkan email terlebih dahulu.'); return; }
      if (!db) { alert('Koneksi database tidak tersedia.'); return; }
      dom.sendResetBtn.textContent = 'Mengirim...'; dom.sendResetBtn.disabled = true;
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
      dom.sendResetBtn.textContent = 'Kirim Link Reset'; dom.sendResetBtn.disabled = false;
      const authSuccess2 = document.getElementById('authSuccess');
      const authError2 = document.getElementById('authError');
      if (error) {
        authError2.textContent = terjemahAuthError(error.message);
        authError2.classList.remove('hidden');
        authSuccess2.classList.add('hidden');
      } else {
        authSuccess2.textContent = 'Link reset password telah dikirim ke email Anda.';
        authSuccess2.classList.remove('hidden');
        authError2.classList.add('hidden');
        if (dom.forgotPasswordForm) dom.forgotPasswordForm.classList.add('hidden');
      }
    });

    // ── Buat Password Baru (reset password) ──
    document.getElementById('newPasswordForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const errBox = document.getElementById('newPassError');
      errBox?.classList.add('hidden');
      const showErr = txt => {
        if (errBox) { errBox.textContent = txt; errBox.classList.remove('hidden'); }
      };
      const pass1 = document.getElementById('newPass1').value;
      const pass2 = document.getElementById('newPass2').value;
      if (pass1.length < 8) { showErr('Password minimal 8 karakter.'); return; }
      if (pass1 !== pass2) { showErr('Password dan konfirmasi tidak sama.'); return; }
      const btn = document.getElementById('newPassSubmitBtn');
      btn.textContent = 'Menyimpan...'; btn.disabled = true;
      const { error } = await db.auth.updateUser({ password: pass1 });
      btn.textContent = 'Simpan Password Baru'; btn.disabled = false;
      if (error) { showErr(terjemahAuthError(error.message)); return; }
      // signOut dibungkus try/catch: apa pun hasilnya (sukses/gagal), flag
      // recovery TETAP dibersihkan di finally — jangan sampai user stuck di
      // form recovery hanya karena signOut gagal karena network error
      // padahal password sudah berhasil diganti.
      try {
        await db.auth.signOut();
      } catch (signOutErr) {
        logError('signOut gagal setelah ganti password recovery', {}, signOutErr);
      } finally {
        history.replaceState(null, '', location.pathname);
        passwordRecoveryMode = false;
        localStorage.removeItem('pw_recovery_uid');
      }
      hideNewPasswordForm();
      const authSuccess2 = document.getElementById('authSuccess');
      if (authSuccess2) {
        authSuccess2.textContent = 'Password berhasil diganti. Silakan masuk dengan password baru.';
        authSuccess2.classList.remove('hidden');
      }
      document.getElementById('authError')?.classList.add('hidden');
    });

    // Satu-satunya jalan keluar untuk user yang terjebak di form recovery
    // (lupa isi / berubah pikiran / cuma numpang buka app). Tanpa tombol
    // ini, flag pw_recovery_uid tidak pernah hilang tanpa devtools —
    // dead-end UX fatal untuk user UMKM non-teknis.
    document.getElementById('cancelRecoveryBtn')?.addEventListener('click', async () => {
      passwordRecoveryMode = false;
      localStorage.removeItem('pw_recovery_uid');
      try {
        await db?.auth.signOut();
      } catch (signOutErr) {
        logError('signOut gagal saat batal recovery', {}, signOutErr);
      }
      history.replaceState(null, '', location.pathname);
      hideNewPasswordForm();
      showLoginPage();
    });

    // ── Feature 5: Shift / Tutup Kasir ──
    dom.tutupKasirBtn?.addEventListener('click', openTutupShiftModal);
    dom.closeShiftModal?.addEventListener('click', closeShiftModal);
    dom.cancelShiftModal?.addEventListener('click', closeShiftModal);
    dom.printShiftBtn?.addEventListener('click', printShiftReport);
    dom.resetShiftBtn?.addEventListener('click', submitTutupShift);
    document.addEventListener('click', e => {
      if (e.target === dom.shiftModal) closeShiftModal();
    });

    const openShiftForm = document.getElementById('openShiftForm');
    openShiftForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const floatVal = Number(document.getElementById('openShiftCashFloat').value) || 0;
      if (db && !/^C\d+$/.test(String(state.selectedCashierId))) {
        const { data, error } = await db
          .from('cashier_shifts')
          .insert({
            store_id: state.storeId,
            cashier_id: state.selectedCashierId,
            opened_at: new Date().toISOString(),
            cash_float_amount: floatVal,
            expected_cash: floatVal,
            actual_cash: 0,
            discrepancy: 0,
            note: ''
          })
          .select()
          .single();
        if (error) {
          alert('Gagal membuka shift: ' + friendlyError(error));
          return;
        }
        state.activeShift = data;
        state.shiftStartTime = new Date(data.opened_at);
        localStorage.setItem('shift_start_' + (state.storeId || ''), state.shiftStartTime.toISOString());
        hideBukaShiftModal();
        showAppToast('Shift berhasil dibuka!', 'success');
      } else {
        state.activeShift = {
          id: 'offline-' + Date.now(),
          store_id: state.storeId,
          cashier_id: state.selectedCashierId,
          opened_at: new Date().toISOString(),
          cash_float_amount: floatVal
        };
        state.shiftStartTime = new Date();
        localStorage.setItem('shift_start_' + (state.storeId || ''), state.shiftStartTime.toISOString());
        hideBukaShiftModal();
      }
    });

    const splitCash = document.getElementById('splitCashInput');
    const splitNonCash = document.getElementById('splitNonCashInput');
    const splitRem = document.getElementById('splitRemaining');

    const updateSplitAmounts = () => {
      const totals = calculateCart();
      const valCash = Number(splitCash?.value) || 0;
      const valNonCash = Number(splitNonCash?.value) || 0;
      const remaining = totals.total - (valCash + valNonCash);
      
      if (splitRem) {
        splitRem.textContent = formatCurrency(remaining);
        if (remaining === 0) {
          splitRem.className = "font-semibold text-green-600";
        } else {
          splitRem.className = "font-semibold text-rose-600";
        }
      }
    };

    splitCash?.addEventListener('input', updateSplitAmounts);
    splitNonCash?.addEventListener('input', updateSplitAmounts);

    // ── Feature 4: Export PDF ──
    dom.exportPdfBtn?.addEventListener('click', async () => {
      if (!await requirePremium('Export laporan PDF')) return;
      exportReportPDF();
    });

    // ── Feature 6: Payment Method ──
    document.querySelectorAll('.paymethod-btn').forEach(btn => {
      btn.addEventListener('click', () => setPaymentMethod(btn.dataset.paymethod));
    });

    // ── Feature 7: Onboarding ──
    bindOnboarding();

    // ── Kasbon ──
    document.getElementById('addDebtBtn')?.addEventListener('click', openDebtModal);
    document.getElementById('closeDebtModal')?.addEventListener('click', closeDebtModal);
    document.getElementById('debtForm')?.addEventListener('submit', saveDebt);
    document.getElementById('debtSearchInput')?.addEventListener('input', renderKasbon);
    document.getElementById('closeDebtDeleteModal')?.addEventListener('click', closeDebtDeleteModal);
    document.getElementById('debtDeleteCancel')?.addEventListener('click', closeDebtDeleteModal);
    document.getElementById('debtDeleteConfirm')?.addEventListener('click', confirmDeleteDebt);

    // ── Struk WhatsApp ──
    document.getElementById('waReceiptBtn')?.addEventListener('click', () => {
      const data = dom.printThermalBtn?._receiptData;
      if (data) sendReceiptWhatsApp(data);
    });

    // ── Offline auto-sync ──
    window.addEventListener('online', () => { flushOfflineQueue(); flushDebtQueue(); });

    // ── Multi-Cabang ──
    document.getElementById('storeSwitcher')?.addEventListener('change', e => switchStore(e.target.value));
    document.getElementById('addBranchBtn')?.addEventListener('click', addBranch);

    // ── Super Admin ──
    bindSuperAdminEvents();

    // ── Cache & Versi ──
    document.getElementById('clearCacheBtn')?.addEventListener('click', async () => {
      if (!confirm('Bersihkan cache aplikasi? Halaman akan dimuat ulang.')) return;
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      } catch (e) {
        console.warn('Cache deletion error:', e);
      }
      window.location.reload();
    });

    // ── Hapus Akun ──
    dom.deleteAccountBtn?.addEventListener('click', openDeleteAccountModal);
    dom.closeDeleteAccountModal?.addEventListener('click', closeDeleteAccountModal);
    dom.cancelDeleteAccountModal?.addEventListener('click', closeDeleteAccountModal);
    dom.deleteAccountEmailInput?.addEventListener('input', () => {
      const match = dom.deleteAccountEmailInput.value.trim().toLowerCase() === (state.authUser?.email || '').toLowerCase();
      dom.deleteAccountConfirmBtn.disabled = !match;
      if (match) {
        dom.deleteAccountConfirmBtn.classList.remove('bg-hairline-soft', 'text-muted-soft', 'cursor-not-allowed');
        dom.deleteAccountConfirmBtn.classList.add('bg-rose-600', 'text-white', 'hover:bg-rose-700', 'cursor-pointer');
      } else {
        dom.deleteAccountConfirmBtn.classList.remove('bg-rose-600', 'text-white', 'hover:bg-rose-700', 'cursor-pointer');
        dom.deleteAccountConfirmBtn.classList.add('bg-hairline-soft', 'text-muted-soft', 'cursor-not-allowed');
      }
    });
    dom.deleteAccountConfirmBtn?.addEventListener('click', handleDeleteAccount);
    document.addEventListener('click', e => {
      if (e.target === dom.deleteAccountModal) closeDeleteAccountModal();
    });
  };

  let _activeScreenId = 'dashboard';

  const renderAll = () => {
    dom.todayDate.textContent = '📅 ' + new Date().toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    renderStoreSwitcher();
    renderCashierSelect();
    dom.reportRangeSelect.value = state.reportRange;
    dom.historySearchInput.value = state.historySearch;
    switch (_activeScreenId) {
      case 'dashboard':
        updateDashboard();
        renderSalesChart();
        renderReportSummary();
        break;
      case 'kasir':
        renderProducts();
        renderCart();
        break;
      case 'inventory':
        renderInventory();
        break;
      case 'riwayat':
        renderHistory();
        break;
      case 'pembelian':
        renderPurchaseHistory();
        break;
      case 'kasbon':
        renderKasbon();
        break;
      case 'kelolaKasir':
        renderCashierManagement();
        break;
      case 'pengaturan':
        renderSettings();
        break;
      case 'screen-superadmin':
        superAdminLoadStores();
        break;
    }
  };

  const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator)) return;

    // Saat service worker baru mengambil kendali (deploy baru aktif),
    // reload sekali agar HTML/JS terbaru langsung terpakai tanpa clear cache manual.
    let _reloadingForNewSW = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_reloadingForNewSW) return;
      _reloadingForNewSW = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
      .then(registration => {
        console.log('Service worker terdaftar.');
        // Paksa cek versi baru tiap load + tiap kembali fokus ke app.
        registration.update();
        window.addEventListener('focus', () => registration.update());
      })
      .catch(err => console.warn('Gagal daftar service worker:', err));
  };

  // Dipanggil setelah login/daftar berhasil ATAU saat sesi masih aktif
  const enterAppAfterAuth = async () => {
    // Mode recovery: pemegang link reset TIDAK boleh masuk dashboard
    // sebelum membuat password baru (guard di semua jalur SIGNED_IN/bootstrap).
    if (passwordRecoveryMode) {
      showNewPasswordForm();
      return;
    }
    showHelpChatFab();
    await loadData();

    // Cek super admin SEBELUM guard toko agar super admin bisa bypass
    await checkSuperAdmin();

    // Pengaman: user terautentikasi tapi belum punya toko (mis. lewat konfirmasi email)
    // Super admin dibebaskan dari kewajiban memiliki toko
    if (db && state.authUser && !state.storeId && !_isSuperAdmin) {
      let storeName = prompt('Selamat datang! Masukkan nama toko Anda untuk memulai:');
      if (storeName === null) return;
      storeName = storeName.trim() || 'Toko Saya';
      const ownerName = prompt('Nama Anda (pemilik):') || 'Pemilik';
      
      let pin = prompt('Masukkan PIN untuk login kasir/admin:', '');
      if (pin === null) return;
      pin = pin.trim();
      if (!pin) {
        alert('PIN wajib diisi! Pendaftaran toko dibatalkan.');
        return;
      }
      
      const { data: store, error } = await db.from('stores')
        .insert({ owner_id: state.authUser.id, name: storeName }).select().single();
      if (!error && store) {
        state.store = store;
        state.storeId = store.id;
        const { error: initCashierErr } = await db.from('cashiers').insert({
          store_id: store.id, name: ownerName.trim(), password: pin, role: 'admin'
        });
        if (initCashierErr) logError('cashier insert gagal', { storeId: state.storeId }, initCashierErr);
        await loadData();
      } else if (error) {
        alert('Gagal membuat toko: ' + friendlyError(error));
      }
    }

    await loadActiveShift();
    if (db && state.authUser && state.storeId && !_isSuperAdmin) {
      await checkOrOpenShift();
    }

    // Freemium: aplikasi tidak pernah dikunci — hanya tampilkan banner pengingat trial
    checkSubscription();
    watchPendingSubscription();

    applyRoleAccess();
    showApp();
    showScreen('dashboard');
    renderAll();
    setPaymentMethod('Tunai');
  };

  // ── Kasbon / Hutang Pelanggan (Premium: tanpa batas; Gratis: maks 5 aktif) ─
  const saveDebtsLocal = () => localStorage.setItem('pos_debts', JSON.stringify(state.debts || []));

  // ── Antrean kasbon offline: Supabase = source of truth, antrean hanya saat offline ─
  const DEBT_QUEUE_KEY = 'debt_queue';
  const getDebtQueue = () => {
    try { return JSON.parse(localStorage.getItem(DEBT_QUEUE_KEY) || '[]'); } catch { return []; }
  };
  const saveDebtQueue = q => localStorage.setItem(DEBT_QUEUE_KEY, JSON.stringify(q));
  // Error jaringan murni (fetch gagal), bukan error dari server/database
  const isNetworkError = e => /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(e?.message || '');

  // Guard reentrancy: flush dipanggil dari loadData, event 'online', dan refresh layar
  // Kasbon — tanpa guard, dua flush bersamaan kirim RPC dobel (kasbon & stok terpotong 2x)
  let debtQueueFlushing = false;
  const flushDebtQueue = async () => {
    if (!db || !navigator.onLine || !state.storeId) return 0;
    if (debtQueueFlushing) return 0;
    debtQueueFlushing = true;
    try {
      const q = getDebtQueue();
      if (!q.length) return 0;
      const remaining = [];
      let synced = 0;
      for (const entry of q) {
        try {
          const { data, error } = await db.rpc('create_debt_transaction', {
            p_store_id: entry.store_id,
            p_customer_name: entry.customer_name,
            p_phone: entry.phone,
            p_amount: entry.amount,
            p_note: entry.note,
            p_items: entry.items,
            p_cashier_name: entry.cashier_name
          });
          if (error) throw error;
          // Sudah ditandai lunas sebelum tersinkron → susulkan update status di server
          if (entry.status === 'lunas') {
            await db.from('debts').update({ status: 'lunas', paid_at: entry.paid_at || new Date().toISOString() }).eq('id', data.debt_id);
          }
          // Ganti id lokal 'D...' dengan id server
          const local = (state.debts || []).find(d => String(d.id) === String(entry.id));
          if (local) { local.id = data.debt_id; delete local.pending; }
          synced++;
        } catch (e) {
          logError('flushDebtQueue: sinkron kasbon gagal', { debtId: entry.id }, e);
          remaining.push(entry); // gagal → coba lagi nanti
        }
      }
      saveDebtQueue(remaining);
      if (synced > 0) { saveDebtsLocal(); renderKasbon(); }
      return synced;
    } finally {
      debtQueueFlushing = false;
    }
  };

  const refreshDebtsFromServer = async () => {
    if (!db || !navigator.onLine || !state.storeId) return;
    await flushDebtQueue();
    const { data: debts, error } = await db
      .from('debts').select('*').eq('store_id', state.storeId)
      .order('created_at', { ascending: false }).limit(500);
    if (error) {
      logError('refreshDebtsFromServer: gagal memuat kasbon', { storeId: state.storeId }, error);
      return; // pertahankan cache lokal sebagai fallback
    }
    // Antrean pending tetap tampil di atas data server sampai tersinkron
    state.debts = [...getDebtQueue(), ...(debts || [])];
    saveDebtsLocal();
    renderKasbon();
  };

  const renderKasbon = () => {
    const list = document.getElementById('debtList');
    if (!list) return;
    const debts = state.debts || [];
    const search = (document.getElementById('debtSearchInput')?.value || '').toLowerCase();
    const active = debts.filter(d => d.status !== 'lunas');
    const totalAmount = active.reduce((s, d) => s + Number(d.amount || 0), 0);

    const elTotal = document.getElementById('debtTotalAmount');
    const elCount = document.getElementById('debtActiveCount');
    if (elTotal) elTotal.textContent = formatCurrency(totalAmount);
    if (elCount) elCount.textContent = active.length;

    const filtered = debts.filter(d => !search || (d.customer_name || '').toLowerCase().includes(search));
    // Belum lunas dulu, lalu yang lunas (maks 20 terakhir agar tidak penuh)
    const sorted = [...filtered.filter(d => d.status !== 'lunas'), ...filtered.filter(d => d.status === 'lunas').slice(0, 20)];

    list.innerHTML = sorted.map(d => {
      const isPaid = d.status === 'lunas';
      const date = new Date(d.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
      const tagBtn = (!isPaid && d.phone) ? `<button data-debt-wa="${esc(d.id)}" class="btn-icon flex-1 rounded-lg bg-green-600 px-3 py-2 text-xs text-white font-semibold hover:bg-green-700 transition">${iconText('message', 'Tagih', 'icon icon-sm')}</button>` : '';
      let itemsHtml = '';
      if (d.items && Array.isArray(d.items) && d.items.length > 0) {
          itemsHtml = `<div class="text-xs text-muted mt-1">${d.items.map(i => `${esc(i.product_name)} (${i.qty}x)`).join(', ')}</div>`;
      }
      return `
        <div class="rounded-xl bg-white border ${isPaid ? 'border-hairline opacity-60' : 'border-amber-200'} shadow-sm p-5 space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-semibold text-ink truncate">${esc(d.customer_name)}</p>
              <p class="text-xs text-muted-soft">${date}${d.note ? ' — ' + esc(d.note) : ''}</p>
              ${itemsHtml}
            </div>
            <div class="flex flex-col items-end gap-1">
              <span class="rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${isPaid ? 'Lunas' : 'Belum lunas'}</span>
              ${d.pending ? '<span class="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-xs whitespace-nowrap">Belum tersimpan online</span>' : ''}
            </div>
          </div>
          <p class="text-2xl font-bold ${isPaid ? 'text-muted-soft line-through' : 'text-rose-600'}">${formatCurrency(d.amount)}</p>
          <div class="flex gap-2">
            ${tagBtn}
            ${!isPaid ? `<button data-debt-paid="${esc(d.id)}" class="btn-icon flex-1 rounded-lg bg-primary px-3 py-2 text-xs text-white font-semibold hover:bg-primary-active transition">${iconText('check', 'Tandai Lunas', 'icon icon-sm')}</button>` : ''}
            <button data-debt-delete="${esc(d.id)}" class="btn-icon rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 hover:bg-rose-100 transition" title="Hapus">${icon('trash', 'icon icon-sm')}</button>
          </div>
        </div>`;
    }).join('') || '<div class="col-span-full rounded-xl border border-dashed border-hairline bg-surface-soft p-8 text-center text-muted">Belum ada catatan kasbon. Klik "+ Catat Kasbon" untuk mulai.</div>';

    list.querySelectorAll('[data-debt-paid]').forEach(btn =>
      btn.addEventListener('click', () => markDebtPaid(btn.dataset.debtPaid, btn)));
    list.querySelectorAll('[data-debt-delete]').forEach(btn =>
      btn.addEventListener('click', () => deleteDebt(btn.dataset.debtDelete)));
    list.querySelectorAll('[data-debt-wa]').forEach(btn =>
      btn.addEventListener('click', () => sendDebtReminder(btn.dataset.debtWa)));
  };

  const addDebtItemRow = () => {
    const container = document.getElementById('debtItemsContainer');
    if (!container) return;
    const rowId = 'debtRow_' + Date.now() + Math.random().toString(36).substr(2, 5);
    const div = document.createElement('div');
    div.className = 'flex gap-2 mb-2 items-center debt-item-row';
    div.id = rowId;
    
    const productOptions = state.products && state.products.length > 0 
      ? state.products.map(p => `
          <option value="${esc(String(p.id))}" data-price="${p.price}" data-name="${esc(p.name)}">
            ${esc(p.name)} - ${formatCurrency(p.price)}
          </option>
        `).join('')
      : '<option value="">(Kosong)</option>';
    
    div.innerHTML = `
        <div class="w-[45%]">
            <select class="w-full rounded-xl border border-hairline px-2 py-1.5 text-sm focus:border-ink focus:border-2 focus:ring-0 focus:outline-none debt-product-select" onchange="updateDebtItemPrice(this, '${rowId}')">
                <option value="" disabled selected>Pilih Produk</option>
                ${productOptions}
            </select>
        </div>
        <div class="w-[20%]">
            <input type="number" min="1" value="1" class="w-full rounded-xl border border-hairline px-2 py-1.5 text-sm focus:border-ink focus:border-2 focus:ring-0 focus:outline-none debt-qty-input" oninput="calculateDebtTotal()">
        </div>
        <div class="w-[25%]">
             <input type="text" class="w-full rounded-xl border border-hairline bg-surface-soft px-2 py-1.5 text-sm text-muted" readonly value="0">
        </div>
        <div class="w-[10%] flex justify-end">
             <button type="button" class="rounded-xl bg-rose-100 text-rose-600 px-3 py-1.5 hover:bg-rose-200 transition font-bold" onclick="removeDebtItemRow('${rowId}')">✕</button>
        </div>
    `;
    container.appendChild(div);
    calculateDebtTotal();
  };

  const removeDebtItemRow = (rowId) => {
    const row = document.getElementById(rowId);
    if (row) {
        row.remove();
        calculateDebtTotal();
    }
  };

  const updateDebtItemPrice = (selectEl, rowId) => {
    const row = document.getElementById(rowId);
    if (!row) return;
    const option = selectEl.options[selectEl.selectedIndex];
    const price = parseFloat(option.getAttribute('data-price') || '0');
    const subtotalInput = row.querySelectorAll('input[type="text"]')[0];
    const qtyInput = row.querySelectorAll('input[type="number"]')[0];
    const qty = parseInt(qtyInput.value) || 1;
    
    if (subtotalInput) {
        subtotalInput.value = formatCurrency(price * qty);
    }
    calculateDebtTotal();
  };

  const calculateDebtTotal = () => {
    const container = document.getElementById('debtItemsContainer');
    if (!container) return;
    const rows = container.querySelectorAll('.debt-item-row');
    let total = 0;
    state.currentDebtItems = [];
    
    rows.forEach(row => {
        const select = row.querySelector('.debt-product-select');
        const qtyInput = row.querySelector('.debt-qty-input');
        const subtotalInput = row.querySelector('input[type="text"]');
        
        if (select && select.selectedIndex > 0) {
            const option = select.options[select.selectedIndex];
            const id = parseInt(option.value);
            const price = parseFloat(option.getAttribute('data-price') || '0');
            const name = option.getAttribute('data-name');
            const qty = parseInt(qtyInput.value) || 0;
            
            if (qty > 0) {
                const subtotal = price * qty;
                total += subtotal;
                subtotalInput.value = formatCurrency(subtotal);
                
                state.currentDebtItems.push({
                    product_id: id,
                    product_name: name,
                    qty: qty,
                    price: price
                });
            }
        }
    });
    
    const amt = document.getElementById('debtFormAmount');
    if (amt) amt.value = total;
    const elTotalDisplay = document.getElementById('debtTotalDisplay');
    if (elTotalDisplay) {
        elTotalDisplay.textContent = 'Total Hutang: ' + formatCurrency(total);
    }
  };

  window.addDebtItemRow = addDebtItemRow;
  window.removeDebtItemRow = removeDebtItemRow;
  window.updateDebtItemPrice = updateDebtItemPrice;
  window.calculateDebtTotal = calculateDebtTotal;

  const openDebtModal = async () => {
    // Gerbang premium: gratis maksimal 5 kasbon aktif
    const activeCount = (state.debts || []).filter(d => d.status !== 'lunas').length;
    if (activeCount >= 5 && !await requirePremium('Kasbon lebih dari 5 catatan aktif')) return;
    const m = document.getElementById('debtModal');
    document.getElementById('debtForm')?.reset();
    document.getElementById('debtFormError')?.classList.add('hidden');
    
    const container = document.getElementById('debtItemsContainer');
    if (container) container.innerHTML = '';
    state.currentDebtItems = [];
    addDebtItemRow();

    if (m) m.classList.remove('hidden');
    document.getElementById('debtFormName')?.focus();
  };

  const closeDebtModal = () => {
    const m = document.getElementById('debtModal');
    if (m) m.classList.add('hidden');
  };

  const saveDebt = async e => {
    e.preventDefault();
    const name = document.getElementById('debtFormName').value.trim();
    const phone = document.getElementById('debtFormPhone').value.trim();
    const amount = Number(document.getElementById('debtFormAmount').value);
    const note = document.getElementById('debtFormNote').value.trim();
    const errEl = document.getElementById('debtFormError');
    const items = state.currentDebtItems || [];
    
    if (!name || !amount || amount <= 0) {
      if (errEl) { errEl.textContent = 'Nama dan total hutang wajib diisi.'; errEl.classList.remove('hidden'); }
      return;
    }
    
    if (items.length === 0) {
      if (errEl) { errEl.textContent = 'Pilih minimal satu produk.'; errEl.classList.remove('hidden'); }
      return;
    }

    // Validasi Stok
    for (let item of items) {
        const product = state.products.find(p => p.id === item.product_id);
        if (product && product.stock < item.qty) {
            if (errEl) { errEl.textContent = `Stok tidak cukup untuk produk ${product.name}. Tersedia: ${product.stock}`; errEl.classList.remove('hidden'); }
            return;
        }
    }

    let record = { 
        customer_name: name, 
        phone, 
        amount, 
        note, 
        status: 'belum', 
        created_at: new Date().toISOString(),
        items: items
    };
    
    let cashierName = "Unknown";
    const cashier = state.cashiers?.find(c => c.id === state.selectedCashierId) || state.cashiers?.find(c => c.role === 'admin') || state.cashiers?.[0];
    if (cashier) cashierName = cashier.name;

    let transactionId = null;

    const currentStore = (state.stores || []).find(s => String(s.id) == String(state.storeId));
    const storeUuid = currentStore ? currentStore.id : null;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Offline: masuk antrean lokal, disinkron otomatis saat online.
    // storeUuid wajib valid — entry tanpa store_id tak akan pernah bisa tersinkron.
    const queueDebtOffline = () => {
      if (!storeUuid || !uuidRegex.test(String(storeUuid))) {
        alert('Gagal: Data toko tidak valid.');
        return false;
      }
      record.id = 'D' + Date.now();
      record.pending = true;
      const q = getDebtQueue();
      q.push({ ...record, store_id: storeUuid, cashier_name: cashierName });
      saveDebtQueue(q);
      return true;
    };

    if (db && state.storeId && navigator.onLine) {
      if (!storeUuid || !uuidRegex.test(String(storeUuid))) {
          alert('Gagal: Data toko tidak valid.');
          return;
      }

      const { data, error } = await db.rpc('create_debt_transaction', {
          p_store_id: storeUuid,
          p_customer_name: name,
          p_phone: phone,
          p_amount: amount,
          p_note: note,
          p_items: items,
          p_cashier_name: cashierName
      });

      if (error) {
        if (isNetworkError(error)) {
          // Jaringan putus di tengah request → antre lokal
          if (!queueDebtOffline()) return;
        } else {
          // RPC gagal saat online: beri tahu user, JANGAN simpan diam-diam
          logError('saveDebt: create_debt_transaction gagal', { storeId: storeUuid }, error);
          const msg = 'Kasbon belum tersimpan. Periksa koneksi internet lalu coba lagi.';
          if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
          showAppToast(msg, 'error');
          return;
        }
      } else {
        let rData = data;
        if (Array.isArray(data)) rData = data[0];
        if (typeof rData === 'string') {
            try { rData = JSON.parse(rData); } catch(e){}
        }
        record.id = rData?.debt_id || data?.debt_id;
        record.transaction_id = rData?.transaction_id || data?.transaction_id;
        transactionId = record.transaction_id;
      }
    } else {
      if (!queueDebtOffline()) return;
    }
    
    // Kurangi stok lokal
    for (let item of items) {
        const product = state.products.find(p => p.id === item.product_id);
        if (product) {
            product.stock -= item.qty;
        }
    }

    state.debts = state.debts || [];
    state.debts.unshift(record);
    saveDebtsLocal();
    
    if (transactionId) {
        if (!state.transactions) state.transactions = [];
        state.transactions.unshift({
            id: transactionId,
            date: record.created_at,
            total: record.amount,
            discount: 0,
            paymentMethod: 'Hutang',
            cash: 0,
            change: 0,
            cashier: cashierName,
            items: items.map(i => ({
                id: i.product_id,
                name: i.product_name,
                qty: i.qty,
                price: i.price
            }))
        });
        syncStorage();
        if (typeof updateDashboard === 'function') updateDashboard();
        if (typeof renderHistory === 'function') renderHistory();
        if (typeof renderProducts === 'function') renderProducts();
    }

    closeDebtModal();
    renderKasbon();
    if (record.pending) {
        alert('Kasbon disimpan di perangkat ini dan akan tersimpan otomatis saat internet kembali.');
    } else {
        alert('Kasbon berhasil disimpan! Transaksi dan stok produk telah dicatat otomatis.');
    }
  };

  const markDebtPaid = async (id, btn) => {
    const activeOp = state.cashiers?.find(c => c.id === state.selectedCashierId);
    if (activeOp && activeOp.role !== 'admin') {
      alert('Hanya Admin Toko yang diizinkan untuk menandai kasbon lunas.');
      return;
    }
    const debt = (state.debts || []).find(d => String(d.id) === String(id));
    if (!debt) return;
    const paidAt = new Date().toISOString();
    if (String(id).startsWith('D')) {
      // Masih di antrean lokal → cukup ubah antrean, status ikut saat sinkron
      const q = getDebtQueue();
      const entry = q.find(en => String(en.id) === String(id));
      if (entry) { entry.status = 'lunas'; entry.paid_at = paidAt; saveDebtQueue(q); }
    } else if (db) {
      if (btn) btn.disabled = true; // cegah double-tap selama menunggu server
      const { error } = await db.from('debts').update({ status: 'lunas', paid_at: paidAt }).eq('id', id);
      if (error) {
        if (btn) btn.disabled = false;
        logError('markDebtPaid: gagal update', { debtId: id }, error);
        showAppToast('Kasbon belum ditandai lunas. Periksa koneksi internet lalu coba lagi.', 'error');
        return; // jangan ubah state lokal agar tetap sinkron dengan server
      }
      // Transaksi Hutang terkait ikut ditandai Lunas di server
      if (debt.transaction_id) {
        await db.from('transactions').update({ payment_method: 'Lunas' }).eq('id', debt.transaction_id);
      }
    }
    debt.status = 'lunas';
    debt.paid_at = paidAt;
    if (debt.transaction_id && state.transactions) {
      const tx = state.transactions.find(t => String(t.id) === String(debt.transaction_id));
      if (tx) {
        tx.paymentMethod = 'Lunas';
        if (typeof renderHistory === 'function') renderHistory();
      }
    }
    saveDebtsLocal();
    renderKasbon();
  };

  let _debtDeleteId = null;

  const closeDebtDeleteModal = () => {
    _debtDeleteId = null;
    document.getElementById('debtDeleteModal')?.classList.add('hidden');
  };

  const deleteDebt = id => {
    const activeOp = state.cashiers?.find(c => c.id === state.selectedCashierId);
    if (activeOp && activeOp.role !== 'admin') {
      alert('Hanya Admin Toko yang diizinkan untuk menghapus catatan kasbon.');
      return;
    }
    const debt = (state.debts || []).find(d => String(d.id) === String(id));
    if (!debt) return;
    _debtDeleteId = id;
    const textEl = document.getElementById('debtDeleteText');
    if (textEl) textEl.textContent = `Catatan kasbon ${debt.customer_name} ${formatCurrency(debt.amount)} akan dihapus permanen. Transaksi terkait dibatalkan dan stok dikembalikan.`;
    document.getElementById('debtDeleteModal')?.classList.remove('hidden');
  };

  const confirmDeleteDebt = async () => {
    const id = _debtDeleteId;
    if (id === null) return;
    const debt = (state.debts || []).find(d => String(d.id) === String(id));
    if (!debt) { closeDebtDeleteModal(); return; }
    const activeOp = state.cashiers?.find(c => c.id === state.selectedCashierId);
    const adminName = activeOp ? activeOp.name : 'Supervisor';
    const confirmBtn = document.getElementById('debtDeleteConfirm');
    if (String(id).startsWith('D')) {
      // Masih di antrean lokal → hapus dari antrean saja
      saveDebtQueue(getDebtQueue().filter(en => String(en.id) !== String(id)));
    } else if (db) {
      if (confirmBtn) confirmBtn.disabled = true; // cegah double-tap selama menunggu server
      // Batalkan (VOID) transaksi Hutang terkait + kembalikan stok di server
      if (debt.transaction_id) {
        const { error: txErr } = await db.from('transactions').update({
          status: 'void',
          void_reason: 'Kasbon Dihapus',
          void_by: adminName,
          void_at: new Date().toISOString()
        }).eq('id', debt.transaction_id);
        if (!txErr && debt.items) {
          for (const item of debt.items) {
            const numId = parseInt(item.product_id);
            if (isNaN(numId) || item.qty <= 0) continue;
            await db.rpc('increment_stock', { p_product_id: numId, p_qty: item.qty });
          }
        }
      }
      const { error } = await db.from('debts').delete().eq('id', id);
      if (confirmBtn) confirmBtn.disabled = false;
      if (error) {
        logError('deleteDebt: gagal delete', { debtId: id }, error);
        showAppToast('Kasbon belum terhapus. Periksa koneksi internet lalu coba lagi.', 'error');
        return; // jangan ubah state lokal agar tetap sinkron dengan server
      }
    }
    state.debts = (state.debts || []).filter(d => String(d.id) !== String(id));
    if (debt.transaction_id && state.transactions) {
      const tx = state.transactions.find(t => String(t.id) === String(debt.transaction_id));
      if (tx) {
        tx.status = 'void';
        tx.voidReason = 'Kasbon Dihapus';
        tx.voidBy = adminName;
        tx.voidAt = new Date().toISOString();
        if (typeof renderHistory === 'function') renderHistory();
        if (typeof updateDashboard === 'function') updateDashboard();
      }
    }
    if (debt.items) {
      for (const item of debt.items) {
        const product = state.products.find(p => String(p.id) === String(item.product_id));
        if (product) product.stock += item.qty;
      }
      if (typeof renderProducts === 'function') renderProducts();
    }
    saveDebtsLocal();
    closeDebtDeleteModal();
    renderKasbon();
  };

  const sendDebtReminder = id => {
    const debt = (state.debts || []).find(d => String(d.id) === String(id));
    if (!debt || !debt.phone) return;
    const store = getStoreSettings();
    // 08xxx → 628xxx untuk wa.me
    const phone = debt.phone.replace(/[^0-9]/g, '').replace(/^0/, '62');
    const msg = `Halo ${debt.customer_name} 🙏\n\nMengingatkan kasbon di *${store.name}*:\nJumlah: *${formatCurrency(debt.amount)}*${debt.note ? '\nKeterangan: ' + debt.note : ''}\nTanggal: ${new Date(debt.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}\n\nMohon konfirmasinya ya. Terima kasih! 😊`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ── Scanner Barcode Fisik (Bluetooth/USB, mode HID "keyboard wedge") ─────
  // Scanner portabel mengetik kode + Enter sangat cepat. Listener global ini
  // menangkap ketikan cepat itu dari mana saja tanpa perlu fokus ke kolom input.
  const initHardwareScanner = () => {
    let buffer = '';
    let lastKeyTime = 0;
    const MAX_INTERVAL = 50;  // ms antar karakter — manusia tidak bisa secepat ini
    const MIN_LENGTH = 4;

    const showScanToast = (text, ok) => {
      let toast = document.getElementById('hwScanToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'hwScanToast';
        toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[300] rounded-lg px-5 py-3 text-white text-sm font-semibold shadow-sm transition-opacity duration-300 no-print';
        document.body.appendChild(toast);
      }
      toast.textContent = text;
      toast.style.background = ok ? '#059669' : '#e11d48';
      toast.style.opacity = '1';
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    };

    const processScan = code => {
      // Form produk terbuka → isi kolom barcode produk
      const inventoryModal = document.getElementById('inventoryModal');
      if (inventoryModal && !inventoryModal.classList.contains('hidden')) {
        const barcodeField = document.getElementById('productBarcode');
        if (barcodeField) {
          barcodeField.value = code;
          showScanToast(`Barcode terisi: ${code}`, true);
        }
        return;
      }
      // Selain itu → cari produk dan masukkan keranjang
      const product = state.products.find(p =>
        p.barcode === code || p.code === code || p.id === code
      );
      if (product) {
        if (product.stock <= 0) {
          showScanToast(`${product.name} — stok habis`, false);
          return;
        }
        addToCart(product.id);
        showScanToast(`${product.name} → keranjang`, true);
        // Pastikan kasir melihat keranjang: pindah ke layar kasir jika sedang di layar lain
        const kasirScreen = document.getElementById('kasir');
        if (kasirScreen && kasirScreen.classList.contains('hidden')) showScreen('kasir');
      } else {
        showScanToast(`Kode ${code} tidak ditemukan`, false);
        if (dom.searchInput) { state.searchQuery = code; dom.searchInput.value = code; renderProducts(); }
      }
    };

    document.addEventListener('keydown', e => {
      // Saat user mengetik di kolom input, jangan ganggu (kolom punya handler sendiri)
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // Hanya aktif setelah login
      if (!state.storeId && !state.cashiers.length) return;

      const now = Date.now();
      if (now - lastKeyTime > MAX_INTERVAL) buffer = ''; // jeda lama = bukan scanner
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (buffer.length >= MIN_LENGTH) {
          e.preventDefault();
          processScan(buffer.trim());
        }
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    });
  };

  // ── Chat Bantuan (asisten pintar berbasis kata kunci, tanpa biaya API) ────
  const HELP_TOPICS = [
    { keys: ['halo', 'hai', 'hello', 'assalamualaikum', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam'], a: 'Waalaikumsalam, halo juga! 😊 Saya Aisyah, asisten Kasir UMKM. Ada yang bisa saya bantu? Kamu bisa tanya soal produk, transaksi, struk, QRIS, langganan, atau fitur lainnya.' },
    { keys: ['terima kasih', 'makasih', 'thanks', 'mantap', 'sip '], a: 'Sama-sama! 🤗 Senang bisa membantu. Kalau ada pertanyaan lain, tanya saja kapan pun ya.' },
    { keys: ['siapa kamu', 'kamu siapa', 'nama kamu', 'namamu'], a: 'Saya Aisyah 🧕, asisten virtual Kasir UMKM Simpel. Tugas saya membantu kamu memakai aplikasi ini — dari input produk, transaksi, cetak struk, sampai urusan langganan.' },
    { keys: ['cara pakai', 'mulai dari mana', 'panduan', 'tutorial', 'bingung', 'cara menggunakan'], a: 'Alur singkatnya: (1) Tambah produk di menu Inventori, (2) Buka halaman Kasir → pilih/scan produk → masuk keranjang, (3) Pilih metode bayar → Bayar, (4) Struk muncul otomatis, tinggal cetak. Coba tanya hal spesifik, misalnya "cara tambah produk" atau "cara cetak struk".' },
    { keys: ['transaksi', 'jualan', 'keranjang', 'checkout', 'kembalian', 'cara jual'], a: 'Di halaman Kasir: klik produk atau scan barcode untuk memasukkannya ke keranjang. Atur jumlah, isi diskon kalau ada, pilih metode bayar (Tunai/QRIS/Transfer), masukkan uang yang diterima — kembalian dihitung otomatis — lalu klik Bayar. Struk langsung muncul.' },
    { keys: ['riwayat', 'history', 'transaksi kemarin', 'cetak ulang'], a: 'Menu Riwayat menampilkan semua transaksi. Ada kolom pencarian, dan tiap baris punya tombol 🖨 Struk untuk mencetak ulang struk transaksi lama.' },
    { keys: ['untung', 'laba', 'profit', 'margin', 'keuntungan', 'modal'], a: 'Saat menambah produk, isi harga modal dan harga jual. Aplikasi otomatis menghitung keuntungan: lihat laba hari ini dan persentase laba di Dashboard, serta estimasi keuntungan di laporan PDF.' },
    { keys: ['pembelian', 'supplier', 'kulakan', 'restok', 'belanja stok'], a: 'Menu Pembelian dipakai untuk mencatat belanja stok dari supplier. Pilih produk, isi jumlah dan harga beli — stok produk otomatis bertambah setelah pembelian disimpan.' },
    { keys: ['install', 'pasang aplikasi', 'unduh', 'download', 'layar utama', 'home screen'], a: 'Aplikasi ini bisa di-install langsung dari browser: buka di Chrome Android → menu ⋮ → "Tambahkan ke layar utama". Ikonnya muncul seperti aplikasi biasa dan bisa dibuka tanpa mengetik alamat lagi.' },
    { keys: ['hp lain', 'perangkat lain', 'laptop', 'komputer', 'multi device', 'dua hp'], a: 'Bisa! Data tersimpan di cloud, jadi kamu bisa login dengan akun yang sama dari HP lain, tablet, atau laptop — data toko langsung tersinkron.' },
    { keys: ['aman', 'keamanan', 'data hilang', 'backup', 'bocor'], a: 'Data toko kamu tersimpan aman di cloud dengan isolasi per-toko — pemilik toko lain tidak bisa melihat data kamu. Koneksi terenkripsi HTTPS, dan kami tidak pernah menjual data pengguna.' },
    { keys: ['error', 'tidak bisa', 'gagal', 'masalah', 'lemot', 'macet', 'blank'], a: 'Coba langkah ini dulu: (1) refresh halaman 2x, (2) pastikan internet stabil, (3) logout lalu login lagi. Kalau masih bermasalah, kirim detailnya (screenshot kalau bisa) ke Telegram kami: https://t.me/+veK2jeQuBkQwNzU1 — kami bantu cek.' },
    { keys: ['kontak', 'customer service', 'hubungi admin', 'komplain', 'saran', 'kritik'], a: 'Untuk bantuan lebih lanjut, saran, atau komplain, hubungi kami via Telegram: https://t.me/+veK2jeQuBkQwNzU1 — dibalas maksimal 1x24 jam di hari kerja. 😊' },
    { keys: ['produk', 'barang', 'tambah produk', 'input', 'kategori'], a: 'Untuk menambah produk: buka menu Inventori → klik "+ Tambah Produk". Kode produk dibuat otomatis, kamu juga bisa scan barcode dengan tombol 📷. Isi nama, harga jual, harga modal, dan stok, lalu Simpan.' },
    { keys: ['scan', 'barcode', 'kamera'], a: 'Scanner barcode ada di 2 tempat: (1) halaman Kasir — tombol "Scan Barcode" untuk memanggil produk ke keranjang, (2) form Tambah Produk — tombol 📷 untuk mengisi kode otomatis. Izinkan akses kamera saat diminta browser. Scanner fisik Bluetooth/USB juga didukung!' },
    { keys: ['scanner fisik', 'scanner portabel', 'scanner bluetooth', 'scanner usb', 'alat scan', 'tembak'], a: 'Scanner portabel (Bluetooth/USB) langsung didukung! Pair scanner ke HP/laptop (mode HID/keyboard), buka halaman Kasir, lalu tembak barcode — produk otomatis masuk keranjang dengan notifikasi hijau. Di form Tambah Produk, hasil scan otomatis mengisi kolom barcode. Tidak perlu pengaturan apa pun.' },
    { keys: ['struk', 'cetak', 'print', 'printer', 'bluetooth', 'thermal'], a: 'Setelah pembayaran, struk muncul otomatis. Pilihan cetak: 📶 Cetak Bluetooth (printer thermal Bluetooth Android, butuh aplikasi gratis RawBT dari Play Store), 🖨 Cetak Thermal (printer USB/WiFi), atau Cetak Biasa. Ukuran kertas 58/80mm diatur di Pengaturan.' },
    { keys: ['qris', 'qr', 'dana', 'pembayaran digital', 'dinamis'], a: 'Upload gambar QRIS tokomu di menu Pengaturan — QR tampil otomatis saat pelanggan bayar QRIS. Pengguna Premium dapat QRIS Dinamis 👑: nominal belanja otomatis tertanam di QR, pelanggan tidak perlu ketik nominal lagi. Konfirmasi manual setelah notifikasi uang masuk.' },
    { keys: ['kasir', 'pin', 'operator', 'karyawan', 'pegawai'], a: 'Tambahkan kasir di menu Kelola Kasir (khusus admin). Setiap kasir punya PIN sendiri. Kasir dengan role "kasir" hanya bisa membuka halaman Kasir & Riwayat — menu admin otomatis tersembunyi.' },
    { keys: ['langganan', 'premium', 'trial', 'berlangganan', 'upgrade', 'gratis', 'harga', 'paket'], a: 'Fitur dasar GRATIS selamanya! 🎉 Ada 2 paket berbayar: (1) Premium Rp25.000/bulan — QRIS Dinamis, export PDF, operator & kasbon tanpa batas. (2) Bisnis Rp50.000/bulan 🏢 — semua Premium + Multi-Cabang tanpa batas & Dashboard Pusat. 30 hari pertama semua fitur terbuka gratis. Bayar via QRIS lalu konfirmasi via Telegram: https://t.me/+veK2jeQuBkQwNzU1.' },
    { keys: ['laporan', 'export', 'pdf', 'omset', 'penjualan', 'grafik'], a: 'Laporan ada di Dashboard: grafik penjualan 7 hari, laporan cepat (hari ini / 7 / 30 hari), dan tombol 📄 Export PDF untuk menyimpan/mencetak laporan lengkap.' },
    { keys: ['diskon', 'potongan'], a: 'Di halaman Kasir, sebelum bayar kamu bisa isi diskon nominal (Rp) ATAU persen (%) — salah satu saja. Diskon tercetak di struk.' },
    { keys: ['stok', 'habis', 'minimum'], a: 'Stok berkurang otomatis setiap transaksi. Atur "stok minimum" di tiap produk — produk yang menipis akan diberi tanda peringatan di Inventori. Tambah stok lewat menu Pembelian.' },
    { keys: ['shift', 'tutup kasir'], a: 'Gunakan tombol Shift/Tutup Kasir di halaman Kasir untuk melihat ringkasan penjualan selama shift berjalan dan mencetaknya saat pergantian operator.' },
    { keys: ['offline', 'internet', 'sinyal'], a: 'Aplikasi tetap bisa dibuka saat offline (PWA). Namun sinkronisasi data ke cloud butuh internet — pastikan online secara berkala agar data tersimpan aman.' },
    { keys: ['cabang', 'multi cabang', 'banyak toko', 'outlet', 'bisnis'], a: 'Multi-Cabang ada di paket Bisnis (Rp50.000/bulan) 🏢 — satu akun bisa punya banyak cabang. Buka Pengaturan → Cabang Toko → Tambah Cabang. Tiap cabang punya stok & transaksi sendiri. Ganti cabang lewat dropdown 🏪 Cabang di pojok kanan atas. Rekap omzet semua cabang muncul di Dashboard Pusat. Selama 30 hari trial fitur ini terbuka gratis.' },
    { keys: ['password', 'lupa', 'reset'], a: 'Lupa password? Di halaman login klik "Lupa password", masukkan email toko — link reset akan dikirim ke email tersebut.' },
    { keys: ['hapus akun', 'hapus data'], a: 'Untuk menghapus akun dan seluruh data toko secara permanen, buka menu Pengaturan → gulir ke bawah → klik "Hapus Akun Permanen". Ketik ulang email Anda sebagai konfirmasi. Tindakan ini tidak dapat dibatalkan dan seluruh data (toko, produk, transaksi, kasir, kasbon, langganan) akan terhapus selamanya.' },
    { keys: ['rokok', 'tembakau', 'vape'], a: 'Produk rokok, tembakau, dan vape diblokir permanen dan tidak bisa diinput ke aplikasi ini.' }
  ];

  const helpChatAnswer = q => {
    const text = q.toLowerCase();
    let best = null, bestScore = 0;
    HELP_TOPICS.forEach(t => {
      const score = t.keys.reduce((s, k) => s + (text.includes(k) ? k.length : 0), 0);
      if (score > bestScore) { bestScore = score; best = t; }
    });
    if (best) return best.a;
    return 'Maaf, saya belum paham pertanyaan itu 🙏 Coba kata kunci seperti: produk, scan, struk, QRIS, kasir, langganan, laporan, diskon, stok, printer, install, atau backup. Atau hubungi kami langsung via Telegram: https://t.me/+veK2jeQuBkQwNzU1';
  };

  const initHelpChat = () => {
    const fab = document.getElementById('helpChatFab');
    const panel = document.getElementById('helpChatPanel');
    const closeBtn = document.getElementById('helpChatClose');
    const messages = document.getElementById('helpChatMessages');
    const form = document.getElementById('helpChatForm');
    const input = document.getElementById('helpChatInput');
    const quick = document.getElementById('helpChatQuick');
    if (!fab || !panel) return;

    const addMsg = (text, who) => {
      const div = document.createElement('div');
      div.className = who === 'user'
        ? 'ml-auto max-w-[85%] rounded-lg rounded-br-md bg-primary text-white px-4 py-2.5'
        : 'mr-auto max-w-[85%] rounded-lg rounded-bl-md bg-white border border-hairline text-body px-4 py-2.5';
      // Selalu pakai textContent (bukan innerHTML) agar aman dari XSS jawaban LLM/input pengguna
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
      return div;
    };

    // Riwayat percakapan untuk konteks AI (maksimal 6 pesan terakhir)
    const history = [];
    const trimHistory = () => { if (history.length > 6) history.splice(0, history.length - 6); };

    const ask = async q => {
      addMsg(q, 'user');
      history.push({ role: 'user', content: q });
      trimHistory();

      // Indikator "sedang mengetik"
      const typingNode = addMsg('Aisyah sedang mengetik…', 'bot');

      const fallback = () => {
        const a = helpChatAnswer(q);
        addMsg(a, 'bot');
        history.push({ role: 'assistant', content: a });
        trimHistory();
      };

      try {
        const { data, error } = await db.functions.invoke('aisyah-chat', { body: { messages: history } });
        typingNode.remove();
        if (error || !data || !data.reply) {
          fallback();
        } else {
          addMsg(data.reply, 'bot');
          history.push({ role: 'assistant', content: data.reply });
          trimHistory();
        }
      } catch (e) {
        typingNode.remove();
        fallback();
      }
    };

    // Tombol pertanyaan cepat
    ['Cara cetak struk?', 'Cara pakai QRIS?', 'Soal langganan', 'Tambah kasir'].forEach(label => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rounded-full border border-hairline bg-primary-light text-primary px-3 py-1 text-xs hover:bg-primary-light transition';
      b.textContent = label;
      b.addEventListener('click', () => ask(label));
      quick.appendChild(b);
    });

    fab.addEventListener('click', () => {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden') && !messages.childElementCount) {
        addMsg('Assalamualaikum! 🧕 Saya Aisyah, asisten Kasir UMKM. Tanya apa saja ya: cara pakai fitur, printer, QRIS, langganan, dan lainnya. Insya Allah saya bantu! 😊', 'bot');
      }
    });
    closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      ask(q);
    });
  };

  const showHelpChatFab = () => document.getElementById('helpChatFab')?.classList.remove('hidden');

  // ── Super Admin Module ───────────────────────────────────────────────────
  // isSuperAdmin: true setelah berhasil terverifikasi lewat admin_users di Supabase.
  // Nilai ini di-set saat enterAppAfterAuth dan di-reset saat logout.
  let _isSuperAdmin = false;

  const checkSuperAdmin = async () => {
    if (!db || !state.authUser?.id) { _isSuperAdmin = false; return; }
    try {
      // Primary: lookup by user_id (single round-trip, no Edge Function overhead)
      const { data, error } = await db
        .from('admin_users')
        .select('id')
        .eq('user_id', state.authUser.id)
        .maybeSingle();
      if (!error && data) { _isSuperAdmin = true; return; }
      // Fallback: baris dengan user_id NULL tidak terlihat oleh RLS policy
      // (user_id = auth.uid() tidak pernah cocok dengan NULL).
      // Verifikasi via Edge Function yang memakai service-role dan lookup by email.
      // Gunakan check_admin jika sudah di-deploy, fallback ke list_stores untuk kompatibilitas.
      const { data: checkData, error: checkErr } = await db.functions.invoke('admin-subscription', {
        body: { action: 'check_admin' }
      });
      if (!checkErr) {
        _isSuperAdmin = checkData?.is_admin === true;
        return;
      }
      // check_admin belum di-deploy — gunakan list_stores sebagai pengganti sementara
      const { error: listErr } = await db.functions.invoke('admin-subscription', {
        body: { action: 'list_stores' }
      });
      _isSuperAdmin = !listErr;
    } catch {
      _isSuperAdmin = false;
    }
  };

  const applySuperAdminVisibility = () => {
    const btn = document.getElementById('openSuperAdminBtn');
    if (btn) {
      if (_isSuperAdmin) {
        btn.classList.remove('hidden');
        btn.style.display = '';
      } else {
        btn.classList.add('hidden');
        btn.style.display = 'none';
      }
    }
    const deleteSection = document.getElementById('deleteAccountSection');
    if (deleteSection) {
      deleteSection.style.display = _isSuperAdmin ? 'none' : '';
    }
    // Sembunyikan section toko (nama/alamat/struk/preview/cabang) hanya untuk super admin
    // yang tidak memiliki toko sendiri.
    const hideStoreUI = _isSuperAdmin && !state.storeId;
    const storeFormFields = document.getElementById('storeFormFields');
    if (storeFormFields) storeFormFields.style.display = hideStoreUI ? 'none' : '';
    const struPreviewSection = document.getElementById('struPreviewSection');
    if (struPreviewSection) struPreviewSection.style.display = hideStoreUI ? 'none' : '';
    const branchSection = document.getElementById('branchSettingsSection');
    if (branchSection) branchSection.style.display = hideStoreUI ? 'none' : '';
  };

  // Kalkulator tanggal berakhir dari pilihan durasi dropdown
  const computeUntilDate = () => {
    const duration = document.getElementById('superAdminDuration')?.value;
    if (duration === 'custom') {
      const d = document.getElementById('superAdminCustomDate')?.value;
      return d ? new Date(d).toISOString() : null;
    }
    const months = parseInt(duration || '1', 10);
    const until = new Date();
    until.setMonth(until.getMonth() + months);
    return until.toISOString();
  };

  const superAdminShowMsg = (type, msg) => {
    const err = document.getElementById('superAdminFormError');
    const ok  = document.getElementById('superAdminFormSuccess');
    if (!err || !ok) return;
    if (type === 'error') {
      err.textContent = msg; err.classList.remove('hidden');
      ok.classList.add('hidden');
    } else {
      ok.textContent = msg; ok.classList.remove('hidden');
      err.classList.add('hidden');
    }
    setTimeout(() => { err.classList.add('hidden'); ok.classList.add('hidden'); }, 4000);
  };

  const superAdminStatusLabel = store => {
    const now = Date.now();
    const bizMs  = store.business_until ? new Date(store.business_until).getTime() : null;
    const premMs = store.premium_until  ? new Date(store.premium_until).getTime()  : null;
    const triMs  = store.trial_ends_at  ? new Date(store.trial_ends_at).getTime()  : null;
    if (bizMs  && bizMs  > now) return '<span class="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold">Bisnis</span>';
    if (premMs && premMs > now) return '<span class="px-2 py-0.5 rounded-full bg-primary-light text-primary text-xs font-semibold">Premium</span>';
    if (triMs  && triMs  > now) return '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">Trial</span>';
    return '<span class="px-2 py-0.5 rounded-full bg-surface-soft text-muted text-xs font-semibold">Gratis</span>';
  };

  const superAdminFmtDate = v => {
    if (!v) return '<span class="text-muted-soft">—</span>';
    return esc(new Date(v).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }));
  };

  // Render tabel toko dan isi dropdown pilih toko
  const superAdminRenderTable = (stores) => {
    const wrapper = document.getElementById('superAdminTableWrapper');
    const sel = document.getElementById('superAdminStoreSelect');
    if (!wrapper || !sel) return;

    // Isi dropdown
    sel.innerHTML = '<option value="">— Pilih toko —</option>' +
      stores.map(s =>
        `<option value="${esc(s.id)}">${esc(s.name || 'Tanpa Nama')} — ${esc(s.owner_email || s.owner_id)}</option>`
      ).join('');

    if (!stores.length) {
      wrapper.innerHTML = '<p class="text-muted-soft text-sm">Belum ada toko terdaftar.</p>';
      return;
    }

    wrapper.innerHTML = `
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="border-b border-hairline text-left text-muted text-xs uppercase tracking-wide">
            <th class="py-2 pr-4 font-medium">Nama Toko</th>
            <th class="py-2 pr-4 font-medium">Owner ID</th>
            <th class="py-2 pr-4 font-medium">Email Pemilik</th>
            <th class="py-2 pr-4 font-medium">Trial</th>
            <th class="py-2 pr-4 font-medium">Premium s/d</th>
            <th class="py-2 pr-4 font-medium">Bisnis s/d</th>
            <th class="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          ${stores.map(s => `
            <tr class="border-b border-hairline-soft hover:bg-surface-soft transition">
              <td class="py-2 pr-4 font-medium text-ink">${esc(s.name || '-')}</td>
              <td class="py-2 pr-4 text-muted font-mono text-xs">${esc(s.owner_id || '-')}</td>
              <td class="py-2 pr-4 text-muted">${esc(s.owner_email || '-')}</td>
              <td class="py-2 pr-4">${superAdminFmtDate(s.trial_ends_at)}</td>
              <td class="py-2 pr-4">${superAdminFmtDate(s.premium_until)}</td>
              <td class="py-2 pr-4">${superAdminFmtDate(s.business_until)}</td>
              <td class="py-2">${superAdminStatusLabel(s)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  };

  const superAdminLoadStores = async () => {
    const wrapper = document.getElementById('superAdminTableWrapper');
    const sel = document.getElementById('superAdminStoreSelect');
    if (wrapper) wrapper.innerHTML = '<p class="text-muted-soft text-sm">Memuat data...</p>';
    if (sel) sel.innerHTML = '<option value="">— Pilih toko —</option>';
    try {
      // Strategi 1: panggil RPC list_all_stores_for_admin (lebih andal, tanpa Edge Function)
      const { data: rpcStores, error: rpcErr } = await db.rpc('list_all_stores_for_admin');
      if (!rpcErr && rpcStores) {
        console.log('[SuperAdmin] RPC berhasil, jumlah toko:', rpcStores.length);
        // Hitung status langganan di client
        const now = Date.now();
        const enriched = rpcStores.map(s => {
          const trialMs = s.trial_ends_at ? new Date(s.trial_ends_at).getTime() : null;
          const premMs  = s.premium_until ? new Date(s.premium_until).getTime()  : null;
          const bizMs   = s.business_until ? new Date(s.business_until).getTime() : null;
          let subscription_status = 'Gratis';
          if (bizMs  && bizMs  > now) subscription_status = 'Bisnis';
          else if (premMs && premMs > now) subscription_status = 'Premium';
          else if (trialMs && trialMs > now) subscription_status = 'Trial';
          return { ...s, subscription_status };
        });
        superAdminRenderTable(enriched);
        return;
      }
      console.warn('[SuperAdmin] RPC gagal, fallback ke Edge Function:', rpcErr?.message);

      // Strategi 2 (fallback): panggil Edge Function admin-subscription
      const res = await db.functions.invoke('admin-subscription', {
        body: { action: 'list_stores' }
      });
      console.log('[SuperAdmin] Edge Function result:', res);
      let { data, error } = res;

      if (error) {
        let errDetail = error.message || '';
        try {
          if (error.context && typeof error.context.json === 'function') {
            const errBody = await error.context.json();
            errDetail = errBody?.error || errDetail;
          }
        } catch (_) {}
        console.error('[SuperAdmin] invoke error:', error);
        const httpStatus = error?.context?.status ?? error?.status ?? null;
        const statusSuffix = httpStatus ? ` (HTTP ${httpStatus})` : '';
        superAdminShowMsg('error', `Gagal memuat data toko${statusSuffix}: ${errDetail}`);
        if (wrapper) wrapper.innerHTML = `<p class="text-rose-500 text-sm">Gagal memuat data toko${statusSuffix}: ${esc(errDetail)}</p>`;
        if (sel) sel.innerHTML = '<option value="">— Pilih toko —</option>';
        return;
      }

      // Supabase JS v2 kadang mengembalikan data sebagai string JSON
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) {}
      }

      if (!data?.stores) {
        console.warn('[SuperAdmin] data tidak mengandung stores:', data);
        if (wrapper) wrapper.innerHTML = '<p class="text-rose-500 text-sm">Respons tidak mengandung data toko. Periksa Console (F12).</p>';
        if (sel) sel.innerHTML = '<option value="">— Pilih toko —</option>';
        return;
      }
      superAdminRenderTable(data.stores);
    } catch (e) {
      console.error('[SuperAdmin] exception:', e);
      const errMsg = e?.message ? ` — ${e.message}` : '';
      superAdminShowMsg('error', `Terjadi kesalahan koneksi${errMsg}.`);
      if (wrapper) wrapper.innerHTML = `<p class="text-rose-500 text-sm">Terjadi kesalahan koneksi${e?.message ? ` — ${esc(e.message)}` : ''}.</p>`;
      if (sel) sel.innerHTML = '<option value="">— Pilih toko —</option>';
    }
  };

  const bindSuperAdminEvents = () => {
    // Tombol "Admin Panel" di pengaturan → navigasi ke screen super admin
    document.getElementById('openSuperAdminBtn')?.addEventListener('click', () => {
      showScreen('screen-superadmin');
    });

    // Refresh
    document.getElementById('superAdminRefreshBtn')?.addEventListener('click', superAdminLoadStores);

    // Toggle custom date input
    document.getElementById('superAdminDuration')?.addEventListener('change', e => {
      const wrap = document.getElementById('superAdminCustomDateWrapper');
      if (wrap) wrap.classList.toggle('hidden', e.target.value !== 'custom');
    });

    // Aktifkan langganan
    document.getElementById('superAdminActivateBtn')?.addEventListener('click', async () => {
      const storeId = document.getElementById('superAdminStoreSelect')?.value;
      const pkg     = document.getElementById('superAdminPackage')?.value;
      const until   = computeUntilDate();
      if (!storeId) { superAdminShowMsg('error', 'Pilih toko terlebih dahulu.'); return; }
      if (!until)   { superAdminShowMsg('error', 'Pilih tanggal berakhir terlebih dahulu.'); return; }

      const btn = document.getElementById('superAdminActivateBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
      try {
        const { data, error } = await db.functions.invoke('admin-subscription', {
          body: { action: 'activate', store_id: storeId, package: pkg, until }
        });
        if (error || !data?.success) {
          superAdminShowMsg('error', 'Gagal mengaktifkan: ' + (data?.error || error?.message || 'kesalahan tidak dikenal'));
        } else {
          superAdminShowMsg('ok', 'Langganan berhasil diaktifkan.');
          // AC9: invalidasi cache langganan agar status baru langsung terlihat
          invalidateSubscriptionCache();
          await superAdminLoadStores();
        }
      } catch (e) {
        superAdminShowMsg('error', 'Terjadi kesalahan koneksi.');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = iconText('check', 'Aktifkan'); }
      }
    });

    // Log Error Aplikasi
    document.getElementById('superAdminLoadLogsBtn')?.addEventListener('click', async () => {
      const wrapper = document.getElementById('superAdminErrorLogsWrapper');
      const copyWrapper = document.getElementById('superAdminCopyLogsWrapper');
      if (!wrapper) return;
      const btn = document.getElementById('superAdminLoadLogsBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Memuat...'; }
      wrapper.innerHTML = '<p class="text-muted text-sm">Memuat log error...</p>';
      if (copyWrapper) copyWrapper.classList.add('hidden');
      try {
        const { data, error } = await db.rpc('list_error_logs_for_admin');
        if (error) {
          wrapper.innerHTML = '<p class="text-rose-500 text-sm">Gagal memuat log. Pastikan migration 15_error_logs.sql sudah dijalankan.</p>';
          return;
        }
        if (!data || !data.length) {
          wrapper.innerHTML = '<p class="text-muted-soft text-sm">Tidak ada log error.</p>';
          return;
        }
        wrapper._logsData = data;
        wrapper.innerHTML = `<p class="text-muted text-sm mb-2">${data.length} entri log terbaru:</p>` +
          data.map(row => `<div class="rounded-lg border border-hairline bg-surface-soft p-3 mb-2 text-xs font-mono overflow-x-auto">
            <span class="text-muted-soft">${esc(row.created_at ? new Date(row.created_at).toLocaleString('id-ID') : '')}</span>
            <span class="ml-2 text-rose-600 font-semibold">${esc(row.message)}</span>
            ${row.store_name ? `<span class="ml-2 text-muted">[${esc(row.store_name)}]</span>` : ''}
            ${row.url ? `<span class="ml-2 text-muted-soft">${esc(row.url)}</span>` : ''}
          </div>`).join('');
        if (copyWrapper) copyWrapper.classList.remove('hidden');
      } catch (e) {
        wrapper.innerHTML = '<p class="text-rose-500 text-sm">Gagal memuat log. Pastikan migration 15_error_logs.sql sudah dijalankan.</p>';
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Muat Log'; }
      }
    });

    document.getElementById('superAdminCopyLogsBtn')?.addEventListener('click', async () => {
      const wrapper = document.getElementById('superAdminErrorLogsWrapper');
      const copiedMsg = document.getElementById('superAdminCopiedMsg');
      const logs = wrapper?._logsData;
      if (!logs) return;
      const redacted = logs.map(row => ({
        ...row,
        user_email: row.user_email ? row.user_email.slice(0, 3) + '***' : null
      }));
      const jsonStr = JSON.stringify(redacted, null, 2);
      try {
        await navigator.clipboard.writeText(jsonStr);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = jsonStr;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (copiedMsg) {
        copiedMsg.classList.remove('hidden');
        setTimeout(() => copiedMsg.classList.add('hidden'), 2000);
      }
    });

    // Revokasi langganan
    document.getElementById('superAdminRevokeBtn')?.addEventListener('click', async () => {
      const storeId = document.getElementById('superAdminStoreSelect')?.value;
      if (!storeId) { superAdminShowMsg('error', 'Pilih toko terlebih dahulu.'); return; }
      if (!confirm('Yakin merevokasi semua langganan toko ini?')) return;

      const btn = document.getElementById('superAdminRevokeBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
      try {
        const { data, error } = await db.functions.invoke('admin-subscription', {
          body: { action: 'revoke', store_id: storeId }
        });
        if (error || !data?.success) {
          superAdminShowMsg('error', 'Gagal merevokasi: ' + (data?.error || error?.message || 'kesalahan tidak dikenal'));
        } else {
          superAdminShowMsg('ok', 'Langganan berhasil direvokasi.');
          invalidateSubscriptionCache();
          await superAdminLoadStores();
        }
      } catch (e) {
        superAdminShowMsg('error', 'Terjadi kesalahan koneksi.');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = iconText('trash', 'Revokasi'); }
      }
    });
  };
  // ── End Super Admin Module ───────────────────────────────────────────────

  const init = async () => {
    setLoadingStatus('Menghubungkan ke database...', 10);
    // Snapshot hash & query string SEBELUM createClient dipanggil sama sekali.
    // Root cause bypass: link recovery PKCE dari Supabase membawa
    // "?code=...&type=recovery" di QUERY STRING, bukan hash. Begitu
    // createClient() jalan, SDK (detectSessionInUrl) langsung menukar code
    // itu jadi SESI PENUH sebagai bagian inisialisasi internal — proses ini
    // terjadi SEBELUM event PASSWORD_RECOVERY sempat di-fire ke listener kita.
    // Makanya passwordRecoveryMode HARUS sudah true di sini, SEBELUM
    // initSupabase()/createClient() di bawah dipanggil, supaya begitu SDK
    // selesai bikin sesi (dari hash ATAU query), guard di enterAppAfterAuth()
    // sudah aktif dan menahan dashboard.
    const authHash = location.hash;
    const authQuery = new URLSearchParams(location.search);
    // Defensif: kalau ada "code" param tapi tanpa penanda type=recovery
    // eksplisit, tetap jangan langsung dianggap aman — treat sebagai
    // recovery juga. Lebih baik false-positive (user login biasa diminta
    // buat password baru & dituntun keluar dari form itu) daripada
    // false-negative (pemegang link reset dapat akses penuh ke toko orang).
    const isRecoveryLink = authHash.includes('type=recovery')
      || authQuery.get('type') === 'recovery'
      || authQuery.has('code');
    if (isRecoveryLink) {
      passwordRecoveryMode = true;
    }
    // Sinyal lebih luas dari isRecoveryLink: apapun bentuknya, kalau URL
    // membawa serpihan hasil redirect auth Supabase (access_token/type di
    // hash, atau code di query), SDK sedang/baru saja memproses sesi dari
    // link itu — event PASSWORD_RECOVERY async BISA masih dalam perjalanan
    // walau heuristik isRecoveryLink di atas tidak match persis. Dipakai
    // HANYA untuk beri jendela tunggu kecil sebelum commit ke dashboard,
    // TIDAK untuk mengubah keputusan guard keamanan itu sendiri.
    const hasAuthCallbackParams = authHash.includes('access_token')
      || authHash.includes('type=')
      || authQuery.has('code');
    const linkExpired = authHash.includes('error_code=otp_expired') || authHash.includes('error=access_denied');
    if (linkExpired) {
      history.replaceState(null, '', location.pathname);
    }
    initSupabase();
    window.onerror = (msg, src, line, col, err) => {
      logError(String(msg), { src, line, col }, err);
      return false;
    };
    window.addEventListener('unhandledrejection', e => {
      logError('Unhandled promise rejection: ' + (e.reason?.message || String(e.reason)), {}, e.reason instanceof Error ? e.reason : null);
    });
    loadLocalSettings();
    bindEvents();
    initHelpChat();
    initHardwareScanner();
    registerServiceWorker();

    // Cek sesi Supabase yang masih aktif
    setLoadingStatus('Memeriksa sesi...', 20);
    const session = await getAuthSession();

    // Baru simpan uid recovery SETELAH sesi benar-benar terbentuk (bukan
    // sebelum tahu siapa usernya) — link recovery load ini berarti SDK sudah
    // selesai exchange code jadi sesi di titik ini.
    if (isRecoveryLink && session?.user?.id) {
      localStorage.setItem('pw_recovery_uid', session.user.id);
    }
    // Guard berbasis USER ID, bukan flag generik: HANYA aktif kalau ADA
    // flag tercatat DAN ADA sesi aktif SEKARANG yang usernya SAMA PERSIS.
    // Ini otomatis menutup kasus cross-tab (user lain, uid beda -> tidak
    // match -> tidak ikut terkunci) dan kasus setelah signOut sukses (sesi
    // null di semua tab origin ini -> guard tidak pernah terpicu lagi
    // walau ada sisa flag).
    const recoveryUid = localStorage.getItem('pw_recovery_uid');
    if (recoveryUid && session?.user?.id === recoveryUid) {
      passwordRecoveryMode = true;
    }

    if (passwordRecoveryMode) {
      showNewPasswordForm();
    } else if (session) {
      state.authUser = session.user;
      // Jendela tunggu kecil HANYA kalau URL menunjukkan kita baru datang
      // dari redirect auth (link recovery/PKCE) — supaya event
      // PASSWORD_RECOVERY yang sedang diproses SDK (round-trip jaringan)
      // sempat fire dan set passwordRecoveryMode SEBELUM kita commit ke
      // dashboard. Login normal (tanpa hash/query auth) tidak kena delay ini.
      if (hasAuthCallbackParams) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (passwordRecoveryMode) {
        showNewPasswordForm();
      } else {
        await enterAppAfterAuth();
        hideLoadingOverlay();
      }
    } else {
      hideLoadingOverlay();
      showLoginPage();
      if (linkExpired) {
        const authError2 = document.getElementById('authError');
        if (authError2) {
          authError2.textContent = 'Link reset sudah kedaluwarsa. Kirim ulang dari menu Lupa Password.';
          authError2.classList.remove('hidden');
        }
      }
    }
  };

  return { init };
})();

window.addEventListener('DOMContentLoaded', App.init);
