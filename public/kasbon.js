var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class KasbonModule {
    static init() {
        // Expose to window for HTML event handlers
        window.addDebtItemRow = KasbonModule.addDebtItemRow;
        window.removeDebtItemRow = KasbonModule.removeDebtItemRow;
        window.updateDebtItemPrice = KasbonModule.updateDebtItemPrice;
        window.calculateDebtTotal = KasbonModule.calculateDebtTotal;
        window.saveDebt = KasbonModule.saveDebt;
        window.markDebtPaid = KasbonModule.markDebtPaid;
        window.deleteDebt = KasbonModule.deleteDebt;
        window.sendDebtWA = KasbonModule.sendDebtWA;
        window.renderKasbon = KasbonModule.renderKasbon;
        window.openDebtModal = KasbonModule.openDebtModal;
        window.closeDebtModal = KasbonModule.closeDebtModal;
    }
    static openDebtModal() {
        KasirApp.state.currentDebtItems = [];
        KasirApp.dom.debtForm.reset();
        KasirApp.dom.debtItemsContainer.innerHTML = '';
        KasirApp.dom.debtFormError.classList.add('hidden');
        KasbonModule.addDebtItemRow();
        KasbonModule.calculateDebtTotal();
        KasirApp.dom.debtModal.classList.remove('hidden');
    }
    static closeDebtModal() {
        KasirApp.dom.debtModal.classList.add('hidden');
        KasirApp.state.currentDebtItems = [];
    }
    static addDebtItemRow() {
        const container = KasirApp.dom.debtItemsContainer;
        const rowId = 'debtRow_' + Date.now() + Math.random().toString(36).substr(2, 5);
        const div = document.createElement('div');
        div.className = 'flex gap-2 mb-2 items-center debt-item-row';
        div.id = rowId;
        const productOptions = KasirApp.state.products && KasirApp.state.products.length > 0
            ? KasirApp.state.products.map((p) => `
              <option value="${KasirApp.esc(String(p.id))}" data-price="${p.price}" data-name="${KasirApp.esc(p.name)}">
                ${KasirApp.esc(p.name)} - ${KasirApp.formatCurrency(p.price)}
              </option>
            `).join('')
            : '<option value="">(Kosong)</option>';
        div.innerHTML = `
            <div class="w-[45%]">
                <select class="w-full rounded-xl border border-slate-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none dark:bg-slate-700 dark:text-white dark:border-slate-600 debt-product-select" onchange="updateDebtItemPrice(this, '${rowId}')">
                    <option value="" disabled selected>Pilih Produk</option>
                    ${productOptions}
                </select>
            </div>
            <div class="w-[20%]">
                <input type="number" min="1" value="1" class="w-full rounded-xl border border-slate-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none dark:bg-slate-700 dark:text-white dark:border-slate-600 debt-qty-input" oninput="calculateDebtTotal()">
            </div>
            <div class="w-[25%]">
                 <input type="text" class="w-full rounded-xl border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-500 dark:bg-slate-700 dark:text-white dark:border-slate-600" readonly value="0">
            </div>
            <div class="w-[10%] flex justify-end">
                 <button type="button" class="rounded-xl bg-rose-100 text-rose-600 px-3 py-1.5 hover:bg-rose-200 transition font-bold" onclick="removeDebtItemRow('${rowId}')">✕</button>
            </div>
        `;
        container.appendChild(div);
        KasbonModule.calculateDebtTotal();
    }
    static removeDebtItemRow(rowId) {
        const row = document.getElementById(rowId);
        if (row) {
            row.remove();
            KasbonModule.calculateDebtTotal();
        }
    }
    static updateDebtItemPrice(selectEl, rowId) {
        const row = document.getElementById(rowId);
        if (!row)
            return;
        const option = selectEl.options[selectEl.selectedIndex];
        const price = parseFloat(option.getAttribute('data-price') || '0');
        const subtotalInput = row.querySelectorAll('input[type="text"]')[0];
        const qtyInput = row.querySelectorAll('input[type="number"]')[0];
        const qty = parseInt(qtyInput.value) || 1;
        if (subtotalInput) {
            subtotalInput.value = KasirApp.formatCurrency(price * qty);
        }
        KasbonModule.calculateDebtTotal();
    }
    static calculateDebtTotal() {
        const container = KasirApp.dom.debtItemsContainer;
        if (!container)
            return;
        const rows = container.querySelectorAll('.debt-item-row');
        let total = 0;
        KasirApp.state.currentDebtItems = [];
        rows.forEach((row) => {
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
                    subtotalInput.value = KasirApp.formatCurrency(subtotal);
                    KasirApp.state.currentDebtItems.push({
                        product_id: id,
                        product_name: name,
                        qty: qty,
                        price: price
                    });
                }
            }
        });
        KasirApp.dom.debtFormAmount.value = total;
        KasirApp.dom.debtFormAmountLabel.textContent = KasirApp.formatCurrency(total);
    }
    static saveDebt(e) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (e)
                e.preventDefault();
            const name = KasirApp.dom.debtFormName.value.trim();
            const phone = KasirApp.dom.debtFormPhone.value.trim();
            const note = KasirApp.dom.debtFormNote.value.trim();
            const amount = Number(KasirApp.dom.debtFormAmount.value);
            const items = KasirApp.state.currentDebtItems;
            if (!name || !amount || amount <= 0) {
                KasirApp.dom.debtFormError.textContent = 'Nama dan total hutang wajib diisi.';
                KasirApp.dom.debtFormError.classList.remove('hidden');
                return;
            }
            if (items.length === 0) {
                KasirApp.dom.debtFormError.textContent = 'Pilih minimal satu produk.';
                KasirApp.dom.debtFormError.classList.remove('hidden');
                return;
            }
            // Validasi Stok
            for (let item of items) {
                const product = KasirApp.state.products.find((p) => p.id === item.product_id);
                if (product && product.stock < item.qty) {
                    KasirApp.dom.debtFormError.textContent = `Stok tidak cukup untuk produk ${product.name}. Tersedia: ${product.stock}`;
                    KasirApp.dom.debtFormError.classList.remove('hidden');
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
            const cashier = (_a = KasirApp.state.cashiers) === null || _a === void 0 ? void 0 : _a.find((c) => c.id === KasirApp.state.selectedCashierId);
            if (cashier)
                cashierName = cashier.name;
            if (KasirApp.db && KasirApp.state.storeId) {
                // Gunakan RPC create_debt_transaction
                const { data, error } = yield KasirApp.db.rpc('create_debt_transaction', {
                    p_store_id: KasirApp.state.storeId,
                    p_customer_name: name,
                    p_phone: phone,
                    p_amount: amount,
                    p_note: note,
                    p_items: items,
                    p_cashier_name: cashierName
                });
                if (error) {
                    console.error("Kasbon RPC error:", error);
                    // Fallback simpan lokal jika RPC gagal (misal sedang offline atau tabel belum siap)
                    record.id = 'D' + Date.now();
                }
                else {
                    record.id = data.debt_id;
                }
            }
            else {
                record.id = 'D' + Date.now();
            }
            // Kurangi stok produk secara lokal agar UI tidak perlu reload
            for (let item of items) {
                const product = KasirApp.state.products.find((p) => p.id === item.product_id);
                if (product) {
                    product.stock -= item.qty;
                }
            }
            KasirApp.state.debts = KasirApp.state.debts || [];
            KasirApp.state.debts.unshift(record);
            KasirApp.saveDebtsLocal();
            KasbonModule.closeDebtModal();
            KasbonModule.renderKasbon();
            KasirApp.renderProducts();
            alert('Kasbon berhasil disimpan! Transaksi dan stok produk telah dicatat otomatis.');
        });
    }
    static markDebtPaid(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const debt = (KasirApp.state.debts || []).find((d) => String(d.id) === String(id));
            if (!debt)
                return;
            debt.status = 'lunas';
            debt.paid_at = new Date().toISOString();
            if (KasirApp.db && !isNaN(parseInt(id))) {
                yield KasirApp.db.from('debts').update({ status: 'lunas', paid_at: debt.paid_at }).eq('id', parseInt(id));
            }
            KasirApp.saveDebtsLocal();
            KasbonModule.renderKasbon();
        });
    }
    static deleteDebt(id) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!confirm('Hapus catatan kasbon ini? Jika transaksi sudah terekam di riwayat, Anda harus menghapusnya juga di sana.'))
                return;
            KasirApp.state.debts = (KasirApp.state.debts || []).filter((d) => String(d.id) !== String(id));
            if (KasirApp.db && !isNaN(parseInt(id))) {
                yield KasirApp.db.from('debts').delete().eq('id', parseInt(id));
            }
            KasirApp.saveDebtsLocal();
            KasbonModule.renderKasbon();
        });
    }
    static sendDebtWA(id) {
        const debt = (KasirApp.state.debts || []).find((d) => String(d.id) === String(id));
        if (!debt || !debt.phone)
            return;
        const storeSettings = JSON.parse(localStorage.getItem('pos_store_settings') || '{}');
        const storeName = storeSettings.name || 'Toko Kami';
        const msg = `Halo ${debt.customer_name},\n\nIni pesan dari ${storeName}. Kami ingin menginformasikan bahwa ada catatan kasbon sebesar *${KasirApp.formatCurrency(debt.amount)}* pada tanggal ${new Date(debt.created_at).toLocaleDateString('id-ID')}.\n\nMohon konfirmasinya. Terima kasih!`;
        let phone = debt.phone.replace(/\D/g, '');
        if (phone.startsWith('0'))
            phone = '62' + phone.substring(1);
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    }
    static renderKasbon() {
        const list = document.getElementById('debtList');
        if (!list)
            return;
        const debts = KasirApp.state.debts || [];
        const searchInput = document.getElementById('debtSearchInput');
        const search = ((searchInput === null || searchInput === void 0 ? void 0 : searchInput.value) || '').toLowerCase();
        const active = debts.filter((d) => d.status !== 'lunas');
        const totalAmount = active.reduce((s, d) => s + Number(d.amount || 0), 0);
        const elTotal = document.getElementById('debtTotalAmount');
        const elCount = document.getElementById('debtActiveCount');
        if (elTotal)
            elTotal.textContent = KasirApp.formatCurrency(totalAmount);
        if (elCount)
            elCount.textContent = active.length.toString();
        const filtered = debts.filter((d) => !search || (d.customer_name || '').toLowerCase().includes(search));
        const sorted = [...filtered.filter((d) => d.status !== 'lunas'), ...filtered.filter((d) => d.status === 'lunas').slice(0, 20)];
        list.innerHTML = sorted.map((d) => {
            const isPaid = d.status === 'lunas';
            const date = new Date(d.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
            let itemsHtml = '';
            if (d.items && Array.isArray(d.items) && d.items.length > 0) {
                itemsHtml = `<div class="text-xs text-slate-500 mt-1">${d.items.map((i) => `${i.product_name} (${i.qty}x)`).join(', ')}</div>`;
            }
            const tagBtn = (!isPaid && d.phone) ? `<button data-debt-wa="${KasirApp.esc(String(d.id))}" class="flex-1 rounded-2xl bg-green-600 px-3 py-2 text-xs text-white font-semibold hover:bg-green-700 transition">💬 Tagih</button>` : '';
            return `
                <div class="rounded-3xl bg-white border ${isPaid ? 'border-slate-200 opacity-60' : 'border-amber-200'} shadow-sm p-5 space-y-3">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <p class="font-semibold text-slate-900 truncate">${KasirApp.esc(d.customer_name)}</p>
                            <p class="text-xs text-slate-400">${date}${d.note ? ' — ' + KasirApp.esc(d.note) : ''}</p>
                            ${itemsHtml}
                        </div>
                        <span class="rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${isPaid ? '✅ Lunas' : 'Belum lunas'}</span>
                    </div>
                    <p class="text-2xl font-bold ${isPaid ? 'text-slate-400 line-through' : 'text-rose-600'}">${KasirApp.formatCurrency(d.amount)}</p>
                    <div class="flex gap-2">
                        ${tagBtn}
                        ${!isPaid ? `<button data-debt-paid="${KasirApp.esc(String(d.id))}" class="flex-1 rounded-2xl bg-sky-600 px-3 py-2 text-xs text-white font-semibold hover:bg-sky-700 transition">✅ Tandai Lunas</button>` : ''}
                        <button data-debt-delete="${KasirApp.esc(String(d.id))}" class="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 hover:bg-rose-100 transition">🗑</button>
                    </div>
                </div>`;
        }).join('') || '<div class="col-span-full rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">Belum ada catatan kasbon. Klik "+ Catat Kasbon" untuk mulai.</div>';
        list.querySelectorAll('[data-debt-paid]').forEach((btn) => btn.addEventListener('click', () => KasbonModule.markDebtPaid(btn.dataset.debtPaid)));
        list.querySelectorAll('[data-debt-delete]').forEach((btn) => btn.addEventListener('click', () => KasbonModule.deleteDebt(btn.dataset.debtDelete)));
        list.querySelectorAll('[data-debt-wa]').forEach((btn) => btn.addEventListener('click', () => KasbonModule.sendDebtWA(btn.dataset.debtWa)));
    }
}
KasbonModule.init();
