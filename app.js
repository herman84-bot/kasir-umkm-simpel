const App = (() => {
  const STORAGE = {
    products: 'pos_products',
    transactions: 'pos_transactions',
    cashiers: 'pos_cashiers',
    purchases: 'pos_purchases',
    settings: 'pos_settings'
  };

  // ── Supabase ──────────────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://drhdlwtorgszmmeoekii.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyaGRsd3Rvcmdzem1tZW9la2lpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjE0MjcsImV4cCI6MjA5NDgzNzQyN30.M4VRA3U_ybL76I8qxnEAEbhVA8Iqy3eK6ABrar00blU';
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
    image: 'https://via.placeholder.com/260?text=' + encodeURIComponent(p.name)
  });

  // Supabase row → app cashier object
  const fromDbCashier = c => ({
    id: String(c.id),
    name: c.name,
    password: c.password || '1234'
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
    discount: 0,
    tax: 0,
    total: Number(tx.total_amount),
    cash: Number(tx.payment_amount),
    change: Number(tx.change_amount)
  });

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
    scannerContext: 'kasir'
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
    addCashierButton: document.getElementById('addCashierButton'),
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
    receiptItems: document.getElementById('receiptItems'),
    receiptSubtotal: document.getElementById('receiptSubtotal'),
    receiptDiscount: document.getElementById('receiptDiscount'),
    receiptTax: document.getElementById('receiptTax'),
    receiptTotal: document.getElementById('receiptTotal'),
    receiptCash: document.getElementById('receiptCash'),
    receiptChange: document.getElementById('receiptChange')
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

  const loadData = async () => {
    loadLocalSettings();

    if (!db) {
      // Fallback: localStorage only
      const productsData = localStorage.getItem(STORAGE.products);
      const historyData = localStorage.getItem(STORAGE.transactions);
      state.products = productsData ? JSON.parse(productsData) : sampleProducts;
      state.transactions = historyData ? JSON.parse(historyData) : [];
      syncStorage();
      return;
    }

    try {
      setLoadingStatus('Memuat data produk...', 30);
      const { data: products, error: pErr } = await db
        .from('products').select('*').order('id', { ascending: true });
      if (pErr) throw pErr;
      state.products = products && products.length > 0
        ? products.map(fromDbProduct) : sampleProducts;

      setLoadingStatus('Memuat kasir...', 50);
      const { data: cashiers, error: cErr } = await db
        .from('cashiers').select('*').order('id', { ascending: true });
      if (!cErr && cashiers && cashiers.length > 0) {
        state.cashiers = cashiers.map(fromDbCashier);
        const settingsData = localStorage.getItem(STORAGE.settings);
        const settings = settingsData ? JSON.parse(settingsData) : {};
        state.selectedCashierId = settings.selectedCashierId || state.cashiers[0]?.id || '';
        state.activeUserId = settings.activeUserId || state.selectedCashierId;
      } else {
        // Seed sample cashiers if table is empty
        for (const c of sampleCashiers) {
          await db.from('cashiers').insert({ name: c.name, password: c.password }).select().single();
        }
        const { data: seeded } = await db.from('cashiers').select('*').order('id');
        state.cashiers = seeded ? seeded.map(fromDbCashier) : sampleCashiers;
        state.selectedCashierId = state.cashiers[0]?.id || '';
        state.activeUserId = state.selectedCashierId;
      }

      setLoadingStatus('Memuat transaksi...', 65);
      const { data: transactions, error: tErr } = await db
        .from('transactions').select('*, transaction_items(*)')
        .order('created_at', { ascending: false }).limit(500);
      if (tErr) throw tErr;
      state.transactions = transactions ? transactions.map(fromDbTransaction) : [];

      setLoadingStatus('Memuat pembelian...', 85);
      const { data: purchases, error: puErr } = await db
        .from('purchases').select('*, purchase_items(*)')
        .order('created_at', { ascending: false });
      if (!puErr && purchases) {
        state.purchases = purchases.map(fromDbPurchase);
      }

      setLoadingStatus('Siap!', 100);
    } catch (err) {
      console.warn('Supabase error, fallback to localStorage:', err);
      const productsData = localStorage.getItem(STORAGE.products);
      const historyData = localStorage.getItem(STORAGE.transactions);
      const cashiersData = localStorage.getItem(STORAGE.cashiers);
      const purchasesData = localStorage.getItem(STORAGE.purchases);
      state.products = productsData ? JSON.parse(productsData) : sampleProducts;
      state.transactions = historyData ? JSON.parse(historyData) : [];
      state.cashiers = cashiersData ? JSON.parse(cashiersData) : sampleCashiers;
      state.purchases = purchasesData ? JSON.parse(purchasesData) : [];
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
    dom.themeToggle.textContent = state.darkMode ? 'Light Mode' : 'Dark Mode';
  };

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

    const lowStockProducts = state.products.filter(product => product.stock > 0 && product.stock <= 5);
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

  const startBarcodeScanner = () => {
    if (!navigator.mediaDevices || !Quagga) {
      dom.scannerStatus.textContent = 'Scanner tidak tersedia di perangkat ini.';
      return;
    }
    dom.scannerStatus.textContent = 'Membuka kamera...';
    dom.scannerResult.classList.add('hidden');
    dom.scannerNotFound.classList.add('hidden');
    Quagga.init({
      inputStream: {
        type: 'LiveStream',
        target: dom.scannerArea,
        constraints: { facingMode: 'environment' }
      },
      decoder: { readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader'] },
      locate: true
    }, err => {
      if (err) {
        dom.scannerStatus.textContent = 'Gagal membuka kamera: ' + (err.message || err);
        return;
      }
      Quagga.start();
      dom.scannerStatus.textContent = 'Mencari barcode... arahkan kamera ke barcode.';
    });
    Quagga.onDetected(result => {
      const code = result.codeResult.code;
      handleScannedCode(code);
      stopBarcodeScanner();
    });
  };

  const stopBarcodeScanner = () => {
    try {
      if (Quagga) {
        Quagga.stop();
        Quagga.offDetected();
      }
    } catch (e) { /* ignore */ }
    dom.scannerStatus.textContent = 'Scanner dihentikan.';
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
    const tax = Math.round(taxable * 0.11);
    const total = Math.max(0, taxable + tax);
    const cash = Math.max(0, Number(state.cashAmount) || 0);
    const change = Math.max(0, cash - total);
    return { subtotal, discount, tax, total, cash, change };
  };

  const updateDashboard = () => {
    const today = new Date().toISOString().slice(0, 10);
    const todayTransactions = state.transactions.filter(tx => tx.date.slice(0, 10) === today);
    const totalSalesToday = todayTransactions.reduce((sum, tx) => sum + tx.total, 0);
    const totalProductsSold = state.transactions.reduce((sum, tx) => sum + tx.items.reduce((qtySum, item) => qtySum + item.qty, 0), 0);
    const totalProfit = state.transactions.reduce((sum, tx) => sum + tx.items.reduce((itemSum, item) => itemSum + item.qty * (item.price - item.cost), 0) - tx.tax, 0);

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
      const isCritical = product.stock <= 5;
      return `
        <article data-id="${product.id}" class="group cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
          <img src="${product.image}" alt="${product.name}" class="h-44 w-full object-cover" />
          <div class="p-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h4 class="text-lg font-semibold">${product.name}</h4>
                <p class="text-slate-500 text-sm">${product.category}</p>
              </div>
              <span class="rounded-2xl bg-slate-100 px-3 py-1 text-xs text-slate-700">Stok: ${product.stock}</span>
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
    dom.discountPercent.value = state.discountPercent;
    dom.discountNominal.value = state.discountNominal;
    dom.cashInput.value = state.cashAmount;
  };

  const renderInventory = () => {
    dom.inventoryTable.innerHTML = state.products.map(product => {
      const criticalClass = product.stock <= 5 ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800';
      return `
        <tr class="border-b border-slate-200">
          <td class="p-3 font-semibold">${product.code}</td>
          <td class="p-3">${product.name}</td>
          <td class="p-3 text-xs text-slate-500 font-mono">${product.barcode || '-'}</td>
          <td class="p-3">${product.category}</td>
          <td class="p-3">${formatCurrency(product.price)}</td>
          <td class="p-3"><span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold ${criticalClass}">${product.stock}</span></td>
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
          <td class="p-3">${formatCurrency(tx.cash)}</td>
          <td class="p-3">${formatCurrency(tx.change)}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="7" class="p-8 text-center text-slate-500">Belum ada transaksi.</td></tr>';
  };

  const showScreen = screenId => {
    dom.screens.forEach(screen => {
      screen.classList.toggle('hidden', screen.id !== screenId);
    });
    dom.menuButtons.forEach(button => {
      button.classList.toggle('bg-slate-700', button.dataset.screen === screenId);
      button.classList.toggle('text-white', button.dataset.screen === screenId);
    });
  };

  const showInventoryModal = (title = 'Tambah Produk') => {
    dom.inventoryModalTitle.textContent = title;
    dom.inventoryModal.classList.remove('hidden');
  };

  const hideInventoryModal = () => {
    dom.inventoryModal.classList.add('hidden');
    dom.inventoryForm.reset();
    dom.productId.value = '';
    dom.productImage.value = 'https://via.placeholder.com/200';
  };

  const openInventoryModal = productId => {
    if (!productId) {
      dom.productBarcode.value = '';
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
    dom.productImage.value = product.image;
    dom.productBarcode.value = product.barcode || '';
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

  const saveProduct = async event => {
    event.preventDefault();
    const existingId = dom.productId.value;
    const dbPayload = {
      name: dom.productName.value.trim(),
      barcode: dom.productBarcode.value.trim() || null,
      category: dom.productCategory.value,
      price: Number(dom.productPrice.value) || 0,
      cost: Number(dom.productCost.value) || 0,
      stock: Number(dom.productStock.value) || 0
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
        const { data, error } = await db.from('products').insert(dbPayload).select().single();
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
    if (totals.cash < totals.total) {
      alert('Jumlah tunai belum cukup. Mohon masukkan nominal yang sesuai.');
      return;
    }

    const cashier = getSelectedCashier();
    let invoiceId = `INV${Date.now()}`;

    if (db) {
      try {
        // Insert transaction header
        const { data: tx, error: txErr } = await db.from('transactions').insert({
          cashier_name: cashier.name,
          total_amount: totals.total,
          payment_amount: totals.cash,
          change_amount: totals.change
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
      change: totals.change
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
    alert('Transaksi berhasil disimpan. Anda dapat mencetak struk sekarang.');
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
    dom.receiptModal.classList.remove('hidden');
  };

  const populateReceipt = (data) => {
    dom.receiptDate.textContent = new Date(data.date).toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    dom.receiptItems.innerHTML = data.items.map(item => `
      <tr>
        <td class="py-2">${item.name}</td>
        <td class="py-2">${item.qty}</td>
        <td class="py-2">${formatCurrency(item.price * item.qty)}</td>
      </tr>
    `).join('');
    dom.receiptSubtotal.textContent = formatCurrency(data.subtotal);
    dom.receiptDiscount.textContent = formatCurrency(data.discount);
    dom.receiptTax.textContent = formatCurrency(data.tax);
    dom.receiptTotal.textContent = formatCurrency(data.total);
    dom.receiptCash.textContent = formatCurrency(data.cash);
    dom.receiptChange.textContent = formatCurrency(data.change);
  };

  const closeReceipt = () => {
    dom.receiptModal.classList.add('hidden');
  };

  const bindEvents = () => {
    dom.menuButtons.forEach(button => {
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
      state.selectedCashierId = event.target.value;
      syncStorage();
    });

    dom.addCashierButton.addEventListener('click', async () => {
      const cashierName = prompt('Masukkan nama kasir baru:');
      if (!cashierName) return;
      const cashierPassword = prompt('Masukkan password kasir (default: 1234):') || '1234';
      let newCashier = { id: `C${Date.now()}`, name: cashierName.trim(), password: cashierPassword };
      if (db) {
        const { data, error } = await db.from('cashiers')
          .insert({ name: cashierName.trim(), password: cashierPassword })
          .select().single();
        if (error) { alert('Gagal tambah kasir: ' + error.message); return; }
        newCashier = fromDbCashier(data);
      }
      state.cashiers.push(newCashier);
      state.selectedCashierId = newCashier.id;
      renderCashierSelect();
      syncStorage();
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
  };

  const renderAll = () => {
    dom.todayDate.textContent = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
    renderCashierSelect();
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

  const init = async () => {
    setLoadingStatus('Menghubungkan ke database...', 10);
    initSupabase();
    setLoadingStatus('Memuat data...', 25);
    await loadData();
    bindEvents();
    showScreen('dashboard');
    renderAll();
    registerServiceWorker();
    hideLoadingOverlay();
  };

  return { init };
})();

window.addEventListener('DOMContentLoaded', App.init);
