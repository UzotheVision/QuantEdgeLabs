const SITE_URL = 'https://quantedgelabs.net';
type SeoRoute = {
  title: string;
  description: string;
  index?: boolean;
  type?: 'website' | 'article';
  schema?: Record<string, unknown>[];
};

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: 'QuantEdge Labs',
  alternateName: 'Quant Edge Labs',
  url: SITE_URL,
  logo: `${SITE_URL}/icon-512.png`,
  founder: { '@id': 'https://abdulmalikajisegiri.com/#person' },
  sameAs: ['https://abdulmalikajisegiri.com/'],
};

const founderSchema = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  '@id': 'https://abdulmalikajisegiri.com/#person',
  name: 'Abdulmalik Ajisegiri',
  url: 'https://abdulmalikajisegiri.com/',
  jobTitle: 'Founder and Lead Developer',
  founderOf: { '@id': `${SITE_URL}/#organization` },
  knowsAbout: [
    'Systems engineering',
    'Model risk management',
    'AI and machine learning governance',
    'Quantitative market research',
  ],
};

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SITE_URL}/#software`,
  name: 'QuantEdge Labs',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  url: SITE_URL,
  description: 'A quantitative market-research terminal for stocks, options, crypto, flow, gamma exposure and catalyst analysis.',
  author: { '@id': `${SITE_URL}/#organization` },
};

const PUBLIC_ROUTES: Record<string, SeoRoute> = {
  '/': {
    title: 'QuantEdge Labs | Quantitative Market Research Terminal',
    description: 'Research stocks, options and crypto in one terminal with transparent signal scoring, options flow, gamma exposure, catalysts and tracked outcomes.',
    schema: [organizationSchema, softwareSchema],
  },
  '/about': {
    title: 'About QuantEdge Labs | Research Method and Founder',
    description: 'Learn how QuantEdge Labs combines systems engineering, model-risk discipline and quantitative market research. Founded by Abdulmalik Ajisegiri.',
    schema: [organizationSchema, founderSchema],
  },
  '/pricing': {
    title: 'QuantEdge Labs Pricing | Quantitative Research Tools',
    description: 'Compare QuantEdge Labs plans for quantitative stock, options and crypto research, signal tracking, flow and gamma-exposure analysis.',
  },
  '/blog': {
    title: 'QuantEdge Labs Research Library | Markets and Model Risk',
    description: 'Research notes on quantitative markets, options, model validation, risk, AI governance and trading-system design from QuantEdge Labs.',
  },
  '/academy': {
    title: 'QuantEdge Academy | Learn Quantitative Market Research',
    description: 'Learn how to evaluate market regimes, signal evidence, options flow, gamma exposure, risk and trade structure without treating a score as certainty.',
  },
  '/how-to': {
    title: 'How to Use QuantEdge Labs | Terminal Guide',
    description: 'A practical guide to reading QuantEdge signals, evidence grades, price levels, options contracts, market context and tracked outcomes.',
  },
  '/privacy': {
    title: 'Privacy Policy | QuantEdge Labs',
    description: 'How QuantEdge Labs collects, uses and protects account and product data.',
  },
  '/terms': {
    title: 'Terms of Service | QuantEdge Labs',
    description: 'Terms governing use of the QuantEdge Labs market-research platform.',
  },
};

const NOINDEX_PREFIXES = [
  '/t', '/r', '/radar', '/today', '/slate', '/login', '/signup',
  '/forgot-password', '/reset-password', '/join-beta', '/invite',
  '/settings', '/alerts', '/admin', '/trade-ideas', '/w',
];

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function routeFor(pathname: string): SeoRoute {
  if (PUBLIC_ROUTES[pathname]) return PUBLIC_ROUTES[pathname];
  if (pathname.startsWith('/blog/')) {
    return {
      title: 'QuantEdge Labs Research',
      description: 'Quantitative market research, options analysis and model-risk notes from QuantEdge Labs.',
      type: 'article',
    };
  }
  if (NOINDEX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return {
      title: 'QuantEdge Terminal',
      description: 'Private QuantEdge Labs research workspace.',
      index: false,
    };
  }
  return {
    title: 'Page not found | QuantEdge Labs',
    description: 'The requested QuantEdge Labs page could not be found.',
    index: false,
  };
}

function replaceMeta(html: string, pattern: RegExp, replacement: string): string {
  return pattern.test(html) ? html.replace(pattern, replacement) : html.replace('</head>', `    ${replacement}\n  </head>`);
}

export function injectServerSeo(html: string, requestPath: string): string {
  const pathname = requestPath.split('?')[0].replace(/\/$/, '') || '/';
  const seo = routeFor(pathname);
  const canonical = `${SITE_URL}${pathname === '/' ? '/' : pathname}`;
  const robots = seo.index === false ? 'noindex, nofollow' : 'index, follow, max-image-preview:large';
  const title = escapeAttribute(seo.title);
  const description = escapeAttribute(seo.description);

  let output = html
    .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
    .replace(/<meta name="title" content="[^"]*"\s*\/>/, `<meta name="title" content="${title}" />`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${description}" />`)
    .replace(/<meta name="robots" content="[^"]*"\s*\/>/, `<meta name="robots" content="${robots}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${canonical}" />`);

  const tags: Array<[RegExp, string]> = [
    [/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${canonical}" />`],
    [/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${title}" />`],
    [/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${description}" />`],
    [/<meta property="og:type" content="[^"]*"\s*\/>/, `<meta property="og:type" content="${seo.type ?? 'website'}" />`],
    [/<meta name="twitter:url" content="[^"]*"\s*\/>/, `<meta name="twitter:url" content="${canonical}" />`],
    [/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${title}" />`],
    [/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${description}" />`],
  ];
  for (const [pattern, replacement] of tags) output = replaceMeta(output, pattern, replacement);

  output = output.replace(/\s*<script type="application\/ld\+json" data-server-seo>[\s\S]*?<\/script>/g, '');
  if (seo.schema?.length) {
    const structuredData = JSON.stringify(seo.schema).replace(/</g, '\\u003c');
    output = output.replace('</head>', `    <script type="application/ld+json" data-server-seo>${structuredData}</script>\n  </head>`);
  }
  return output;
}
