import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './logger.js';
import { assertTranslationQuality, translationIssues } from './quality.js';

// A failed editorial request should move to the next candidate quickly. The old
// pipeline retried every one of its many AI calls and could spend minutes on one
// article before rejecting it.
const client = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.aiRequestTimeoutMs,
  maxRetries: 0
});

function parseJson(value) {
  const compact = String(value).replace(/^```json\s*|\s*```$/g, '').trim();
  const start = compact.indexOf('{');
  const end = compact.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Editoryal model geçerli JSON döndürmedi.');
  return JSON.parse(compact.slice(start, end + 1));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeDraft(article, draft) {
  const paragraphs = (Array.isArray(draft?.paragraphs) ? draft.paragraphs : []).map(cleanString).filter(Boolean);
  const text = paragraphs.join('\n\n');
  const tags = [...new Set((Array.isArray(draft?.tags) ? draft.tags : []).map(cleanString).filter(Boolean))].slice(0, 5);
  return {
    ...article,
    title: cleanString(draft?.title),
    excerpt: cleanString(draft?.excerpt),
    paragraphs,
    text,
    tags,
    bodyHtml: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')
  };
}

function sourceExcerpt(text, maxChars = 18_000) {
  const compact = String(text ?? '').trim();
  if (compact.length <= maxChars) return compact;
  const head = compact.slice(0, Math.floor(maxChars * 0.80));
  const tail = compact.slice(-Math.floor(maxChars * 0.20));
  return `${head}\n\n[KAYNAK METNİN ORTA BÖLÜMÜ KISALTILDI]\n\n${tail}`;
}

function normalizeFactSheet(sheet = {}) {
  const list = (value, limit = 20) => (Array.isArray(value) ? value : []).map(cleanString).filter(Boolean).slice(0, limit);
  return {
    publishable: sheet.publishable === true,
    sourceType: cleanString(sheet.sourceType),
    newsValue: cleanString(sheet.newsValue),
    angle: cleanString(sheet.angle),
    facts: list(sheet.facts, 30),
    people: list(sheet.people),
    organisations: list(sheet.organisations),
    places: list(sheet.places),
    numbers: list(sheet.numbers),
    quotes: (Array.isArray(sheet.quotes) ? sheet.quotes : [])
      .map((quote) => ({ speaker: cleanString(quote?.speaker), text: cleanString(quote?.text) }))
      .filter((quote) => quote.text)
      .slice(0, 8),
    context: list(sheet.context, 15)
  };
}

async function buildGroundedNewsPackage(article, signal) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'SanatÇin için çalışan kıdemli Türkçe kültür-sanat haber editörü ve çevirmenisin.',
          'İngilizce veya Çince kaynak metni önce doğrulanabilir olgulara ayır, ardından aynı yanıtta doğal Türkiye Türkçesiyle özgün bir haber yaz.',
          'Kelime kelime çeviri yapma; Türkçe haber cümlesi kur. Kaynak dilin sözdizimini, yapay tamlamalarını ve tanıtım tonunu taşıma.',
          'Kişi adlarını eksiksiz ve kaynakta kullanılan Latin yazımıyla koru; soyada veya ada kısaltma. Sayı, tarih, yer, kurum, eser ve alıntı anlamlarını değiştirme.',
          'Beijing için Pekin gibi yerleşik Türkçe yer adlarını kullan. Zorunlu olmayan İngilizce etkinlik/kurum adlarını ve “immersif” gibi yabancı sözcükleri metinde bırakma.',
          'Alıntıları anlamını, konuşanını ve ihtiyat düzeyini koruyarak doğal Türkçeye çevir. Kaynakta olmayan alıntı, duygu, sıfat, neden-sonuç veya yorum ekleme.',
          'Kaynak tam bir haber, röportaj, eleştiri, etkinlik haberi ya da açıklayıcı fotoğraf haberiyse; somut bir gelişme ve en az dört doğrulanabilir olgu varsa publishable=true ver.',
          'Kısa ama yeterli bir kültür-sanat haberi yalnız uzun olmadığı için reddedilmemeli. Navigasyon, reklam, salt takvim kaydı veya olgusuz tanıtım metni publishable=false olmalı.',
          'Başlık somut gelişmeyi anlatsın ve 32-82 karakter olsun. Spot başlığı tekrarlamayan 105-180 karakterlik tek cümle olsun.',
          'Gövde 4-7 kısa paragraf ve en az 650 karakter olsun; ilk paragrafta temel haberi açıkla, devamında önem ve kaynakta bulunan bağlamı ver.',
          'Hiçbir Çince karakter, editör notu, süreç açıklaması veya okuru kaynağa yönlendiren dolgu kullanma.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Kaynak: ${article.source.name}`,
          `Kaynak URL: ${article.url}`,
          `Kaynak başlığı: ${article.title}`,
          `Önerilen kategori: ${article.category}`,
          `Kaynak metin:\n${sourceExcerpt(article.text)}`,
          'JSON şeması: {"factSheet":{"publishable":true,"sourceType":"article|interview|review|announcement|gallery","newsValue":"somut haber değeri","angle":"somut gelişme","facts":["doğrulanmış olgu"],"people":["tam kişi adı"],"organisations":["kurum"],"places":["yer"],"numbers":["sayı veya tarih"],"quotes":[{"speaker":"konuşan","text":"kaynak dilindeki kısa alıntı"}],"context":["kaynakta bulunan bağlam"]},"draft":{"title":"32-82 karakter","excerpt":"105-180 karakter","paragraphs":["paragraf 1","paragraf 2","paragraf 3","paragraf 4"],"tags":["en fazla 5 Türkçe etiket"]}}'
        ].join('\n\n')
      }
    ]
  }, { signal });
  const result = parseJson(response.output_text);
  return {
    factSheet: normalizeFactSheet(result.factSheet),
    draft: normalizeDraft(article, result.draft)
  };
}

async function finalizeAndVerify(article, factSheet, draft, feedback, signal) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'SanatÇin son okuma masasındaki kıdemli Türkçe editör ve olgu denetçisisin.',
          'Taslağı kaynak metin ve olgu fişiyle karşılaştır. Düzeltilebilir bir sorun gördüğünde reddetme; metni doğrudan düzelt ve accepted=true ver.',
          'Yalnız kaynağın haber yazmaya gerçekten yetmediği veya giderilemeyen önemli bir çelişki bulunduğu durumda accepted=false ver.',
          'Özel adları eksiksiz koru; Lu ya da Liu gibi kısaltmalar yapma. Sayıları, tarihleri, eser/etkinlik adlarını ve alıntı anlamlarını değiştirme.',
          'Kaynakta geçen her ayrıntıyı kullanmak zorunda değilsin; anlamı bozmayan özetleme, sadeleştirme ve seçme olgu hatası değildir.',
          'Başlığı somutlaştır; spot, başlık ve giriş tekrarlarını gider. Kelime kelime çeviri kokusunu, yapay tamlamaları, yabancı sözcükleri ve propaganda dilini temizle.',
          'Türkiye Türkçesinde akıcı, tarafsız ve yayıma hazır 4-7 kısa paragraf üret. Kaynakta olmayan bilgi ekleme.',
          'Başlık 32-82, spot 105-180 karakter; gövde en az 650 karakter olmalı ve Çince karakter içermemeli.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Kaynak başlığı: ${article.title}`,
          `Kaynak metin:\n${sourceExcerpt(article.text, 14_000)}`,
          `Olgu fişi:\n${JSON.stringify(factSheet)}`,
          `Düzeltilecek Türkçe taslak:\n${JSON.stringify({ title: draft.title, excerpt: draft.excerpt, paragraphs: draft.paragraphs, tags: draft.tags })}`,
          feedback.length ? `Mekanik denetim notları:\n${feedback.join(' | ')}` : '',
          'JSON şeması: {"accepted":true,"issues":[],"title":"başlık","excerpt":"spot","paragraphs":["paragraf"],"tags":["etiket"]}'
        ].filter(Boolean).join('\n\n')
      }
    ]
  }, { signal });
  const result = parseJson(response.output_text);
  return {
    accepted: result.accepted === true,
    issues: (Array.isArray(result.issues) ? result.issues : [result.reason]).map(cleanString).filter(Boolean).slice(0, 8),
    draft: normalizeDraft(article, result)
  };
}

function elapsedSeconds(startedAt) {
  return Math.round((Date.now() - startedAt) / 100) / 10;
}

export async function translateArticle(article, { signal } = {}) {
  const startedAt = Date.now();
  log('info', 'Türkçe haber hazırlığı başladı', { source: article.source.id, url: article.url });

  const newsPackage = await buildGroundedNewsPackage(article, signal);
  const { factSheet } = newsPackage;
  if (!factSheet.publishable || !factSheet.angle || !factSheet.newsValue || factSheet.facts.length < 4) {
    throw new Error('Kaynak metin güncel ve olgusal bir haber yazmak için yeterli değil.');
  }
  log('info', 'Olgu fişi ve ilk Türkçe taslak hazırlandı', {
    source: article.source.id,
    facts: factSheet.facts.length,
    elapsedSeconds: elapsedSeconds(startedAt)
  });

  let final = await finalizeAndVerify(article, factSheet, newsPackage.draft, translationIssues(newsPackage.draft), signal);
  if (!final.accepted) {
    throw new Error(`Editoryal doğrulama başarısız: ${final.issues.join(' ') || 'kaynak ile giderilemeyen çelişki'}`);
  }

  let mechanicalIssues = translationIssues(final.draft);
  if (mechanicalIssues.length) {
    log('warn', 'Son taslakta mekanik sorun bulundu; tek düzeltme uygulanacak', {
      source: article.source.id,
      issues: mechanicalIssues
    });
    final = await finalizeAndVerify(article, factSheet, final.draft, mechanicalIssues, signal);
    mechanicalIssues = translationIssues(final.draft);
  }

  if (!final.accepted) {
    throw new Error(`Editoryal doğrulama başarısız: ${final.issues.join(' ') || 'gerekçe belirtilmedi'}`);
  }
  if (mechanicalIssues.length) {
    throw new Error(`Türkçe mekanik kalite kontrolü başarısız: ${mechanicalIssues.join(' ')}`);
  }
  assertTranslationQuality(final.draft);
  log('info', 'Türkçe haber yayıma hazır', {
    source: article.source.id,
    title: final.draft.title,
    elapsedSeconds: elapsedSeconds(startedAt)
  });
  return { ...final.draft, factSheet, editorialMode: 'grounded-turkish-newsroom-v4' };
}
