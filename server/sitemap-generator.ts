/**
 * Dynamic Sitemap Generator for Quant Edge Labs
 * Generates XML sitemap for SEO optimization
 */

const BASE_URL = 'https://quantedgelabs.net';

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

// Static pages with SEO priority
const STATIC_PAGES: SitemapUrl[] = [
  { loc: '/', changefreq: 'daily', priority: 1.0 },
  { loc: '/blog', changefreq: 'daily', priority: 0.8 },
  { loc: '/academy', changefreq: 'weekly', priority: 0.7 },
  { loc: '/how-to', changefreq: 'monthly', priority: 0.6 },
  { loc: '/pricing', changefreq: 'monthly', priority: 0.8 },
  { loc: '/about', changefreq: 'monthly', priority: 0.6 },
  { loc: '/privacy', changefreq: 'yearly', priority: 0.3 },
  { loc: '/terms', changefreq: 'yearly', priority: 0.3 },
];

export function generateSitemap(blogSlugs: string[] = []): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
`;

  // Add static pages
  for (const page of STATIC_PAGES) {
    xml += `  <url>
    <loc>${BASE_URL}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority.toFixed(1)}</priority>
  </url>
`;
  }

  // Add blog post pages
  for (const slug of blogSlugs) {
    const safeSlug = encodeURIComponent(slug);
    xml += `  <url>
    <loc>${BASE_URL}/blog/${safeSlug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
`;
  }

  xml += `</urlset>`;

  return xml;
}

// Generate robots.txt content
export function generateRobotsTxt(): string {
  return `# Quant Edge Labs Robots.txt
# https://quantedgelabs.net

User-agent: *
Allow: /

# Crawl delay for polite crawling
Crawl-delay: 1

# Disallow admin and private areas
Disallow: /admin
Disallow: /admin-*
Disallow: /api/
Disallow: /settings
Disallow: /reset-password
Disallow: /invite-welcome
Disallow: /login
Disallow: /signup
Disallow: /forgot-password
Disallow: /join-beta
Disallow: /t
Disallow: /r
Disallow: /r/
Disallow: /radar
Disallow: /today
Disallow: /slate
Disallow: /alerts
Disallow: /trade-ideas/

# Allow search engines to index API docs if present
Allow: /api-docs

# Sitemap location
Sitemap: https://quantedgelabs.net/sitemap.xml

# Google specific
User-agent: Googlebot
Allow: /
Crawl-delay: 0

# Bing specific
User-agent: Bingbot
Allow: /
Crawl-delay: 1
`;
}
