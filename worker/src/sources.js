export const SOURCE_SET_VERSION = '2026-09-10-en-01';

export const CATEGORIES = [
  { slug: 'kultur-sanat', name: 'Kültür & Sanat' },
  { slug: 'sinema', name: 'Sinema' },
  { slug: 'moda-tasarim', name: 'Moda & Tasarım' },
  { slug: 'sehir-yasam', name: 'Şehir & Yaşam' }
];

const rss = (id, name, feedUrl, url, quality, options = {}) => ({
  id,
  name,
  mode: 'rss',
  adapter: 'rss_generic',
  feedUrl,
  url,
  quality,
  enabled: true,
  priority: 'P1',
  intervalMinutes: 60,
  ...options
});

const html = (id, name, url, quality, options = {}) => ({
  id,
  name,
  mode: 'html',
  adapter: 'html_generic',
  url,
  quality,
  enabled: true,
  priority: 'P2',
  intervalMinutes: 360,
  ...options
});

const cultureTerms = [
  'art', 'artist', 'culture', 'museum', 'exhibition', 'heritage', 'literature', 'book',
  'theatre', 'theater', 'opera', 'music', 'film', 'cinema', 'fashion', 'design',
  'architecture', 'photography', 'festival', 'creative', 'craft'
];

const chinaTerms = [
  'china', 'chinese', 'hong kong', 'taiwan', 'beijing', 'shanghai', 'shenzhen',
  'guangzhou', 'chengdu', 'hangzhou', 'chongqing', 'xi’an', "xi'an"
];

export const SOURCES = [
  rss('cgtn-culture', 'CGTN – Culture', 'https://www.cgtn.com/subscribe/rss/section/culture.xml', 'https://www.cgtn.com/culture', 9),
  rss('sixth-tone', 'Sixth Tone', 'https://www.sixthtone.com/rss/index.xml', 'https://www.sixthtone.com/', 9, {
    includeTerms: cultureTerms
  }),
  rss('radii-art', 'RADII – Art', 'https://radii.co/tags/art/feed', 'https://radii.co/tags/art', 9, {
    defaultCategory: 'kultur-sanat',
    intervalMinutes: 180
  }),
  rss('radii-fashion', 'RADII – Fashion', 'https://radii.co/tags/fashion/feed', 'https://radii.co/tags/fashion', 9, {
    defaultCategory: 'moda-tasarim',
    intervalMinutes: 180
  }),
  rss('dao-fashion-retail', 'Dao Insights – Fashion & Retail', 'https://daoinsights.com/tag/industries-fashion-retail/feed/', 'https://daoinsights.com/tag/industries-fashion-retail/', 8, {
    defaultCategory: 'moda-tasarim',
    excludeTerms: ['sponsored', 'advertorial', 'partner content'],
    intervalMinutes: 180
  }),
  rss('artasiapacific-news', 'ArtAsiaPacific – News', 'https://www.artasiapacific.com/rss/', 'https://www.artasiapacific.com/news/', 9, {
    defaultCategory: 'kultur-sanat',
    includeTerms: chinaTerms,
    intervalMinutes: 120
  }),
  html('china-daily-culture', 'China Daily – Culture', 'https://www.chinadaily.com.cn/culture', 10, {
    adapter: 'html_chinadaily',
    priority: 'P1',
    intervalMinutes: 60,
    linkSelector: "a[href*='/a/20']",
    itemSelector: 'article, li, .item, .news-item, .card, .mb10, .tw3_01_2_t'
  }),
  html('china-daily-fashion', 'China Daily – Fashion', 'https://www.chinadaily.com.cn/life/fashion', 9, {
    adapter: 'html_chinadaily',
    priority: 'P1',
    intervalMinutes: 120,
    defaultCategory: 'moda-tasarim',
    linkSelector: "a[href*='/a/20']",
    itemSelector: 'article, li, .item, .news-item, .card'
  }),
  html('xinhua-culture', 'Xinhua – Culture & Lifestyle', 'https://english.news.cn/culture/index.htm', 10, {
    adapter: 'html_xinhua',
    priority: 'P1',
    intervalMinutes: 60,
    linkSelector: "a[href$='/c.html']",
    pathPattern: /\/20\d{6}\/[^?#]+\/c\.html$/i
  }),
  html('jingdaily-fashion', 'Jing Daily – Fashion', 'https://jingdaily.com/sectors/fashion', 8, {
    adapter: 'html_jingdaily',
    priority: 'P1',
    intervalMinutes: 120,
    defaultCategory: 'moda-tasarim',
    linkSelector: "a[href*='/posts/']",
    pathPattern: /\/posts\//i,
    rejectBodyPatterns: [/subscription required/i, /subscribe to continue/i, /members only/i]
  }),
  html('smartshanghai-exhibitions', 'SmartShanghai – Art Exhibitions', 'https://www.smartshanghai.com/events/exhibitions/', 8, {
    adapter: 'html_smartshanghai',
    defaultCategory: 'kultur-sanat',
    linkSelector: "a[href*='/event/']",
    pathPattern: /\/event\//i,
    itemSelector: 'article, .event, .event-row, .card'
  }),
  html('smartshanghai-stage', 'SmartShanghai – Stage & Dance', 'https://www.smartshanghai.com/events/stage/', 8, {
    adapter: 'html_smartshanghai',
    defaultCategory: 'kultur-sanat',
    linkSelector: "a[href*='/event/']",
    pathPattern: /\/event\//i,
    itemSelector: 'article, .event, .event-row, .card'
  }),
  html('cns-lifestyle', 'City News Service – Lifestyle', 'https://www.citynewsservice.cn/articles/cns/lifestyle', 8, {
    adapter: 'next_cns_articles',
    intervalMinutes: 180,
    defaultCategory: 'sehir-yasam',
    includeTerms: [...cultureTerms, 'lifestyle', 'city', 'food'],
    browser: true,
    waitSelector: 'article, a[href]'
  }),
  html('cns-exhibitions', 'City News Service – Exhibition Events', 'https://www.citynewsservice.cn/events/exhibition', 8, {
    adapter: 'html_cns_events',
    defaultCategory: 'kultur-sanat',
    linkSelector: 'main a[href]',
    itemSelector: 'main article, main a:has(article)'
  }),
  html('world-of-chinese', 'The World of Chinese', 'https://www.theworldofchinese.com/', 8, {
    adapter: 'html_twoc',
    includeTerms: cultureTerms,
    pathPattern: /\/20\d{2}\/\d{1,2}\//,
    rejectBodyPatterns: [/membership required/i, /subscribe to continue/i]
  }),
  {
    ...html('chinaculture', 'Chinaculture.org – News, Trends & Events', 'https://en.chinaculture.org/', 10, {
      adapter: 'html_chinaculture',
      defaultCategory: 'kultur-sanat',
      linkSelector: "a[href*='/a/20']",
      pathPattern: /\/a\/20\d{4}\/\d{2}\//,
      articleLimit: 60
    }),
    mode: 'hybrid',
    feedUrl: 'https://en.chinaculture.org/Chinaculture-RSS.xml',
    feedMinimumFreshItems: 3
  },
  html('ocula-magazine', 'Ocula – Magazine', 'https://ocula.com/magazine/', 8, {
    adapter: 'excluded_cloudflare',
    priority: 'P3',
    intervalMinutes: 0,
    defaultCategory: 'kultur-sanat',
    enabled: false,
    disabledReason: 'Cloudflare insan doğrulaması; otomasyona alınmayacak.'
  })
];
