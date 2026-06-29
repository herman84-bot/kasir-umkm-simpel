import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Kasir UMKM Simpel - Point of Sale & Inventory Management',
  description: 'Aplikasi kasir online gratis untuk UMKM Indonesia. Kelola toko, inventory, kasbon, dan laporan penjualan dengan mudah. Gratis selamanya untuk fitur dasar.',
  keywords: 'kasir, umkm, point of sale, inventory, kasbon, aplikasi kasir, pos indonesia',
  authors: [{ name: 'Kasir UMKM Simpel' }],
  openGraph: {
    title: 'Kasir UMKM Simpel - Point of Sale & Inventory Management',
    description: 'Aplikasi kasir online gratis untuk UMKM Indonesia',
    type: 'website',
    locale: 'id_ID',
    siteName: 'Kasir UMKM Simpel',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kasir UMKM Simpel',
    description: 'Aplikasi kasir online gratis untuk UMKM Indonesia',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <head>
        <meta name="theme-color" content="#0f172a" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
