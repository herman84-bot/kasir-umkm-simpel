/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://www.simpelkasir.my.id',
  generateRobotsTxt: true,
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    additionalSitemaps: ['https://www.simpelkasir.my.id/sitemap.xml'],
  },
};
