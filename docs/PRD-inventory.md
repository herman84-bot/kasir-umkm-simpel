# PRD: Inventory Management — Kasir UMKM Simpel

> **Status:** Draft untuk Review  
> **Tanggal:** 2026-06-28  
> **Penulis:** AI Assistant  
> **Prioritas:** P0 — Fitur inti yang sudah ada foundation-nya tapi belum berfungsi

---

## 1. Latar Belakang

Sistem kasir sudah punya **database schema lengkap** untuk inventory (6 tabel, 3 Edge Functions, trigger otomatis). Tapi **banyak yang belum terhubung ke UI**. User saat ini hanya bisa:
- Tambah/edit produk (CRUD dasar)
- Lihat produk stok rendah & hampir kadaluarsa (read-only list)

**Yang TIDAK bisa dilakukan user:**
- ❌ Adjust stok manual (selisih opname, barang rusak, dll)
- ❌ Stock opname (hitung fisik vs sistem)
- ❌ Lihat riwayat pergerakan stok (stock ledger)
- ❌ Input stok awal saat tambah produk baru
- ❌ Retur penjualan
- ❌ Alert otomatis di dashboard

---

## 2. Analisis Kode Existing

### 2.1 Database (✅ Lengkap)

| Tabel | Fungsi | Status |
|---|---|---|
| `products` | Master produk + stok + stok_minimum + harga_beli | ✅ Ada, aktif dipakai |
| `stock_ledger` | Catatan setiap pergerakan stok masuk/keluar | ✅ Ada, belum ada UI |
| `stock_opname` | Header stock opname (draft → pending → selesai) | ✅ Ada, belum ada UI |
| `stock_opname_items` | Detail hitung fisik per produk | ✅ Ada, belum ada UI |
| `stock_alerts` | Notifikasi stok rendah & hampir kadaluarsa | ✅ Ada, belum ada UI |
| `penjualan` | Transaksi penjualan (terhubung ke POS) | ✅ Ada, aktif dipakai |

### 2.2 Edge Functions (✅ Ada, belum semua dipakai)

| Function | Fungsi | Status |
|---|---|---|
| `stock-adjustment` | Adjust stok + catat ke ledger | ✅ Ada, belum dipanggil dari UI |
| `stock-opname` | Mulai opname + proses hasil | ✅ Ada, belum dipanggil dari UI |
| `expiring-alerts` | Scan produk hampir kadaluarsa | ✅ Ada, belum dijadwalkan |

### 2.3 Frontend (⚠️ Buggy)

| Fungsi | Fungsi | Status |
|---|---|---|
| `renderInventory()` | List produk + alert badges | ✅ Ada |
| `adjustStokProduk()` | Panggil Edge Function adjustment | ✅ Ada |
| `showAdjustmentModal()` | Modal input adjustment | ❌ **BUG: elemen `#modalAdjustmentStok` tidak ada di HTML** |
| `showOpnameTable()` | Modal tabel opname | ❌ **BUG: elemen `#tabelOpname` tidak ada di HTML** |
| `renderInventoryOpname()` | Render wizard opname | ✅ Logic ada, tapi container tidak ada |
| `tampilkanRiwayatStok()` | Modal riwayat ledger | ❌ **BUG: elemen `#riwayatStokModal` tidak ada di HTML** |

---

## 3. User Persona

**Pak Budi** — Pemilik warung kelontong
- Punya ~200 produk
- Tidak paham teknologi
- Butuh stok selalu akurat karena margin tipis
- Stock opname 1x/bulan
- Ingin tahu produk mana yang hampir habis/kadaluarsa

---

## 4. Cara Main (User Flow)

### 4.1 Alur Harian — POS Otomatis Kurangi Stok

```
User buka POS → Pilih produk → Checkout
  ↓
Edge Function create-order → _kurangiStokProduk()
  ↓
products.stok berkurang + stock_ledger tercatat (jenis: penjualan)
  ↓
Kalau stok ≤ stok_minimum → stock_alerts terisi
```

**Status:** ✅ Sudah jalan (sudah ada di create-order function)

### 4.2 Alur Tambah Produk Baru + Stok Awal

```
Inventory → Tambah Produk → Isi nama, harga, stok_minimum, dll
  ↓
Klik "Simpan" → INSERT ke products + stok = 0
  ↓
Muncul prompt: "Masukkan stok awal barang ini?"
  ↓ (kalau ya)
Input jumlah stok → UPDATE products.stok + INSERT stock_ledger (jenis: stok_awal)
```

**Status:** ⚠️ Produk bisa ditambah, tapi stok_awal tidak tercatat di ledger

### 4.3 Alur Adjust Stok Manual

```
Inventory → Klik produk → Klik "Atur Stok"
  ↓
Modal muncul: "Stok sekarang: 15. Atur ke berapa?"
  ↓
User input angka baru + alasan (selisih opname / barang rusak / koreksi)
  ↓
Edge Function stock-adjustment → UPDATE stok + INSERT ledger
  ↓
Modal tutup → List refresh
```

**Status:** ❌ Modal tidak ada di HTML

### 4.4 Alur Stock Opname

```
Inventory → Tab "Opname Stok" → Klik "Mulai Opname"
  ↓
Edge Function stock-opname → INSERT stock_opname + INSERT stock_opname_items (stok_sistem = products.stok)
  ↓
Muncul daftar produk: [Nama] [Stok Sistem: 15] [Stok Fisik: ___]
  ↓
User hitung barang fisik → Input angka di setiap produk
  ↓
Klik "Simpan Sementara" (draft) atau "Selesai & Sesuaikan"
  ↓
Kalau "Selesai" → Edge Function proses semua selisih → UPDATE products.stok + INSERT ledger
  ↓
stock_opname.status = "selesai"
```

**Status:** ❌ Wizard tidak ada di HTML

### 4.5 Alur Lihat Riwayat Stok

```
Inventory → Klik produk → Klik "Riwayat"
  ↓
Modal muncul: Tabel [Tanggal] [Jenis] [Jumlah] [Stok Setelah] [Keterangan]
  ↓
Filter: 7 hari / 30 hari / semua
```

**Status:** ❌ Modal tidak ada di HTML

### 4.6 Alur Alert Dashboard

```
User buka app → Dashboard
  ↓
Kalau ada stock_alerts yang belum dibaca → Banner kuning: "3 produk stok rendah, 1 produk hampir kadaluarsa"
  ↓
Klik banner → Navigasi ke Inventory tab yang sesuai
```

**Status:** ⚠️ Badge sudah ada di sidebar, tapi banner dashboard belum ada

---

## 5. Spesifikasi Fitur

### F1: Fix Adjustment Modal

**Apa:** Perbaiki `showAdjustmentModal()` — tambahkan elemen HTML yang hilang.

**Detail:**
- Modal dengan input: stok baru (angka), alasan (dropdown: selisih opname, barang rusak, koreksi, lainnya), catatan (opsional)
- Tampilkan stok saat ini di header modal
- Konfirmasi sebelum simpan: "Stok [produk] akan diubah dari [lama] ke [baru]. Lanjut?"
- Setelah simpan → refresh list produk

**Acceptance Criteria:**
- [ ] Klik "Atur Stok" → modal muncul
- [ ] Input stok baru + alasan → klik simpan
- [ ] Stok berubah di database + tercatat di ledger
- [ ] List produk refresh otomatis

---

### F2: Fix Stock Opname Wizard

**Apa:** Perbaiki `renderInventoryOpname()` + `showOpnameTable()` — tambahkan elemen HTML.

**Detail:**
- Tab "Opname Stok" di inventory section
- Tombol "Mulai Opname Baru" → Edge Function buat header + items
- Tabel input: [Produk] [Stok Sistem] [Stok Fisik (input)] [Selisih (auto)] [Keterangan]
- Filter per kategori
- Tombol "Simpan Draft" (bisa lanjut nanti)
- Tombol "Selesai & Sesuaikan" → konfirmasi → proses semua selisih
- Riwayat opname sebelumnya (read-only)

**Acceptance Criteria:**
- [ ] Klik "Mulai Opname" → tabel muncul dengan semua produk
- [ ] Input stok fisik → selisih terhitung otomatis
- [ ] Simpan draft → bisa buka lagi nanti
- [ ] Selesai → stok teradjust + ledger tercatat
- [ ] Status opname berubah ke "selesai"

---

### F3: Fix Riwayat Stok Modal

**Apa:** Perbaiki `tampilkanRiwayatStok()` — tambahkan elemen HTML.

**Detail:**
- Modal dengan tabel: [Tanggal] [Jenis Transaksi] [Jumlah ±] [Stok Setelah] [Keterangan]
- Jenis: stok_awal (hijau), penjualan (merah), pembelian (hijau), penyesuaian (kuning), retur (hijau)
- Filter: 7 hari / 30 hari / semua
- Pagination: 20 item per halaman

**Acceptance Criteria:**
- [ ] Klik "Riwayat" pada produk → modal muncul
- [ ] Tabel menampilkan pergerakan stok berurutan (terbaru dulu)
- [ ] Warna berbeda per jenis transaksi
- [ ] Filter berfungsi

---

### F4: Stok Awal Saat Tambah Produk

**Apa:** Setelah tambah produk, tawarkan input stok awal.

**Detail:**
- Setelah simpan produk baru → toast: "Produk tersimpan! Atur stok awal?"
- Klik toast → modal adjustment (reuse F1) dengan jenis "stok_awal"
- Kalau diabaikan → stok tetap 0, bisa diatur nanti

**Acceptance Criteria:**
- [ ] Tambah produk → muncul opsi stok awal
- [ ] Input stok awal → tercatat di ledger sebagai "stok_awal"
- [ ] Produk yang belum ada stok awal → badge "belum ada stok" di list

---

### F5: Dashboard Alerts

**Apa:** Tampilkan alert stok rendah & kadaluarsa di dashboard.

**Detail:**
- Card alert di dashboard: "⚠️ X produk stok rendah" + "🕐 X produk hampir kadaluarsa"
- Klik → navigasi ke tab inventory yang sesuai
- Alert bisa di-dismiss (mark as read)
- Refresh alert setiap kali buka dashboard

**Acceptance Criteria:**
- [ ] Dashboard menampilkan alert jika ada produk bermasalah
- [ ] Klik alert → navigasi ke inventory
- [ ] Alert hilang setelah di-dismiss atau masalah diselesaikan

---

### F6: Retur Penjualan

**Apa:** User bisa proses retur dari riwayat penjualan.

**Detail:**
- Di riwayat penjualan → tombol "Retur" pada transaksi
- Modal: pilih item yang di-retur + jumlah
- Konfirmasi → Edge Function proses retur → stok bertambah + ledger tercatat
- Hanya admin yang bisa retur

**Acceptance Criteria:**
- [ ] Klik "Retur" pada transaksi → modal muncul
- [ ] Pilih item + jumlah → konfirmasi
- [ ] Stok bertambah + ledger tercatat sebagai "retur_penjualan"
- [ ] Hanya admin yang bisa akses

---

## 6. Prioritas Implementasi

| Fase | Fitur | Alasan |
|---|---|---|
| **Fase 1** | F1 (Adjust Modal) + F3 (Riwayat Stok) | Fix bug — kode sudah ada, cuma perlu HTML |
| **Fase 2** | F2 (Stock Opname) | Fix bug — kode sudah ada, perlu HTML + sedikit logic |
| **Fase 3** | F4 (Stok Awal) + F5 (Dashboard Alerts) | Enhancement kecil |
| **Fase 4** | F6 (Retur Penjualan) | Fitur baru, butuh Edge Function baru |

---

## 7. Referensi

### Pola Inventory Management untuk UMKM

1. **Stock Card / Kartu Stok** — Standar pencatatan inventori. Setiap pergerakan stok dicatat dengan: tanggal, jenis (masuk/keluar), jumlah, saldo. Ini persis seperti `stock_ledger` yang sudah ada.

2. **Stock Opname Cycle** — Standar retail:
   - Sistem hitung stok_sistem dari transaksi
   - User hitung stok_fisik di lapangan
   - Selisih = stok_fisik - stok_sistem
   - Penyesuaian otomatis + catatan alasan

3. **Par Level System** — Untuk UMKM:
   - Tentukan stok_minimum per produk
   - Alert otomatis saat stok ≤ minimum
   - Reorder suggestion (opsional, fase depan)

4. **FIFO (First In First Out)** — Untuk produk kadaluarsa:
   - Urutkan berdasarkan tanggal_masuk / tanggal_kadaluarsa
   - Alert 30 hari sebelum kadaluarsa
   - Sudah ada di `expiring-alerts` function

5. **Referensi Implementasi:**
   - **Square POS** — Stock management terintegrasi kasir, adjustment mudah
   - **Loyverse POS** — Populer untuk UMKM, punya stock opname + history
   - **inFlow Inventory** — Pola stock ledger yang clean

---

## 8. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| User salah input stok fisik saat opname | Stok tidak akurat | Konfirmasi sebelum proses + catatan alasan wajib |
| Edge Function timeout saat proses banyak produk | Opname gagal di tengah | Batch processing (50 produk per batch) |
| Race condition: 2 user adjust stok bersamaan | Stok tidak konsisten | Lock produk saat sedang di-adjust (atau last-write-wins + ledger tetap akurat) |
| User tidak stock opname rutin | Stok drift dari realita | Reminder bulanan di dashboard |

---

## 9. Out of Scope (Fase Depan)

- Purchase order / pembelian dari supplier
- Multi-gudang
- Barcode scanner integration
- Laporan inventory (turnover ratio, dead stock)
- Reorder point otomatis berdasarkan pola penjualan

---

## 10. Catatan Teknis

### Elemen HTML yang Perlu Ditambah

```
#modalAdjustmentStok   — Modal adjust stok manual
#modalRiwayatStok       — Modal riwayat pergerakan stok
#tabelOpname            — Container wizard stock opname
#opname-history         — Tabel riwayat opname sebelumnya
```

### Edge Functions yang Perlu Dimodifikasi

- `stock-adjustment` — Sudah OK, mungkin perlu tambah validasi input
- `stock-opname` — Sudah OK, perlu endpoint untuk save draft
- `expiring-alerts` — Sudah OK, perlu integrasi ke dashboard

### Edge Functions yang Perlu Dibuat Baru

- `process-return` — Proses retur penjualan (F6)

---

**End of PRD — Silakan review dan kasih feedback!**
