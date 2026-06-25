'use client'

import { useEffect } from 'react'

export default function Home() {
  useEffect(() => {
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

    // Load main app script that contains all HTML and logic
    const appScript = document.createElement('script')
    appScript.src = '/app.js'
    appScript.async = true
    document.body.appendChild(appScript)

    // Load service worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then(reg => console.log('SW registered:', reg))
        .catch(err => console.log('SW registration failed:', err))
    }
  }, [])

  // Return null - app.js will inject all HTML content into the body
  return null
}
