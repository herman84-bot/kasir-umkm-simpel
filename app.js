const App = (() => {
  const STORAGE = {
    products: 'pos_products',
    transactions: 'pos_transactions',
    cashiers: 'pos_cashiers',
    settings: 'pos_settings'
  };

  const sampleProducts = [
    { id: 'P001', code: 'P001', name: 'Nasi Goreng Spesial', category: 'Makanan', price: 22000, cost: 14000, stock: 12, image: 'https://via.placeholder.com/260?text=Nasi+Goreng' },
    { id: 'P002', code: 'P002', name: 'Es Teh Manis', category: 'Minuman', price: 8000, cost: 2500, stock: 20, image: 'https://via.placeholder.com/260?text=Es+Teh' },
    { id: 'P003', code: 'P003', name: 'Beras 5kg', category: 'Sembako', price: 65000, cost: 53000, stock: 8, image: 'https://via.placeholder.com/260?text=Beras' },
    { id: 'P004', code: 'P004', name: 'Pensil 2B', category: 'ATK', price: 1500, cost: 700, stock: 25, image: 'https://via.placeholder.com/260?text=Pensil' },
    { id: 'P005', code: 'P005', name: 'Roti Tawar', category: 'Makanan', price: 12000, cost: 7000, stock: 5, image: 'https://via.placeholder.com/260?text=Roti+Tawar' },
    { id: 'P006', code: 'P006', name: 'Mineral Water', category: 'Minuman', price: 5000, cost: 2000, stock: 30, image: 'https://via.placeholder.com/260?text=Air+Mineral' }
  ];

  const sampleCashiers = [
    { id: 'C001', name: 'Kasir A' },
    { id: 'C002', name: 'Kasir B' }
  ];

  const state = {
    products: [],
    transactions: [],
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
    darkMode: false,
    currentTransaction: null
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
    historySearchInput: document.getElementById('historySearchInput'),
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

  const loadData = () => {
    const productsData = localStorage.getItem(STORAGE.products);
    const historyData = localStorage.getItem(STORAGE.transactions);
    const cashiersData = localStorage.getItem(STORAGE.cashiers);
    const settingsData = localStorage.getItem(STORAGE.settings);

    state.products = productsData ? JSON.parse(productsData) : sampleProducts;
    state.transactions = historyData ? JSON.parse(historyData) : [];
    state.cashiers = cashiersData ? JSON.parse(cashiersData) : sampleCashiers;
    const settings = settingsData ? JSON.parse(settingsData) : {};
    state.darkMode = settings.darkMode || false;
    state.selectedCashierId = settings.selectedCashierId || state.cashiers[0]?.id || '';
    state.reportRange = settings.reportRange || '7';
    state.historySearch = settings.historySearch || '';
    syncStorage();
  };

  const syncStorage = () => {
    localStorage.setItem(STORAGE.products, JSON.stringify(state.products));
    localStorage.setItem(STORAGE.transactions, JSON.stringify(state.transactions));
    localStorage.setItem(STORAGE.cashiers, JSON.stringify(state.cashiers));
    localStorage.setItem(STORAGE.settings, JSON.stringify({
      darkMode: state.darkMode,
      selectedCashierId: state.selectedCashierId,
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
  };

  const getFilteredProducts = () => {
    return state.products.filter(product => {
      const matchesCategory = state.selectedCategory === 'All' || product.category === state.selectedCategory;
      const query = state.searchQuery.trim().toLowerCase();
      const matchesSearch = !query || product.name.toLowerCase().includes(query) || product.code.toLowerCase().includes(query);
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
    showInventoryModal('Edit Produk');
  };

  const deleteProduct = productId => {
    if (!confirm('Hapus produk ini dari inventory?')) return;
    state.products = state.products.filter(item => item.id !== productId);
    syncStorage();
    renderInventory();
    renderProducts();
  };

  const saveProduct = event => {
    event.preventDefault();
    const id = dom.productId.value || `P${Math.floor(Date.now() / 1000)}`;
    const productData = {
      id,
      code: dom.productCode.value.trim(),
      name: dom.productName.value.trim(),
      category: dom.productCategory.value,
      price: Number(dom.productPrice.value) || 0,
      cost: Number(dom.productCost.value) || 0,
      stock: Number(dom.productStock.value) || 0,
      image: dom.productImage.value.trim() || 'https://via.placeholder.com/260'
    };

    const existingIndex = state.products.findIndex(item => item.id === id);
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

  const handlePayment = () => {
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

    const invoiceId = `INV${Date.now()}`;
    const cashier = getSelectedCashier();
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

    state.transactions.push(transaction);
    state.currentTransaction = transaction;
    cartItems.forEach(item => {
      const product = state.products.find(productItem => productItem.id === item.id);
      if (product) {
        product.stock = Math.max(0, product.stock - item.qty);
      }
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

    dom.addCashierButton.addEventListener('click', () => {
      const cashierName = prompt('Masukkan nama kasir baru:');
      if (!cashierName) return;
      const newCashier = { id: `C${Date.now()}`, name: cashierName.trim() };
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
    document.addEventListener('click', event => {
      if (event.target === dom.inventoryModal) hideInventoryModal();
      if (event.target === dom.receiptModal) closeReceipt();
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

  const init = () => {
    loadData();
    bindEvents();
    showScreen('dashboard');
    renderAll();
  };

  return { init };
})();

window.addEventListener('DOMContentLoaded', App.init);
