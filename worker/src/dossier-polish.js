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

export function splitSources(contentHtml = '') {
  // Source headings have an inline font-size in generated drafts; protect the entire section from AI rewrites.
  const html = String(contentHtml);
  const match = /<h2\b[^>]*>\s*Kaynaklar ve ileri okuma\s*<\/h2>/i.exec(html);
  if (!match) return { body: html, sources: '' };
  return { body: html.slice(0, match.index), sources: html.slice(match.index) };
}

export function narrativeQualityHints() {
  return [
    'Suzhou nakışı dosyasındaki gibi akıcı bir Türkiye Türkçesi haber dili kullan: açıklayıcı, canlı ve yalın; akademik makale veya sanatçı kataloğu üslubu kullanma.',
    'İlk iki paragrafta konuyu ve önemini anlaşılır biçimde tanıt. Somut bir eser, malzeme veya teknik ayrıntıyla aç; kaynakta olmayan hayalî sahne, atölye ziyareti veya tanıklık oluşturma.',
    'Anlatıda tarihsel gelişim, sanatın ayırt edici teknik ve estetik özellikleri, değişim süreci ve günümüzdeki durum birbiriyle bağlantılı olsun. Bölümler neden-sonuç ilişkisiyle birbirini izlesin; kronolojiyi ansiklopedi listesine çevirme.',
    'Bir hanedanın, sanatçının veya tekniğin adını anarken neden önemli olduğunu kısa ve somut biçimde açıkla; mümkünse doğrulanmış eser, kullanım veya üretim örneğine bağla.',
    'Sanatın nasıl üretildiğini okurun gözünde canlandıracak sade açıklamalar kullan; jargon, uzun Çince terim dizileri ve gereksiz pinyin tekrarlarını çıkar.',
    'Günümüzdeki eğitim, üretim, kullanım ve koruma örneklerini yalnız doğrulanmış bilgilerle anlat; geçmişten bugüne geçişi ani veya kopuk bırakma.',
    'Paragraflar genellikle 2-4 cümle olsun; fazla alt başlıkları birleştir, tekrarlanan bilgi ve soyut geçiş cümlelerini sil.',
    'Etken fiiller ve kısa, doğal Türkçe cümleler kullan. “Önem arz etmektedir”, “görsel dil kurar”, “yeniden tarif eder”, “salt ... değil” gibi çeviri kokan veya yapay soyut kalıpları ancak gerçekten yerindeyse kullan.',
    'Başlık merak uyandırsın ancak bilgi taşıyan mevcut başlığı gereksiz yere değiştirme. Spot başlığı tekrar etmeden konunun önemini anlatsın.',
    'Son paragraf tarihsel gelişim ile bugünkü yaşantıyı doğal ve somut bir gözlemde birleştirsin; aforizma, retorik soru veya yapay bir sonuç cümlesi üretme.',
    'Doğrulanmış olgu havuzunda bulunmayan tarih, kişi, sayı, kurum, eser, teknik ayrıntı ve güncel iddia ekleme.'
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
        'Çince eser, teknik, akım ve kültürel kavramlarda ilk taslakta doğrulanmış Türkçe karşılık + özgün Çince ad + pinyin kullanılmışsa şu kısa standardı koru: Doğal Türkçe Karşılık (“中文名称”, Pinyin). Sonraki kullanımlarda yalnız Türkçe karşılığı kullan. Çince ad veya pinyin araştırmada doğrulanmamışsa ekleme.',
        '5-7 anlamlı H2 başlık kullan. Her bölüm tarihsel gelişim, ayırt edici özellikler veya günümüzle ilgili bir katkı sunsun; ders kitabı biçiminde bölme.',
        'Mevcut doğrulanmış olguların anlamını değiştirme ve kaynaklarda olmayan iddia ekleme.',
        'Görsel HTML ekleme; sistem görselleri daha sonra yerleştirecek.',
        'Yalnız geçerli JSON döndür.'
      ].join(' ')
    }, {
      role: 'user',
      content: [
        `Konu: ${research?.topic?.title || article.title}`,
        `Doğrulanmış olgular: ${JSON.stringify(research?.facts || [])}`,
        `Doğrulanmış terimler: ${JSON.stringify(research?.glossary || [])}`,
        `Mevcut başlık: ${article.title}`,
        `Mevcut spot: ${article.excerpt}`,
        `Mevcut gövde (${originalCount} kelime): ${body}`,
        'Metni 1200-1800 Türkçe kelime aralığında, Suzhou nakışı revizyonundaki gibi anlaşılır kültür-sanat haber diliyle yeniden yaz. Tarihsel gelişim → ayırt edici özellikler → günümüzdeki durum bağını güçlendir; kaynak listesini yazma veya değiştirme.',
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
    editorialPass: 'connected-news-feature-v3'
  };
}
