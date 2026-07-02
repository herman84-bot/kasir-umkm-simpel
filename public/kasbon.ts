// types.d.ts
interface DebtItem {
    product_id: number;
    product_name: string;
    qty: number;
    price: number;
}

interface DebtRecord {
    id: number | string;
    store_id?: string;
    customer_name: string;
    phone: string;
    amount: number;
    note: string;
    status: 'belum' | 'lunas';
    created_at: string;
    paid_at?: string;
    items: DebtItem[];
}

interface KasirAppGlobal {
    db: any;
    state: any;
    dom: any;
    formatCurrency: (amount: number) => string;
    esc: (str: string) => string;
    renderProducts: () => void;
    saveDebtsLocal: () => void;
}

declare var KasirApp: KasirAppGlobal;

class KasbonModule {
    static init() {
        // Expose to window for HTML event handlers
        (window as any).addDebtItemRow = KasbonModule.addDebtItemRow;
        (window as any).removeDebtItemRow = KasbonModule.removeDebtItemRow;
        (window as any).updateDebtItemPrice = KasbonModule.updateDebtItemPrice;
        (window as any).calculateDebtTotal = KasbonModule.calculateDebtTotal;
        (window as any).saveDebt = KasbonModule.saveDebt;
        (window as any).markDebtPaid = KasbonModule.markDebtPaid;
        (window as any).deleteDebt = KasbonModule.deleteDebt;
        (window as any).sendDebtWA = KasbonModule.sendDebtWA;
        (window as any).renderKasbon = KasbonModule.renderKasbon;
        (window as any).openDebtModal = KasbonModule.openDebtModal;
        (window as any).closeDebtModal = KasbonModule.closeDebtModal;
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
          ? KasirApp.state.products.map((p: any) => `
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

    static removeDebtItemRow(rowId: string) {
        const row = document.getElementById(rowId);
        if (row) {
            row.remove();
            KasbonModule.calculateDebtTotal();
        }
    }

    static updateDebtItemPrice(selectEl: HTMLSelectElement, rowId: string) {
        const row = document.getElementById(rowId);
        if (!row) return;
        const option = selectEl.options[selectEl.selectedIndex];
        const price = parseFloat(option.getAttribute('data-price') || '0');
        const subtotalInput = row.querySelectorAll('input[type="text"]')[0] as HTMLInputElement;
        const qtyInput = row.querySelectorAll('input[type="number"]')[0] as HTMLInputElement;
        const qty = parseInt(qtyInput.value) || 1;
        
        if (subtotalInput) {
            subtotalInput.value = KasirApp.formatCurrency(price * qty);
        }
        KasbonModule.calculateDebtTotal();
    }

    static calculateDebtTotal() {
        const container = KasirApp.dom.debtItemsContainer;
        if (!container) return;
        const rows = container.querySelectorAll('.debt-item-row');
        let total = 0;
        KasirApp.state.currentDebtItems = [];
        
        rows.forEach((row: any) => {
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
        const elTotalDisplay = document.getElementById('debtTotalDisplay');
        if (elTotalDisplay) {
            elTotalDisplay.textContent = 'Total Hutang: ' + KasirApp.formatCurrency(total);
        }
    }

    static async saveDebt(e: Event) {
        if (e) e.preventDefault();
        
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
            const product = KasirApp.state.products.find((p: any) => p.id === item.product_id);
            if (product && product.stock < item.qty) {
                KasirApp.dom.debtFormError.textContent = `Stok tidak cukup untuk produk ${product.name}. Tersedia: ${product.stock}`;
                KasirApp.dom.debtFormError.classList.remove('hidden');
                return;
            }
        }

        let record: Partial<DebtRecord> = { 
            customer_name: name, 
            phone, 
            amount, 
            note, 
            status: 'belum', 
            created_at: new Date().toISOString(),
            items: items
        };
        
        let cashierName = "Unknown";
        const cashier = KasirApp.state.cashiers?.find((c: any) => c.id === KasirApp.state.selectedCashierId);
        if (cashier) cashierName = cashier.name;
        
        let transactionId = null;
        if (KasirApp.db && KasirApp.state.storeId) {
            // Gunakan RPC create_debt_transaction
            const { data, error } = await KasirApp.db.rpc('create_debt_transaction', {
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
                alert('Gagal mencatat kasbon: ' + error.message);
                return;
            } else {
                record.id = data.debt_id;
                transactionId = data.transaction_id;
            }
        } else {
            alert('Gagal: Tidak terhubung ke database atau toko tidak ditemukan.');
            return;
        }
        
        // Kurangi stok produk secara lokal agar UI tidak perlu reload
        for (let item of items) {
            const product = KasirApp.state.products.find((p: any) => p.id === item.product_id);
            if (product) {
                product.stock -= item.qty;
            }
        }
        
        KasirApp.state.debts = KasirApp.state.debts || [];
        KasirApp.state.debts.unshift(record);
        KasirApp.saveDebtsLocal();
        
        if (transactionId) {
            if (!KasirApp.state.transactions) KasirApp.state.transactions = [];
            KasirApp.state.transactions.unshift({
                id: transactionId,
                date: record.created_at,
                total: record.amount,
                discount: 0,
                paymethod: 'Hutang',
                cashier: cashierName,
                items: items.map((i: any) => ({
                    id: i.product_id,
                    name: i.product_name,
                    qty: i.qty,
                    price: i.price
                }))
            });
            // Update Dashboard dan Riwayat secara otomatis
            if (typeof (window as any).KasirApp?.updateDashboard === 'function') {
                (window as any).KasirApp.updateDashboard();
            }
            if (typeof (window as any).renderHistory === 'function') {
                (window as any).renderHistory();
            }
        }
        
        KasbonModule.closeDebtModal();
        KasbonModule.renderKasbon();
        KasirApp.renderProducts(); 
        
        alert('Kasbon berhasil disimpan! Transaksi dan stok produk telah dicatat otomatis.');
    }

    static async markDebtPaid(id: string) {
        const debt = (KasirApp.state.debts || []).find((d: any) => String(d.id) === String(id));
        if (!debt) return;
        debt.status = 'lunas';
        debt.paid_at = new Date().toISOString();
        if (KasirApp.db && !isNaN(parseInt(id))) {
            await KasirApp.db.from('debts').update({ status: 'lunas', paid_at: debt.paid_at }).eq('id', parseInt(id));
        }
        KasirApp.saveDebtsLocal();
        KasbonModule.renderKasbon();
    }

    static async deleteDebt(id: string) {
        if (!confirm('Hapus catatan kasbon ini? Jika transaksi sudah terekam di riwayat, Anda harus menghapusnya juga di sana.')) return;
        KasirApp.state.debts = (KasirApp.state.debts || []).filter((d: any) => String(d.id) !== String(id));
        if (KasirApp.db && !isNaN(parseInt(id))) {
            await KasirApp.db.from('debts').delete().eq('id', parseInt(id));
        }
        KasirApp.saveDebtsLocal();
        KasbonModule.renderKasbon();
    }

    static sendDebtWA(id: string) {
        const debt = (KasirApp.state.debts || []).find((d: any) => String(d.id) === String(id));
        if (!debt || !debt.phone) return;
        
        const storeSettings = JSON.parse(localStorage.getItem('pos_store_settings') || '{}');
        const storeName = storeSettings.name || 'Toko Kami';
        
        const msg = `Halo ${debt.customer_name},\n\nIni pesan dari ${storeName}. Kami ingin menginformasikan bahwa ada catatan kasbon sebesar *${KasirApp.formatCurrency(debt.amount)}* pada tanggal ${new Date(debt.created_at).toLocaleDateString('id-ID')}.\n\nMohon konfirmasinya. Terima kasih!`;
        let phone = debt.phone.replace(/\D/g, '');
        if (phone.startsWith('0')) phone = '62' + phone.substring(1);
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    }

    static renderKasbon() {
        const list = document.getElementById('debtList');
        if (!list) return;
        const debts = KasirApp.state.debts || [];
        const searchInput = document.getElementById('debtSearchInput') as HTMLInputElement;
        const search = (searchInput?.value || '').toLowerCase();
        const active = debts.filter((d: any) => d.status !== 'lunas');
        const totalAmount = active.reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

        const elTotal = document.getElementById('debtTotalAmount');
        const elCount = document.getElementById('debtActiveCount');
        if (elTotal) elTotal.textContent = KasirApp.formatCurrency(totalAmount);
        if (elCount) elCount.textContent = active.length.toString();

        const filtered = debts.filter((d: any) => !search || (d.customer_name || '').toLowerCase().includes(search));
        const sorted = [...filtered.filter((d: any) => d.status !== 'lunas'), ...filtered.filter((d: any) => d.status === 'lunas').slice(0, 20)];

        list.innerHTML = sorted.map((d: any) => {
            const isPaid = d.status === 'lunas';
            const date = new Date(d.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
            
            let itemsHtml = '';
            if (d.items && Array.isArray(d.items) && d.items.length > 0) {
                itemsHtml = `<div class="text-xs text-slate-500 mt-1">${d.items.map((i: any) => `${i.product_name} (${i.qty}x)`).join(', ')}</div>`;
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

        list.querySelectorAll('[data-debt-paid]').forEach((btn: any) =>
            btn.addEventListener('click', () => KasbonModule.markDebtPaid(btn.dataset.debtPaid)));
        list.querySelectorAll('[data-debt-delete]').forEach((btn: any) =>
            btn.addEventListener('click', () => KasbonModule.deleteDebt(btn.dataset.debtDelete)));
        list.querySelectorAll('[data-debt-wa]').forEach((btn: any) =>
            btn.addEventListener('click', () => KasbonModule.sendDebtWA(btn.dataset.debtWa)));
    }
}

KasbonModule.init();
