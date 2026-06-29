/** @type {import('next-sitemap').IConfig} */
module.exports = {
  // URL utama website Anda
  siteUrl: 'https://www.simpelkasir.my.id',
  
  // Generate robots.txt secara otomatis
  generateRobotsTxt: true,
  
  // Frekuensi crawl untuk search engines
  changefreq: 'daily',
  
  // Prioritas halaman (0.0 - 1.0)
  priority: 0.7,
  
  // Format output sitemap
  sitemapSize: 5000,
  
  // Auto-generate lastmod field
  autoLastmod: true,
  
  // Exclude halaman tertentu dari sitemap
  exclude: [
    '/server-side-sitemap.xml',
    '/404',
    '/admin/*',
    '/dashboard/*'
  ],
  
  // Konfigurasi robots.txt
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/dashboard',
          '/api',
          '/*.json$',
          '/*.xml$'
        ]
      }
    ],
    additionalSitemaps: [
      'https://www.simpelkasir.my.id/sitemap.xml'
    ]
  },
  
  // Transformasi custom untuk URL
  transform: async (config, path) => {
    return {
      loc: path,
      changefreq: config.changefreq,
      priority: config.priority,
      lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
    }
  }
}
