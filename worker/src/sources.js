export const CATEGORIES = [
  { slug: 'kultur-sanat', name: 'Kültür & Sanat' },
  { slug: 'sinema', name: 'Sinema' },
  { slug: 'moda-tasarim', name: 'Moda & Tasarım' },
  { slug: 'sehir-yasam', name: 'Şehir & Yaşam' }
];

const rss = (id, name, feedUrl, url, quality, defaultCategory = null, enabled = true) => ({
  id, name, mode: 'rss', feedUrl, url, quality, defaultCategory, enabled
});

const html = (id, name, url, quality, defaultCategory = null, browser = false, enabled = true) => ({
  id, name, mode: 'html', url, quality, defaultCategory, browser, enabled
});

export const SOURCES = [
  html('china-daily-culture', 'China Daily – Culture', 'https://www.chinadaily.com.cn/culture', 10),
  html('xinhua-en-culture', 'Xinhua – Culture English', 'https://english.news.cn/culture/index.htm', 10),
  html('xinhua-zh-culture', 'Xinhua – Culture (Chinese)', 'https://www.news.cn/culture/', 10),
  html('global-times-arts', 'Global Times – Arts', 'https://www.globaltimes.cn/arts/', 8, null, true),
  html('scmp-arts-culture', 'SCMP – Arts & Culture', 'https://www.scmp.com/lifestyle/arts-culture', 9, 'kultur-sanat', true),
  rss('china-news-culture', 'China News Service – Culture', 'https://www.chinanews.com.cn/rss/culture.xml', 'https://www.chinanews.com.cn/wy/', 10),
  html('gmw-culture', 'Guangming Daily – Culture', 'https://culture.gmw.cn/', 9, 'kultur-sanat'),
  html('people-zh-culture', 'People’s Daily – Culture (Chinese)', 'https://culture.people.com.cn/', 9, 'kultur-sanat', true, false),
  html('people-en-culture', 'People’s Daily Online – Culture', 'https://en.people.cn/90782/index.html', 8, 'kultur-sanat'),
  html('cgtn-culture', 'CGTN – Culture', 'https://www.cgtn.com/culture', 9),
  html('chinaculture', 'Chinaculture.org – News', 'https://en.chinaculture.org/news', 10, null),
  rss('sixth-tone', 'Sixth Tone', 'https://api.sixthtone.com/cont/output/rssApi', 'https://www.sixthtone.com/', 9, null, false),
  rss('1905-film', '1905.com – Film', 'https://www.1905.com/rss.php?rssid=54', 'https://www.1905.com/news/', 10, 'sinema'),
  html('film-administration', 'China Film Administration', 'https://www.chinafilm.gov.cn/', 10, 'sinema'),
  html('vogue-china', 'VOGUE China', 'https://www.vogue.com.cn/', 9, 'moda-tasarim'),
  html('nowre', 'NOWRE', 'https://nowre.com/', 9, 'moda-tasarim'),
  html('beijing-latest', 'Beijing Official – Latest', 'https://english.beijing.gov.cn/latest/news/', 9, 'sehir-yasam'),
  html('beijing-events', 'Beijing Official – Events', 'https://english.beijing.gov.cn/whatson/events/index.html', 9, 'sehir-yasam'),
  html('shanghai-latest', 'Shanghai Official – Latest', 'https://english.shanghai.gov.cn/en-Latest-WhatsNew/', 9, 'sehir-yasam'),
  html('shanghai-events', 'Shanghai Official – Events', 'https://english.shanghai.gov.cn/en-Events/index.html', 9, 'sehir-yasam'),
  rss('ichongqing', 'iChongqing', 'https://www.ichongqing.info/feed/', 'https://www.ichongqing.info/culture/', 9, 'sehir-yasam'),
  html('city-news-service', 'City News Service / Shanghai Daily', 'https://www.citynewsservice.cn/news/', 8, 'sehir-yasam'),
  html('artron', 'Artron Art', 'https://news.artron.net/', 9, 'kultur-sanat'),
  html('art-journal-cn', 'The Art Newspaper China', 'https://www.theartjournal.cn/', 8, 'kultur-sanat'),
  html('lifeweek', 'Sanlian Lifeweek', 'https://www.lifeweek.com.cn/', 8, null, false, false),
  html('the-paper', 'The Paper', 'https://www.thepaper.cn/', 8, null, true),
  html('china-film-news', 'China Film News', 'https://www.chinafilmnews.cn/', 9, 'sinema', false, false),
  html('modern-weekly', 'Modern Weekly', 'https://www.modernweekly.com/', 8, 'moda-tasarim'),
  html('gq-china', 'GQ China', 'https://www.gq.com.cn/', 8, 'moda-tasarim'),
  html('hangzhou', 'Hangzhou Official', 'https://www.ehangzhou.gov.cn/', 9, 'sehir-yasam'),
  html('gochengdu', 'GoChengdu', 'https://www.gochengdu.cn/', 7, 'sehir-yasam', true),
  html('jiangsu-now', 'JiangsuNow / JSChina', 'https://english.jschina.com.cn/', 7, 'sehir-yasam', false, false),
  html('hunan', 'Hunan Government – News & Events', 'https://www.enghunan.gov.cn/News/', 7, 'sehir-yasam', false, false),
  html('ecns-culture', 'ECNS – Culture', 'https://www.ecns.cn/culture/', 7, 'kultur-sanat', false, false)
];
