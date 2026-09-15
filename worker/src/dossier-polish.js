import OpenAI from 'openai';
import { load } from 'cheerio';

function text(value = '') {
  return load(`<div>${String(value ?? '')}</div>`).text().replace(/\s+/g, ' ').trim();
}

function parseJson(value) {
  const raw = String(value ?? '').replace(/^```json\s*|\s*```$/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Dosya polish modeli geçerli JSON döndürmedi.');
  return JSON.parse(raw.slice(start, end + 1));
}

function wordCountHtml(html = '') {
  return text(html).split(/\s+/).filter(Boolean).length;
}

function splitSources(contentHtml = '') {
  const marker = '<h2>Kaynaklar ve ileri okuma</h2>';
  const index = String(contentHtml).indexOf(marker);
  if (index < 0) return { body: String(contentHtml), sources: '' };
  return {
    body: String(contentHtml).slice(0, index),
    sources: String(contentHtml).slice(index)
  };
}

export function narrativeQualityHints() {
  return [
    'Bir ansiklopedi maddesi gibi değil, kültür-sanat dergisinde okunacak bir dosya gibi yaz.',
    'Girişi somut bir görüntü, hareket, malzeme, atölye ayrıntısı veya eser karşılaşmasıyla aç; “X şudur” tanımıyla başlama.',
    'Kronolojiyi bilgi yığınına çevirmek yerine neden-sonuç ve insan deneyimi üzerinden birbirine bağla.',
    'Paragraflar genellikle 2-4 cümle olsun; art arda uzun açıklama blokları kurma.',
    'Tarih ve teknik ayrıntıları anlatının içine yedir; her paragrafta yeni bir tarih veya terim sıralama.',
    'Okuru taşıyan doğal geçişler kullan. “Bu nedenle”, “böylece” gibi bağlaçları mekanik biçimde tekrarlama.',
    'Türkçesi doğal ve akıcı olsun; çeviri kokan tamlamalardan, akademik pasif dilden ve “önem arz etmektedir” türü kalıplardan kaçın.',
    'Merak uyandır ama clickbait yapma; metin sonunda ana fikri güçlü bir gözlemle kapat.',
    'Doğrulanmış bilgi havuzunda olmayan tarih, kişi, sayı, kurum, eser veya teknik ayrıntı ekleme.'
  ];
}

export async function polishDossierArticle(article, research, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.DOSSIER_EDITOR_MODEL || process.env.OPENAI_EDITOR_MODEL || 'gpt-5.6-terra',
  signal
} = {}) {
  if (!apiKey) return article;
  const { body, sources } = splitSources(article.contentHtml);
  const originalCount = wordCountHtml(body);
  const client = new OpenAI({ apiKey, timeout: 150000, maxRetries: 1 });
  const response = await client.responses.create({
    model,
    input: [{
      role: 'system',
      content: [
        'SanatÇin için kıdemli Türkçe kültür-sanat özellik editörüsün.',
        'Elindeki metin fact-check edilmiş bir dosyadır. Görevin yeni araştırma yapmak değil, anlatıyı daha akıcı, canlı ve dergi kalitesinde yeniden kurmaktır.',
        ...narrativeQualityHints(),
        'Çince terimleri ilk kullanımda Türkçe ad + karakter + pinyin biçiminde koru; sonraki kullanımlarda Türkçe ad yeterlidir.',
        '5-8 anlamlı H2 başlık kullan. Başlıkları ders kitabı gibi değil, anlatıyı ilerletecek şekilde kur.',
        'Mevcut doğrulanmış olguların anlamını değiştirme ve kaynaklarda olmayan iddia ekleme.',
        'Görsel HTML ekleme; sistem görselleri daha sonra yerleştirecek.',
        'Yalnız geçerli JSON döndür.'
      ].join(' ')
    }, {
      role: 'user',
      content: [
        `Konu: ${research?.topic?.title || article.title}`,
        `Doğrulanmış olgular: ${JSON.stringify(research?.facts || [])}`,
        `Mevcut başlık: ${article.title}`,
        `Mevcut spot: ${article.excerpt}`,
        `Mevcut gövde (${originalCount} kelime): ${body}`,
        'Metni 1200-1800 Türkçe kelime aralığında, daha hikâye odaklı ve akıcı biçimde yeniden yaz.',
        'JSON: {"title":"...","excerpt":"110-190 karakter","contentHtml":"<p>...</p><h2>...</h2>...","seoDescription":"..."}'
      ].join('\n')
    }]
  }, { signal });

  const raw = parseJson(response.output_text);
  const polishedBody = String(raw?.contentHtml || '').trim();
  const count = wordCountHtml(polishedBody);
  if (!polishedBody || count < 1050 || count > 2050) return article;
  const title = text(raw?.title || article.title).slice(0, 120);
  const excerpt = text(raw?.excerpt || article.excerpt).slice(0, 240);
  if (title.length < 28 || excerpt.length < 90) return article;
  return {
    ...article,
    title,
    excerpt,
    seoDescription: text(raw?.seoDescription || article.seoDescription).slice(0, 220),
    contentHtml: `${polishedBody}${sources}`,
    wordCount: count,
    editorialPass: 'narrative-feature-v2'
  };
}
