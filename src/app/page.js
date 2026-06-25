'use client'

import { useEffect, useState } from 'react'

export default function Home() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    
    // Load Tailwind CSS
    const tailwindLink = document.createElement('link')
    tailwindLink.rel = 'stylesheet'
    tailwindLink.href = '/tailwind.css'
    document.head.appendChild(tailwindLink)

    // Load external scripts
    const scripts = [
      'https://cdn.jsdelivr.net/npm/chart.js',
      'https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js',
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
      'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
      'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
    ]

    scripts.forEach(src => {
      const script = document.createElement('script')
      script.src = src
      script.async = true
      document.head.appendChild(script)
    })

    // Load main app script
    const appScript = document.createElement('script')
    appScript.src = '/app.js'
    appScript.async = true
    document.body.appendChild(appScript)

    // Load service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then(reg => console.log('SW registered:', reg))
        .catch(err => console.log('SW registration failed:', err))
    }
  }, [])

  if (!mounted) {
    return (
      <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-slate-900 text-white">
        <div className="text-4xl mb-4 animate-pulse">🛒</div>
        <h2 className="text-xl font-semibold mb-2">Kasir UMKM Simpel</h2>
        <p className="text-slate-400 text-sm">Memuat aplikasi...</p>
      </div>
    )
  }

  return null
}
