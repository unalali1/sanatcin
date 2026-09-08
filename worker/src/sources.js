export const CATEGORIES = [
  { slug: 'kultur-sanat', name: 'Kültür & Sanat' },
  { slug: 'sinema', name: 'Sinema' },
  { slug: 'moda-tasarim', name: 'Moda & Tasarım' },
  { slug: 'sehir-yasam', name: 'Şehir & Yaşam' }
];

const rss = (id, name, feedUrl, url, quality, defaultCategory = null) => ({
  id, name, mode: 'rss', feedUrl, url, quality, defaultCategory, enabled: true
});

const html = (id, name, url, quality, defaultCategory = null, browser = false) => ({
  id, name, mode: 'html', url, quality, defaultCategory, browser, enabled: true
});

export const SOURCES = [
  html('china-daily-culture', 'China Daily – Culture', 'https://www.chinadaily.com.cn/culture', 10),
  html('xinhua-en-culture', 'Xinhua – Culture English', 'https://english.news.cn/culture/index.htm', 10),
  html('xinhua-zh-culture', 'Xinhua – 文化', 'https://www.news.cn/culture/', 10),
  html('global-times-arts', 'Global Times – Arts', 'https://www.globaltimes.cn/arts/', 8, null, true),
  html('scmp-arts-culture', 'SCMP – Arts & Culture', 'https://www.scmp.com/lifestyle/arts-culture', 9, 'kultur-sanat', true),
  rss('china-news-culture', '中国新闻网 – 文化/文娱', 'https://www.chinanews.com.cn/rss/culture.xml', 'https://www.chinanews.com.cn/wy/', 10),
  html('gmw-culture', '光明网 – 文化', 'https://culture.gmw.cn/', 9, 'kultur-sanat'),
  html('people-zh-culture', '人民网 – 文化', 'https://culture.people.com.cn/', 9, 'kultur-sanat', true),
  html('people-en-culture', 'People’s Daily Online – Culture', 'https://en.people.cn/90782/index.html', 8, 'kultur-sanat'),
  html('cgtn-culture', 'CGTN – Culture', 'https://www.cgtn.com/culture', 9),
  html('chinaculture', 'Chinaculture.org', 'https://en.chinaculture.org/', 9, 'kultur-sanat'),
  rss('sixth-tone', 'Sixth Tone', 'https://api.sixthtone.com/cont/output/rssApi', 'https://www.sixthtone.com/', 9),
  rss('1905-film', '1905电影网', 'https://www.1905.com/rss.php?rssid=54', 'https://www.1905.com/news/', 10, 'sinema'),
  html('film-administration', '国家电影局', 'https://www.chinafilm.gov.cn/', 10, 'sinema'),
  html('vogue-china', 'VOGUE China', 'https://www.vogue.com.cn/', 9, 'moda-tasarim'),
  html('nowre', 'NOWRE 现客', 'https://nowre.com/', 9, 'moda-tasarim'),
  html('beijing-latest', 'Beijing Official – Latest', 'https://english.beijing.gov.cn/latest/news/', 9, 'sehir-yasam'),
  html('beijing-events', 'Beijing Official – Events', 'https://english.beijing.gov.cn/whatson/events/index.html', 9, 'sehir-yasam'),
  html('shanghai-latest', 'Shanghai Official – Latest', 'https://english.shanghai.gov.cn/en-Latest-WhatsNew/', 9, 'sehir-yasam'),
  html('shanghai-events', 'Shanghai Official – Events', 'https://english.shanghai.gov.cn/en-Events/index.html', 9, 'sehir-yasam'),
  rss('ichongqing', 'iChongqing', 'https://www.ichongqing.info/feed/', 'https://www.ichongqing.info/culture/', 9, 'sehir-yasam'),
  html('city-news-service', 'City News Service / Shanghai Daily', 'https://www.citynewsservice.cn/news/', 8, 'sehir-yasam'),
  html('artron', '雅昌艺术网', 'https://news.artron.net/', 9, 'kultur-sanat'),
  html('art-journal-cn', '艺术新闻中文版', 'https://www.theartjournal.cn/', 8, 'kultur-sanat'),
  html('lifeweek', '三联生活周刊', 'https://www.lifeweek.com.cn/', 8),
  html('the-paper', '澎湃新闻', 'https://www.thepaper.cn/', 8, null, true),
  html('china-film-news', '中国电影报', 'https://www.chinafilmnews.cn/', 9, 'sinema'),
  html('modern-weekly', '周末画报', 'https://www.modernweekly.com/', 8, 'moda-tasarim'),
  html('gq-china', 'GQ China', 'https://www.gq.com.cn/', 8, 'moda-tasarim'),
  html('hangzhou', 'Hangzhou Official', 'https://www.ehangzhou.gov.cn/', 9, 'sehir-yasam'),
  html('gochengdu', 'GoChengdu', 'https://www.gochengdu.cn/', 7, 'sehir-yasam', true),
  html('jiangsu-now', 'JiangsuNow / JSChina', 'https://english.jschina.com.cn/', 7, 'sehir-yasam'),
  html('hunan', 'Hunan Government – News & Events', 'https://www.enghunan.gov.cn/News/', 7, 'sehir-yasam'),
  html('ecns-culture', 'ECNS – Culture', 'https://www.ecns.cn/culture/', 7, 'kultur-sanat')
];

