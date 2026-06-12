const App = (() => {
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
    }
    return {};
  };

  const getQrisImage = () => localStorage.getItem('qris_image') || '';

  // ── Langganan / masa aktif ────────────────────────────────────────────────
  const SUBS_QRIS_PAYLOAD = '00020101021126570011ID.DANA.WWW011893600915303246671402090324667140303UMI51440014ID.CO.QRIS.WWW0215ID10265311627370303UMI5204899953033605802ID5916Absenta solution6014Kota Tangerang6105151166304797';
  const SUBS_EMAIL = 'noreply.absenta@gmail.com';

  // Hitung sisa hari masa aktif (trial atau premium, ambil yang paling lama)
  const getSubscriptionDaysLeft = () => {
    const s = state.store;
    if (!s) return null; // belum ada data toko → jangan blokir
    const candidates = [s.trial_ends_at, s.premium_until]
      .filter(Boolean).map(d => new Date(d).getTime());
    // Kolom belum ada (SQL belum dijalankan) → fallback 30 hari dari created_at
    if (!candidates.length) {
      if (!s.created_at) return null;
      candidates.push(new Date(s.created_at).getTime() + 30 * 24 * 3600 * 1000);
    }
    const expiry = Math.max(...candidates);
    return Math.ceil((expiry - Date.now()) / (24 * 3600 * 1000));
  };

  const renderSubsQr = () => {
    const el = document.getElementById('subsQrCode');
    if (!el || el.dataset.rendered) return;
    el.innerHTML = '';
    if (window.QRCode) {
      new QRCode(el, { text: SUBS_QRIS_PAYLOAD, width: 192, height: 192, correctLevel: QRCode.CorrectLevel.M });
      el.dataset.rendered = '1';
    } else {
      el.textContent = 'Gagal memuat QR. Periksa koneksi internet.';
    }
  };

  const showSubsOverlay = () => {
    const overlay = document.getElementById('subsOverlay');
    if (!overlay) return;
    renderSubsQr();
    const emailBtn = document.getElementById('subsEmailBtn');
    if (emailBtn) {
      const subject = encodeURIComponent('Konfirmasi Pembayaran Langganan Kasir UMKM Simpel');
      const body = encodeURIComponent(`Halo, saya sudah membayar langganan Kasir UMKM Simpel.\n\nEmail akun: ${state.authUser?.email || '-'}\nNama toko: ${state.store?.name || '-'}\n\n(Lampirkan screenshot bukti pembayaran di email ini)`);
      emailBtn.href = `mailto:${SUBS_EMAIL}?subject=${subject}&body=${body}`;
    }
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  };

  const hideSubsOverlay = () => {
    const overlay = document.getElementById('subsOverlay');
    if (overlay) { overlay.classList.add('hidden'); overlay.style.display = ''; }
  };

  // Banner peringatan hanya muncul saat sisa ≤ 7 hari (sebelum itu terasa gratis penuh)
  const checkSubscription = () => {
    const daysLeft = getSubscriptionDaysLeft();
    const banner = document.getElementById('subsBanner');
    if (daysLeft === null) return true;
    if (daysLeft <= 0) { showSubsOverlay(); return false; }
    if (banner && daysLeft <= 7) {
      document.getElementById('subsBannerText').textContent =
        `Masa aktif toko Anda tersisa ${daysLeft} hari.`;
      banner.classList.remove('hidden');
      document.body.style.paddingTop = '36px';
    }
    return true;
  };

  // ── Supabase ──────────────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://pfmsblktxlnovtajnxvc.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_rF4Ul9n6WS4R00twmmCbdQ_wJ0KAOv6';
  let db = null;

  const initSupabase = () => {
    if (window.supabase) {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      return true;
    }
    return false;
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
    paymentMethod: tx.payment_method || 'Tunai'
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
  const handleRegister = async ({ storeName, ownerName, email, password }) => {
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

    // Buat kasir admin (pemilik) — PIN default 1234
    await db.from('cashiers').insert({
      store_id: store.id, name: ownerName.trim(), password: '1234', role: 'admin'
    });

    return { user: data.user, store };
  };

  const terjemahAuthError = msg => {
    const m = (msg || '').toLowerCase();
    if (m.includes('invalid login')) return 'Email atau password salah.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'Email sudah terdaftar. Silakan masuk.';
    if (m.includes('password should be at least')) return 'Password minimal 6 karakter.';
    if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Format email tidak valid.';
    if (m.includes('email not confirmed')) return 'Email belum dikonfirmasi.';
    return msg || 'Terjadi kesalahan.';
  };

  const showLoginPage = () => {
    const lp = document.getElementById('loginPage');
    lp.classList.remove('hidden');
    lp.style.display = 'flex';
    document.getElementById('appContainer').classList.add('hidden');
    document.getElementById('appContainer').style.display = 'none';
  };

  const showApp = () => {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('loginPage').classList.add('hidden');
    const app = document.getElementById('appContainer');
    app.classList.remove('hidden');
    app.style.display = 'flex';
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
      roleEl.textContent = isAdmin ? '👑 Admin Toko' : '🧾 Kasir';
      roleEl.className = isAdmin
        ? 'text-xs px-2 py-0.5 rounded-full bg-sky-700 text-sky-100'
        : 'text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300';
    }
    if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
    // Sidebar + bottom nav: menu admin disembunyikan untuk operator kasir
    document.querySelectorAll('[data-role="admin"]').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });
    const wrapper = document.getElementById('cashierSelectWrapper');
    if (wrapper) wrapper.style.display = '';
  };

  const logout = async () => {
    if (!confirm('Yakin ingin keluar dari toko?')) return;
    if (db) await db.auth.signOut();
    state.authUser = null;
    state.store = null;
    state.storeId = null;
    state.cart = {};
    state.cashAmount = 0;
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
    darkMode: false,
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
    themeToggle: document.getElementById('themeToggle'),
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
    sendResetBtn: document.getElementById('sendResetBtn')
  };

  let chartInstance = null;

  const formatCurrency = value => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
  };

  const loadLocalSettings = () => {
    const settingsData = localStorage.getItem(STORAGE.settings);
    const settings = settingsData ? JSON.parse(settingsData) : {};
    state.darkMode = settings.darkMode || false;
    state.reportRange = settings.reportRange || '7';
    state.historySearch = settings.historySearch || '';
    // cashiers & purchases now loaded from Supabase; these are temp fallbacks
    const cashiersData = localStorage.getItem(STORAGE.cashiers);
    const purchasesData = localStorage.getItem(STORAGE.purchases);
    state.cashiers = cashiersData ? JSON.parse(cashiersData) : sampleCashiers;
    state.purchases = purchasesData ? JSON.parse(purchasesData) : [];
    state.selectedCashierId = settings.selectedCashierId || state.cashiers[0]?.id || '';
    state.activeUserId = settings.activeUserId || state.selectedCashierId;
  };

  // Memuat record toko milik user yang login
  const loadStore = async () => {
    const { data, error } = await db.from('stores').select('*').limit(1).maybeSingle();
    if (error) { console.warn('loadStore error:', error); return null; }
    if (data) {
      state.store = data;
      state.storeId = data.id;
    }
    return data;
  };

  // Memuat seluruh data toko (dipanggil SETELAH login berhasil)
  const loadData = async () => {
    loadLocalSettings();

    setLoadingStatus('Memuat data toko...', 25);
    await loadStore();
    if (!state.storeId) {
      // User login tapi belum punya toko (kasus langka) — kosongkan
      state.products = []; state.transactions = []; state.cashiers = []; state.purchases = [];
      return;
    }

    try {
      setLoadingStatus('Memuat produk...', 40);
      const { data: products, error: pErr } = await db
        .from('products').select('*').order('id', { ascending: true });
      if (pErr) throw pErr;
      state.products = products ? products.map(fromDbProduct) : [];

      setLoadingStatus('Memuat kasir...', 55);
      const { data: cashiers } = await db
        .from('cashiers').select('*').order('id', { ascending: true });
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
        .order('created_at', { ascending: false }).limit(500);
      if (tErr) throw tErr;
      state.transactions = transactions ? transactions.map(fromDbTransaction) : [];

      setLoadingStatus('Memuat pembelian...', 85);
      const { data: purchases } = await db
        .from('purchases').select('*, purchase_items(*)')
        .order('created_at', { ascending: false });
      state.purchases = purchases ? purchases.map(fromDbPurchase) : [];

      setLoadingStatus('Siap!', 100);
    } catch (err) {
      console.warn('Gagal memuat data toko:', err);
      state.products = state.products || [];
      state.transactions = state.transactions || [];
      state.cashiers = state.cashiers || [];
      state.purchases = state.purchases || [];
    }

    syncStorage();
  };

  const syncStorage = () => {
    localStorage.setItem(STORAGE.products, JSON.stringify(state.products));
    localStorage.setItem(STORAGE.transactions, JSON.stringify(state.transactions));
    localStorage.setItem(STORAGE.cashiers, JSON.stringify(state.cashiers));
    localStorage.setItem(STORAGE.purchases, JSON.stringify(state.purchases));
    localStorage.setItem(STORAGE.settings, JSON.stringify({
      darkMode: state.darkMode,
      selectedCashierId: state.selectedCashierId,
      activeUserId: state.activeUserId,
      reportRange: state.reportRange,
      historySearch: state.historySearch
    }));
  };

  const getSelectedCashier = () => {
    return state.cashiers.find(item => item.id === state.selectedCashierId) || state.cashiers[0] || { id: 'C000', name: 'Kasir' };
  };

  const renderCashierSelect = () => {
    dom.cashierSelect.innerHTML = state.cashiers.map(item => `
      <option value="${item.id}">${item.name}</option>
    `).join('');
    if (!state.cashiers.some(item => item.id === state.selectedCashierId)) {
      state.selectedCashierId = state.cashiers[0]?.id || '';
    }
    dom.cashierSelect.value = state.selectedCashierId;
  };

  const applyTheme = () => {
    document.body.classList.toggle('dark', state.darkMode);
    dom.themeToggle.textContent = state.darkMode ? '☀️ Terang' : '🌙 Tema';
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
      const initial = c.name.charAt(0).toUpperCase();
      const roleLabel = isAdmin ? '👑 Admin' : '🧾 Kasir';
      const roleBg = isAdmin ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600';
      const avatarBg = isAdmin ? 'bg-sky-600' : 'bg-slate-500';
      return `
        <div class="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-full ${avatarBg} flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">${initial}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="font-semibold text-slate-900 truncate">${c.name}</p>
                ${isSelf ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Anda</span>' : ''}
              </div>
              <span class="text-xs px-2 py-0.5 rounded-full ${roleBg} font-medium mt-1 inline-block">${roleLabel}</span>
            </div>
          </div>
          <div class="flex gap-2">
            <button data-edit-cashier="${c.id}"
              class="flex-1 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition font-medium">
              ✏️ Edit
            </button>
            <button data-delete-cashier="${c.id}" ${isSelf ? 'disabled title="Tidak bisa hapus akun sendiri"' : ''}
              class="flex-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 hover:bg-rose-100 transition font-medium ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}">
              🗑 Hapus
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
    dom.cashierModal.style.display = 'flex';
    dom.cashierFormName.focus();
  };

  const closeCashierModalFn = () => {
    dom.cashierModal.classList.add('hidden');
    dom.cashierModal.style.display = '';
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
        if (error) { showCashierError('Gagal simpan: ' + error.message); return; }
        const idx = state.cashiers.findIndex(c => c.id === id);
        if (idx >= 0) {
          state.cashiers[idx] = { ...state.cashiers[idx], name, role, ...(password ? { password } : {}) };
        }
      } else {
        // Insert
        const { data, error } = await db.from('cashiers')
          .insert({ name, password, role, store_id: state.storeId }).select().single();
        if (error) { showCashierError('Gagal tambah: ' + error.message); return; }
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
      if (error) { alert('Gagal hapus kasir: ' + error.message); return; }
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
        darkMode: state.darkMode,
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
          state.darkMode = data.settings.darkMode ?? state.darkMode;
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
    return state.transactions.filter(tx => {
      if (!query) return true;
      const content = [
        tx.id,
        tx.date,
        tx.cashier,
        tx.items.map(item => item.name).join(' '),
        tx.total,
        tx.cash,
        tx.change
      ].join(' ').toString().toLowerCase();
      return content.includes(query);
    });
  };

  const renderReportSummary = () => {
    const days = Number(state.reportRange) || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const filtered = state.transactions.filter(tx => new Date(tx.date) >= cutoff);
    const totalSales = filtered.reduce((sum, tx) => sum + tx.total, 0);
    const totalTrans = filtered.length;
    const totalItems = filtered.reduce((sum, tx) => sum + tx.items.reduce((qty, item) => qty + item.qty, 0), 0);
    dom.reportSales.textContent = formatCurrency(totalSales);
    dom.reportTransactions.textContent = totalTrans;
    dom.reportItemsSold.textContent = totalItems;

    const lowStockProducts = state.products.filter(product => product.stock >= 0 && product.stock <= (product.minStock || 5));
    dom.lowStockAlert.textContent = lowStockProducts.length ? `${lowStockProducts.length} produk stok rendah, segera kulakan lagi.` : 'Tidak ada stok kritis.';

    const bestProduct = state.products.slice().sort((a, b) => {
      const aQty = state.transactions.reduce((sum, tx) => sum + tx.items.filter(item => item.id === a.id).reduce((s, item) => s + item.qty, 0), 0);
      const bQty = state.transactions.reduce((sum, tx) => sum + tx.items.filter(item => item.id === b.id).reduce((s, item) => s + item.qty, 0), 0);
      return bQty - aQty;
    })[0];
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
    dom.purchaseTable.innerHTML = state.purchases.slice().reverse().map(order => {
      const time = new Date(order.date).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' });
      return `
        <tr class="border-b border-slate-200">
          <td class="p-3">${time}</td>
          <td class="p-3">#${order.id}</td>
          <td class="p-3">${order.supplier}</td>
          <td class="p-3 font-semibold">${formatCurrency(order.total)}</td>
          <td class="p-3">${order.items.length} produk</td>
          <td class="p-3">${order.status}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="6" class="p-8 text-center text-slate-500">Belum ada data pembelian.</td></tr>';
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

  const authenticateUser = (name, password) => {
    const user = state.cashiers.find(item => item.name.toLowerCase() === name.toLowerCase() && item.password === password);
    if (!user) return false;
    state.activeUserId = user.id;
    state.selectedCashierId = user.id;
    renderCashierSelect();
    syncStorage();
    hideLoginModal();
    // Terapkan hak akses operator baru; kasir tidak boleh tetap di layar admin
    applyRoleAccess();
    const currentScreen = document.querySelector('main section.screen:not(.hidden)')?.id;
    if (user.role !== 'admin' && ADMIN_SCREENS.includes(currentScreen)) {
      showScreen('kasir');
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
      dom.scannerStatus.textContent = `✅ Ditemukan: ${product.name}`;
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

  const startQuaggaScanner = () => {
    if (typeof Quagga === 'undefined') {
      dom.scannerStatus.textContent = 'Scanner tidak tersedia di perangkat ini. Gunakan input manual.';
      return;
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
        dom.scannerStatus.textContent = 'Gagal membuka kamera: ' + (err.message || err);
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
    if (dom.scannerStatus && !dom.scannerStatus.textContent.startsWith('✅')) {
      dom.scannerStatus.textContent = 'Scanner dihentikan.';
    }
  };

  const resetPurchaseDraft = () => {
    state.draftPurchase = { supplier: '', invoice: `PO${Date.now()}`, items: [] };
    dom.purchaseSupplier.value = '';
    dom.purchaseInvoice.value = state.draftPurchase.invoice;
    dom.purchaseQty.value = 1;
    dom.purchaseItemsList.innerHTML = '<p class="text-slate-500">Belum ada item pembelian.</p>';
    dom.purchaseTotal.textContent = formatCurrency(0);
  };

  const renderPurchaseOptions = () => {
    dom.purchaseProduct.innerHTML = state.products.map(product => `
      <option value="${product.id}">${product.name} (${product.stock} stok)</option>
    `).join('');
  };

  const renderPurchaseDraft = () => {
    if (!state.draftPurchase.items.length) {
      dom.purchaseItemsList.innerHTML = '<p class="text-slate-500">Belum ada item pembelian.</p>';
      dom.purchaseTotal.textContent = formatCurrency(0);
      return;
    }
    let total = 0;
    dom.purchaseItemsList.innerHTML = state.draftPurchase.items.map(item => {
      const subtotal = item.qty * item.price;
      total += subtotal;
      return `
        <div class="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 border border-slate-200 mb-3">
          <div>
            <p class="font-semibold">${item.name}</p>
            <p class="text-slate-500 text-sm">Qty ${item.qty} x ${formatCurrency(item.price)}</p>
          </div>
          <span class="font-semibold">${formatCurrency(subtotal)}</span>
        </div>
      `;
    }).join('');
    dom.purchaseTotal.textContent = formatCurrency(total);
  };

  const openPurchaseModal = () => {
    resetPurchaseDraft();
    renderPurchaseOptions();
    dom.purchaseModal.classList.remove('hidden');
  };

  const closePurchaseModal = () => {
    dom.purchaseModal.classList.add('hidden');
  };

  const addPurchaseItemToDraft = () => {
    const productId = dom.purchaseProduct.value;
    const qty = Number(dom.purchaseQty.value) || 1;
    const product = state.products.find(item => item.id === productId);
    if (!product) return;
    const existing = state.draftPurchase.items.find(item => item.id === productId);
    if (existing) {
      existing.qty += qty;
    } else {
      state.draftPurchase.items.push({ id: product.id, name: product.name, price: product.cost, qty });
    }
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
        alert('Gagal menyimpan pembelian: ' + err.message);
        return;
      }
    }

    state.purchases.unshift(purchase);

    // Update stock locally and in Supabase
    for (const item of state.draftPurchase.items) {
      const product = state.products.find(prod => prod.id === item.id);
      if (product) {
        product.stock += item.qty;
        if (db) {
          const numId = parseInt(product.id);
          if (!isNaN(numId)) {
            await db.from('products').update({ stock: product.stock }).eq('id', numId);
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
    const cash = Math.max(0, Number(state.cashAmount) || 0);
    const change = Math.max(0, cash - total);
    return { subtotal, discount, tax, total, cash, change };
  };

  const updateDashboard = () => {
    const today = new Date().toISOString().slice(0, 10);
    const todayTransactions = state.transactions.filter(tx => tx.date.slice(0, 10) === today);
    const totalSalesToday = todayTransactions.reduce((sum, tx) => sum + tx.total, 0);
    // Statistik dihitung dari transaksi HARI INI saja, laba pakai harga modal produk
    const productCost = id => state.products.find(p => p.id === id)?.cost || 0;
    const totalProductsSold = todayTransactions.reduce((sum, tx) => sum + tx.items.reduce((qtySum, item) => qtySum + item.qty, 0), 0);
    const totalProfit = todayTransactions.reduce((sum, tx) =>
      sum + tx.items.reduce((itemSum, item) => itemSum + item.qty * (item.price - (item.cost || productCost(item.id))), 0) - (tx.discount || 0), 0);

    dom.statSalesToday.textContent = formatCurrency(totalSalesToday);
    dom.statProductsSold.textContent = totalProductsSold;
    dom.statProfit.textContent = formatCurrency(totalProfit);
  };

  const renderSalesChart = () => {
    const dates = [];
    const amounts = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const isoDate = date.toISOString().slice(0, 10);
      dates.push(date.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' }));
      const dayTotal = state.transactions
        .filter(tx => tx.date.slice(0, 10) === isoDate)
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
        <article data-id="${product.id}" class="group cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
          <img src="${product.image}" alt="${product.name}" class="h-44 w-full object-cover" />
          <div class="p-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h4 class="text-lg font-semibold">${product.name}</h4>
                <p class="text-slate-500 text-sm">${product.category}</p>
              </div>
              <span class="rounded-2xl bg-slate-100 px-3 py-1 text-xs text-slate-700">Stok: ${product.stock}${isCritical ? ' ⚠️' : ''}</span>
            </div>
            <div class="mt-4 flex items-center justify-between">
              <span class="text-xl font-semibold text-slate-900">${formatCurrency(product.price)}</span>
              <span class="rounded-full px-3 py-1 text-xs font-semibold ${isCritical ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}">${isCritical ? 'Kritis' : 'Tersedia'}</span>
            </div>
          </div>
        </article>
      `;
    }).join('') || '<div class="col-span-full rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">Tidak ada produk sesuai filter.</div>';

    dom.productGrid.querySelectorAll('article[data-id]').forEach(card => {
      card.addEventListener('click', () => addToCart(card.dataset.id));
    });
  };

  const addToCart = productId => {
    const product = state.products.find(item => item.id === productId);
    if (!product || product.stock <= 0) return;

    if (!state.cart[productId]) {
      state.cart[productId] = { ...product, qty: 1 };
    } else {
      const nextQty = state.cart[productId].qty + 1;
      if (nextQty <= product.stock) state.cart[productId].qty = nextQty;
    }
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

    dom.cartList.innerHTML = items.length ? items.map(item => `
      <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h4 class="font-semibold text-slate-900">${item.name}</h4>
            <p class="text-slate-500 text-sm">${formatCurrency(item.price)} x ${item.qty}</p>
          </div>
          <button data-remove="${item.id}" class="rounded-full bg-rose-100 px-3 py-2 text-rose-700">Hapus</button>
        </div>
        <div class="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <button data-decrease="${item.id}" class="rounded-2xl border border-slate-300 bg-white px-3 py-2">−</button>
          <span class="font-semibold">${item.qty}</span>
          <button data-increase="${item.id}" class="rounded-2xl border border-slate-300 bg-white px-3 py-2">+</button>
          <span class="ml-auto font-semibold text-slate-900">${formatCurrency(item.price * item.qty)}</span>
        </div>
      </div>
    `).join('') : '<div class="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">Keranjang kosong. Tambahkan produk untuk memulai transaksi.</div>';

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
  };

  const renderInventory = () => {
    // Update filter kategori dari data produk yang ada
    const cats = ['All', ...new Set(state.products.map(p => p.category).filter(Boolean))];
    const currentCat = dom.categoryFilter.value;
    dom.categoryFilter.innerHTML = cats.map(c =>
      `<option value="${c}"${c === currentCat ? ' selected' : ''}>${c === 'All' ? 'Semua Kategori' : c}</option>`
    ).join('');

    dom.inventoryTable.innerHTML = state.products.map(product => {
      const isLowStock = product.stock <= (product.minStock || 5);
      const criticalClass = isLowStock ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800';
      const rowClass = isLowStock ? 'border-b border-rose-200 bg-rose-50/30' : 'border-b border-slate-200';
      return `
        <tr class="${rowClass}">
          <td class="p-3 font-semibold">${product.code}</td>
          <td class="p-3">${product.name}${isLowStock ? ' <span class="text-rose-500 text-xs font-bold">⚠ Stok Rendah</span>' : ''}</td>
          <td class="p-3 text-xs text-slate-500 font-mono">${product.barcode || '-'}</td>
          <td class="p-3">${product.category}</td>
          <td class="p-3">${formatCurrency(product.price)}</td>
          <td class="p-3"><span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold ${criticalClass}">${product.stock} / min ${product.minStock || 5}</span></td>
          <td class="p-3 space-x-2">
            <button data-edit="${product.id}" class="rounded-2xl bg-slate-900 px-4 py-2 text-white text-sm">Edit</button>
            <button data-delete="${product.id}" class="rounded-2xl bg-rose-600 px-4 py-2 text-white text-sm">Hapus</button>
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
  };

  const renderHistory = () => {
    const transactions = getFilteredTransactions().slice().reverse();
    dom.historyTable.innerHTML = transactions.map(tx => {
      const time = new Date(tx.date).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short', year: 'numeric' });
      const productCount = tx.items.reduce((sum, item) => sum + item.qty, 0);
      return `
        <tr class="border-b border-slate-200">
          <td class="p-3">${time}</td>
          <td class="p-3">#${tx.id}</td>
          <td class="p-3">${tx.cashier || '-'}</td>
          <td class="p-3 font-semibold">${formatCurrency(tx.total)}</td>
          <td class="p-3">${productCount} item</td>
          <td class="p-3"><span class="rounded-full px-2 py-0.5 text-xs font-medium ${tx.paymentMethod === 'Tunai' ? 'bg-green-100 text-green-700' : tx.paymentMethod === 'QRIS' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}">${tx.paymentMethod || 'Tunai'}</span></td>
          <td class="p-3">${tx.paymentMethod === 'Tunai' || !tx.paymentMethod ? formatCurrency(tx.cash) : '-'}</td>
          <td class="p-3">${tx.paymentMethod === 'Tunai' || !tx.paymentMethod ? formatCurrency(tx.change) : '-'}</td>
          <td class="p-3"><button data-reprint="${tx.id}" class="rounded-2xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 transition whitespace-nowrap">🖨 Struk</button></td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="9" class="p-8 text-center text-slate-500">Belum ada transaksi.</td></tr>';

    // Cetak ulang struk dari riwayat
    dom.historyTable.querySelectorAll('[data-reprint]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tx = state.transactions.find(t => t.id === btn.dataset.reprint);
        if (!tx) return;
        populateReceipt(tx);
        if (dom.printThermalBtn) dom.printThermalBtn._receiptData = tx;
        dom.receiptModal.classList.remove('hidden');
        dom.receiptModal.style.display = 'flex';
      });
    });
  };

  const showScreen = screenId => {
    // Operator kasir tidak boleh membuka layar khusus admin
    const activeOp = state.cashiers.find(c => c.id === state.selectedCashierId);
    if (activeOp && activeOp.role !== 'admin' && ADMIN_SCREENS.includes(screenId)) {
      screenId = 'kasir';
    }
    dom.screens.forEach(screen => {
      screen.classList.toggle('hidden', screen.id !== screenId);
    });
    dom.menuButtons.forEach(button => {
      button.classList.toggle('bg-slate-700', button.dataset.screen === screenId);
      button.classList.toggle('text-white', button.dataset.screen === screenId);
    });
    // Update bottom nav active state
    document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
      const isActive = btn.dataset.screen === screenId;
      btn.classList.toggle('text-white', isActive);
      btn.classList.toggle('text-slate-400', !isActive);
      btn.classList.toggle('bg-slate-800', isActive);
    });
    if (screenId === 'kelolaKasir') renderCashierManagement();
    if (screenId === 'pengaturan') renderSettings();
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
    showInventoryModal('Edit Produk');
  };

  const deleteProduct = async productId => {
    if (!confirm('Hapus produk ini dari inventory?')) return;
    const numId = parseInt(productId);
    if (db && !isNaN(numId)) {
      const { error } = await db.from('products').delete().eq('id', numId);
      if (error) { alert('Gagal hapus produk: ' + error.message); return; }
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
      alert('❌ Produk tembakau dan vape tidak diizinkan di aplikasi ini.');
      return;
    }
    const dbPayload = {
      name,
      barcode: dom.productBarcode.value.trim() || null,
      category,
      price: Number(dom.productPrice.value) || 0,
      cost: Number(dom.productCost.value) || 0,
      stock: Number(dom.productStock.value) || 0,
      min_stock: Number(dom.productMinStock ? dom.productMinStock.value : 5) || 5
    };

    let finalId = existingId;

    if (db) {
      const numId = parseInt(existingId);
      if (!isNaN(numId)) {
        // Update existing
        const { error } = await db.from('products').update(dbPayload).eq('id', numId);
        if (error) { alert('Gagal simpan produk: ' + error.message); return; }
      } else {
        // Insert new
        const { data, error } = await db.from('products')
          .insert({ ...dbPayload, store_id: state.storeId }).select().single();
        if (error) { alert('Gagal tambah produk: ' + error.message); return; }
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

  const handlePayment = async () => {
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
    if (state.paymentMethod === 'Tunai') {
      if (totals.cash < totals.total) {
        alert('Jumlah tunai belum cukup. Mohon masukkan nominal yang sesuai.');
        return;
      }
    } else {
      // QRIS/Transfer: nominal bayar otomatis = total, tanpa kembalian
      if (!confirm(`Pastikan pembayaran ${state.paymentMethod} sebesar ${formatCurrency(totals.total)} sudah DITERIMA (cek notifikasi/mutasi).\n\nLanjutkan simpan transaksi?`)) return;
      state.cashAmount = totals.total;
      totals.cash = totals.total;
      totals.change = 0;
    }

    const cashier = getSelectedCashier();
    let invoiceId = `INV${Date.now()}`;

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
          payment_method: state.paymentMethod || 'Tunai'
        }).select().single();
        if (txErr) throw txErr;

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

        // Update stock in Supabase
        for (const item of cartItems) {
          const numId = parseInt(item.id);
          const product = state.products.find(p => p.id === item.id);
          if (!isNaN(numId) && product) {
            const newStock = Math.max(0, product.stock - item.qty);
            await db.from('products').update({ stock: newStock }).eq('id', numId);
          }
        }
      } catch (err) {
        alert('Gagal menyimpan transaksi ke database: ' + err.message);
        return;
      }
    }

    const transaction = {
      id: invoiceId,
      date: new Date().toISOString(),
      cashier: cashier.name,
      items: cartItems.map(item => ({ id: item.id, name: item.name, qty: item.qty, price: item.price, cost: item.cost, subtotal: item.qty * item.price })),
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
      cash: totals.cash,
      change: totals.change,
      paymentMethod: state.paymentMethod || 'Tunai'
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
    dom.receiptModal.style.display = 'flex';
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
    dom.receiptModal.style.display = 'flex';
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
        <div class="flex justify-between font-medium">${item.name}<span>${formatCurrency(item.price * item.qty)}</span></div>
        <div class="text-slate-500 ml-1">${item.qty} x ${formatCurrency(item.price)}</div>
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
        <span class="item-name">${item.name}</span>
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
<p class="center big">${store.name}</p>
${store.address ? `<p class="center">${store.address}</p>` : ''}
${store.phone ? `<p class="center">Telp: ${store.phone}</p>` : ''}
<div class="separator"></div>
<div class="row"><span>No</span><span>${data.id || '-'}</span></div>
<div class="row"><span>Tgl</span><span>${new Date(data.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
<div class="row"><span>Kasir</span><span>${data.cashier || cashier.name}</span></div>
<div class="separator"></div>
${itemsHtml}
<div class="separator"></div>
<div class="row"><span>Subtotal</span><span>${formatCurrency(data.subtotal)}</span></div>
${discountHtml}${taxHtml}
<div class="separator-solid"></div>
<div class="total-row"><span>TOTAL</span><span>${formatCurrency(data.total)}</span></div>
<div class="row"><span>${data.paymentMethod || 'Tunai'}</span><span>${formatCurrency(data.cash)}</span></div>
<div class="row bold"><span>Kembali</span><span>${formatCurrency(data.change)}</span></div>
<div class="separator"></div>
<p class="footer">${store.note || 'Terima kasih!'}</p>
<br/><br/>
</body></html>`;

    const win = window.open('', '_blank', `width=300,height=500`);
    if (!win) { alert('Popup diblokir browser. Izinkan popup untuk cetak struk.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  // ── Pengaturan Toko ───────────────────────────────────────────────────────
  const renderSettings = () => {
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
  };

  // ── Feature: Export PDF Laporan ──────────────────────────────────────────
  const exportReportPDF = () => {
    const store = getStoreSettings();
    const days = Number(state.reportRange) || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const filtered = state.transactions.filter(tx => new Date(tx.date) >= cutoff);
    const totalSales = filtered.reduce((sum, tx) => sum + tx.total, 0);
    const totalTrans = filtered.length;
    const totalItems = filtered.reduce((sum, tx) => sum + tx.items.reduce((s, i) => s + i.qty, 0), 0);
    const totalProfit = filtered.reduce((sum, tx) => sum + tx.items.reduce((s, i) => s + i.qty * (i.price - i.cost), 0) - (tx.tax || 0), 0);

    const txRows = filtered.slice(0, 100).map(tx => {
      const time = new Date(tx.date).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${time}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${tx.id}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${tx.cashier || '-'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${formatCurrency(tx.total)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${tx.paymentMethod || 'Tunai'}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Laporan ${store.name}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;padding:0;margin:0}
  h1{margin:0 0 4px;font-size:20px}
  .header{background:#0f172a;color:#fff;padding:20px 24px}
  .content{padding:20px 24px}
  .stats{display:flex;gap:16px;margin:16px 0;flex-wrap:wrap}
  .stat{flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
  .stat-val{font-size:18px;font-weight:bold;color:#0f172a}
  .stat-lbl{font-size:10px;color:#64748b;text-transform:uppercase;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:#f1f5f9;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569}
  @media print{@page{size:A4;margin:15mm}}
</style></head><body>
<div class="header">
  <h1>${store.name}</h1>
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

  // ── Feature: Shift / Tutup Kasir ─────────────────────────────────────────
  const openShiftModal = () => {
    const cashier = getSelectedCashier();
    const shiftStart = state.shiftStartTime || new Date(0);
    const shiftTx = state.transactions.filter(tx => new Date(tx.date) >= shiftStart);
    const totalSales = shiftTx.reduce((sum, tx) => sum + tx.total, 0);
    const totalItems = shiftTx.reduce((sum, tx) => sum + tx.items.reduce((s, i) => s + i.qty, 0), 0);
    const startStr = shiftStart.getTime() === 0 ? 'Sejak aplikasi dibuka' :
      shiftStart.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    if (dom.shiftCashierName) dom.shiftCashierName.textContent = cashier.name;
    if (dom.shiftTxCount) dom.shiftTxCount.textContent = shiftTx.length;
    if (dom.shiftTotalSales) dom.shiftTotalSales.textContent = formatCurrency(totalSales);
    if (dom.shiftItemsSold) dom.shiftItemsSold.textContent = totalItems;
    if (dom.shiftModalSubtitle) dom.shiftModalSubtitle.textContent = `Shift dimulai: ${startStr}`;

    if (dom.shiftModal) {
      dom.shiftModal.classList.remove('hidden');
      dom.shiftModal.style.display = 'flex';
    }
  };

  const closeShiftModal = () => {
    if (dom.shiftModal) {
      dom.shiftModal.classList.add('hidden');
      dom.shiftModal.style.display = '';
    }
  };

  const printShiftReport = () => {
    const store = getStoreSettings();
    const cashier = getSelectedCashier();
    const shiftStart = state.shiftStartTime || new Date(0);
    const shiftTx = state.transactions.filter(tx => new Date(tx.date) >= shiftStart);
    const totalSales = shiftTx.reduce((sum, tx) => sum + tx.total, 0);
    const totalItems = shiftTx.reduce((sum, tx) => sum + tx.items.reduce((s, i) => s + i.qty, 0), 0);
    const thermalCSS = document.getElementById('thermalStyle').textContent;

    const txRows = shiftTx.slice(0, 50).map(tx => {
      const time = new Date(tx.date).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' });
      return `<div class="row"><span>${time} ${tx.id.slice(-6)}</span><span>${formatCurrency(tx.total)}</span></div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Laporan Shift</title>
<style>${thermalCSS}</style></head><body>
<p class="center big">${store.name}</p>
<p class="center">LAPORAN SHIFT</p>
<div class="separator"></div>
<div class="row"><span>Kasir</span><span>${cashier.name}</span></div>
<div class="row"><span>Cetak</span><span>${new Date().toLocaleString('id-ID', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>
<div class="separator"></div>
<div class="row"><span>Transaksi</span><span>${shiftTx.length}</span></div>
<div class="row"><span>Item Terjual</span><span>${totalItems}</span></div>
<div class="separator-solid"></div>
<div class="total-row"><span>TOTAL</span><span>${formatCurrency(totalSales)}</span></div>
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

  const resetShift = () => {
    if (!confirm('Tutup dan reset shift ini? Shift baru akan dimulai sekarang.')) return;
    state.shiftStartTime = new Date();
    localStorage.setItem('shift_start_' + (state.storeId || ''), state.shiftStartTime.toISOString());
    closeShiftModal();
    alert('Shift berhasil direset. Shift baru dimulai sekarang.');
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
        d.className = i === n - 1 ? 'w-2 h-2 rounded-full bg-sky-400' : 'w-2 h-2 rounded-full bg-slate-600';
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
      btn.className = `paymethod-btn flex-1 rounded-2xl border-2 px-3 py-2 text-sm font-semibold transition ${active ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300'}`;
    });
    if (dom.cashInputWrapper) {
      dom.cashInputWrapper.style.display = method === 'Tunai' ? '' : 'none';
    }
    if (method !== 'Tunai') {
      const totals = calculateCart();
      state.cashAmount = totals.total;
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
        const modalTotal = document.getElementById('qrisModalTotal');
        const qrisModal = document.getElementById('qrisModal');
        if (modalImg) modalImg.src = qrisImg;
        if (modalTotal) modalTotal.textContent = formatCurrency(totals.total);
        if (qrisModal) { qrisModal.classList.remove('hidden'); qrisModal.style.display = 'flex'; }
      } else {
        alert('Gambar QRIS belum diupload. Silakan upload di menu Pengaturan → QRIS Statis.');
        setPaymentMethod('Tunai');
        return;
      }
    }
    renderCart();
  };

  const bindEvents = () => {
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
    dom.addCashierBtn?.addEventListener('click', () => openCashierModal());
    dom.closeCashierModal?.addEventListener('click', closeCashierModalFn);
    dom.cancelCashierModal?.addEventListener('click', closeCashierModalFn);
    dom.cashierForm?.addEventListener('submit', saveCashier);
    document.getElementById('toggleCashierPassword')?.addEventListener('click', () => {
      const inp = dom.cashierFormPassword;
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    dom.themeToggle.addEventListener('click', () => {
      state.darkMode = !state.darkMode;
      applyTheme();
      syncStorage();
    });

    dom.reportRangeSelect.addEventListener('change', event => {
      state.reportRange = event.target.value;
      renderReportSummary();
      syncStorage();
    });

    dom.historySearchInput.addEventListener('input', event => {
      state.historySearch = event.target.value;
      renderHistory();
      syncStorage();
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
    dom.savePurchase.addEventListener('click', savePurchaseOrder);
    dom.exportPurchase.addEventListener('click', exportPurchasesCSV);
    dom.exportDataButton.addEventListener('click', exportAppBackup);
    dom.importDataButton.addEventListener('click', () => dom.backupFileInput.click());
    dom.backupFileInput.addEventListener('change', importAppBackup);
    dom.loginForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!authenticateUser(dom.loginName.value.trim(), dom.loginPassword.value.trim())) {
        alert('Nama atau password salah. Coba lagi.');
      }
    });
    dom.loginCancel.addEventListener('click', hideLoginModal);
    document.addEventListener('click', event => {
      if (event.target === dom.inventoryModal) hideInventoryModal();
      if (event.target === dom.receiptModal) closeReceipt();
      if (event.target === dom.scannerModal) closeScannerModal();
      if (event.target === dom.purchaseModal) closePurchaseModal();
      if (event.target === dom.loginModal) hideLoginModal();
    });

    // ── Login / Register (Supabase Auth) ──
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const loginForm2 = document.getElementById('loginForm2');
    const registerForm = document.getElementById('registerForm');
    const authError = document.getElementById('authError');
    const authSuccess = document.getElementById('authSuccess');
    const logoutButton = document.getElementById('logoutButton');

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
        ? 'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold bg-white text-slate-900 shadow-sm transition'
        : 'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition';
      tabRegister.className = !onLogin
        ? 'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold bg-white text-slate-900 shadow-sm transition'
        : 'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition';
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
        password: document.getElementById('regPass').value
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
      const regStoreName2 = document.getElementById('regStoreName')?.value || 'Toko';
      await enterAppAfterAuth();
      // Show onboarding for new registrations
      if (!localStorage.getItem('onboardingDone_' + (state.storeId || ''))) {
        showOnboarding(regStoreName2);
      }
    });

    logoutButton?.addEventListener('click', logout);

    // ── Thermal print ──
    dom.printThermalBtn?.addEventListener('click', () => {
      const data = dom.printThermalBtn._receiptData;
      if (data) printThermal(data);
    });

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
      dom.saveSettingsBtn.textContent = '💾 Simpan Pengaturan';
      if (res.error) { alert('Gagal menyimpan: ' + res.error); return; }
      updateSettingsPreview(store);
      dom.settingsSaved.classList.remove('hidden');
      setTimeout(() => dom.settingsSaved.classList.add('hidden'), 2500);
    });

    // ── Langganan ──
    document.getElementById('subsBannerBtn')?.addEventListener('click', showSubsOverlay);
    document.getElementById('subsRecheckBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('subsRecheckBtn');
      btn.textContent = 'Memeriksa...';
      await loadStore();
      btn.textContent = '🔄 Saya sudah diaktifkan — cek ulang';
      const daysLeft = getSubscriptionDaysLeft();
      if (daysLeft !== null && daysLeft > 0) {
        hideSubsOverlay();
        const banner = document.getElementById('subsBanner');
        if (banner) { banner.classList.add('hidden'); document.body.style.paddingTop = ''; }
        await enterAppAfterAuth();
      } else {
        alert('Belum aktif. Jika sudah membayar, tunggu konfirmasi admin (maks. 1×24 jam).');
      }
    });
    document.getElementById('subsLogoutBtn')?.addEventListener('click', () => {
      hideSubsOverlay();
      logout();
    });

    // ── QRIS file upload ──
    document.getElementById('qrisFileInput')?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { alert('File harus berupa gambar.'); return; }
      if (file.size > 2 * 1024 * 1024) { alert('Ukuran gambar maksimal 2MB.'); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        const base64 = ev.target.result;
        localStorage.setItem('qris_image', base64);
        const wrapper = document.getElementById('qrisPreviewWrapper');
        const previewImg = document.getElementById('qrisPreviewImg');
        if (previewImg) previewImg.src = base64;
        if (wrapper) wrapper.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('qrisDeleteBtn')?.addEventListener('click', () => {
      if (!confirm('Hapus gambar QRIS?')) return;
      localStorage.removeItem('qris_image');
      const wrapper = document.getElementById('qrisPreviewWrapper');
      const fileInput = document.getElementById('qrisFileInput');
      if (wrapper) wrapper.classList.add('hidden');
      if (fileInput) fileInput.value = '';
    });
    // ── QRIS modal ──
    document.getElementById('closeQrisModal')?.addEventListener('click', () => {
      const m = document.getElementById('qrisModal');
      if (m) { m.classList.add('hidden'); m.style.display = ''; }
      setPaymentMethod('Tunai');
    });
    document.getElementById('qrisConfirmBtn')?.addEventListener('click', () => {
      const m = document.getElementById('qrisModal');
      if (m) { m.classList.add('hidden'); m.style.display = ''; }
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
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
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

    // ── Feature 5: Shift / Tutup Kasir ──
    dom.tutupKasirBtn?.addEventListener('click', openShiftModal);
    dom.closeShiftModal?.addEventListener('click', closeShiftModal);
    dom.cancelShiftModal?.addEventListener('click', closeShiftModal);
    dom.printShiftBtn?.addEventListener('click', printShiftReport);
    dom.resetShiftBtn?.addEventListener('click', resetShift);
    document.addEventListener('click', e => {
      if (e.target === dom.shiftModal) closeShiftModal();
    });

    // ── Feature 4: Export PDF ──
    dom.exportPdfBtn?.addEventListener('click', exportReportPDF);

    // ── Feature 6: Payment Method ──
    document.querySelectorAll('.paymethod-btn').forEach(btn => {
      btn.addEventListener('click', () => setPaymentMethod(btn.dataset.paymethod));
    });

    // ── Feature 7: Onboarding ──
    bindOnboarding();
  };

  const renderAll = () => {
    dom.todayDate.textContent = '📅 ' + new Date().toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    renderCashierSelect();
    renderCashierManagement();
    applyTheme();
    dom.reportRangeSelect.value = state.reportRange;
    dom.historySearchInput.value = state.historySearch;
    renderProducts();
    renderCart();
    renderInventory();
    renderHistory();
    updateDashboard();
    renderSalesChart();
    renderReportSummary();
  };

  const registerServiceWorker = () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js')
        .then(() => console.log('Service worker terdaftar.'))
        .catch(err => console.warn('Gagal daftar service worker:', err));
    }
  };

  // Dipanggil setelah login/daftar berhasil ATAU saat sesi masih aktif
  const enterAppAfterAuth = async () => {
    await loadData();

    // Pengaman: user terautentikasi tapi belum punya toko (mis. lewat konfirmasi email)
    if (db && state.authUser && !state.storeId) {
      let storeName = prompt('Selamat datang! Masukkan nama toko Anda untuk memulai:');
      storeName = (storeName || '').trim() || 'Toko Saya';
      const ownerName = prompt('Nama Anda (pemilik):') || 'Pemilik';
      const { data: store, error } = await db.from('stores')
        .insert({ owner_id: state.authUser.id, name: storeName }).select().single();
      if (!error && store) {
        state.store = store;
        state.storeId = store.id;
        await db.from('cashiers').insert({
          store_id: store.id, name: ownerName.trim(), password: '1234', role: 'admin'
        });
        await loadData();
      } else if (error) {
        alert('Gagal membuat toko: ' + error.message);
      }
    }

    // Pulihkan waktu mulai shift dari penyimpanan agar tidak hilang saat reload
    if (!state.shiftStartTime) {
      const saved = localStorage.getItem('shift_start_' + (state.storeId || ''));
      state.shiftStartTime = saved ? new Date(saved) : new Date();
      if (!saved) localStorage.setItem('shift_start_' + (state.storeId || ''), state.shiftStartTime.toISOString());
    }

    // Cek masa aktif: kalau habis, tampilkan halaman perpanjangan dan jangan buka app
    if (!checkSubscription()) {
      hideLoadingOverlay();
      return;
    }

    applyRoleAccess();
    showApp();
    showScreen('dashboard');
    renderAll();
    setPaymentMethod('Tunai');
  };

  const init = async () => {
    setLoadingStatus('Menghubungkan ke database...', 10);
    initSupabase();
    loadLocalSettings();
    bindEvents();
    registerServiceWorker();

    // Cek sesi Supabase yang masih aktif
    setLoadingStatus('Memeriksa sesi...', 20);
    const session = await getAuthSession();

    if (session) {
      state.authUser = session.user;
      await enterAppAfterAuth();
      hideLoadingOverlay();
    } else {
      hideLoadingOverlay();
      showLoginPage();
    }
  };

  return { init };
})();

window.addEventListener('DOMContentLoaded', App.init);
