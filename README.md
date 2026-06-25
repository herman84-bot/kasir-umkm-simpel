# Kasir UMKM Simpel - Next.js

Aplikasi Point of Sale (POS) dan Inventory Management untuk UMKM Indonesia.

## Tech Stack

- **Next.js 14** - React Framework
- **Tailwind CSS** - Styling
- **Supabase** - Backend (Auth + Database)
- **PWA** - Progressive Web App support

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser.

### Build for Production

```bash
npm run build
npm run start
```

## Deploy ke Vercel

1. Push code ke GitHub/GitLab
2. Buka [Vercel](https://vercel.com)
3. Import project dari repository
4. Vercel akan auto-detect Next.js dan build otomatis
5. Custom domain dapat dikonfigurasi di Settings > Domains

## Struktur Project

```
├── public/          # Static assets
│   ├── app.js       # Main application logic
│   ├── tailwind.css # Compiled Tailwind styles
│   ├── service-worker.js
│   └── icons/       # PWA icons
├── src/app/         # Next.js App Router
│   ├── layout.js    # Root layout
│   ├── page.js      # Home page
│   └── globals.css  # Global styles
├── next.config.js   # Next.js configuration
├── next-sitemap.config.js  # Sitemap generation
├── tailwind.config.js      # Tailwind configuration
└── package.json
```

## Features

- ✅ Login/Register dengan Supabase Auth
- ✅ Dashboard penjualan
- ✅ Kasir/Point of Sale
- ✅ Inventory management
- ✅ Pembelian stok
- ✅ Riwayat transaksi
- ✅ Kasbon (hutang pelanggan)
- ✅ Multi-user (Admin & Kasir)
- ✅ PWA support (offline mode)
- ✅ Responsive design
- ✅ Dark mode

## License

MIT
