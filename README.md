# Kasir UMKM Simpel

Aplikasi kasir dan manajemen stok berbasis HTML, Tailwind CSS, dan Vanilla JavaScript.

## Cara pakai
1. Buka file `index.html` di browser (atau `npm run dev` untuk pengembangan).
2. Gunakan menu di samping untuk membuka Dashboard, Kasir, Inventory, dan Riwayat.
3. Data tersimpan di database Supabase dan tersinkron antar perangkat. Saat offline, transaksi tersimpan sementara di browser dan otomatis tersinkron saat koneksi kembali.

## Fitur
- Dashboard statistik dan grafik penjualan.
- Kasir satu layar dengan keranjang, diskon, pajak, uang cepat, dan struk cetak.
- Inventory dengan CRUD, indikator stok kritis, stock opname, dan riwayat pergerakan stok.
- Riwayat transaksi dengan pencarian, void, dan retur.
- Kasbon (utang pelanggan) dengan pengingat WhatsApp.
- Multi-kasir (PIN operator) dan multi-cabang.
- Export data CSV.
- Aisyah — asisten AI di dalam aplikasi.
