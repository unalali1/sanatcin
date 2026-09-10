import OpenAI from 'openai';
import { config } from './config.js';
import { assertTranslationQuality, translationIssues } from './quality.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

function parseJson(value) {
  return JSON.parse(String(value).replace(/^```json\s*|\s*```$/g, '').trim());
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeDraft(article, draft) {
  const paragraphs = (Array.isArray(draft.paragraphs) ? draft.paragraphs : []).map(cleanString).filter(Boolean);
  const text = paragraphs.join('\n\n');
  const tags = [...new Set((Array.isArray(draft.tags) ? draft.tags : []).map(cleanString).filter(Boolean))].slice(0, 5);
  return {
    ...article,
    title: cleanString(draft.title),
    excerpt: cleanString(draft.excerpt),
    paragraphs,
    text,
    tags,
    bodyHtml: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')
  };
}

function sourceExcerpt(text, maxChars = 24_000) {
  const compact = String(text ?? '').trim();
  if (compact.length <= maxChars) return compact;
  const head = compact.slice(0, Math.floor(maxChars * 0.78));
  const tail = compact.slice(-Math.floor(maxChars * 0.22));
  return `${head}\n\n[KAYNAK METNİN ORTA BÖLÜMÜ UZUNLUK NEDENİYLE KISALTILDI]\n\n${tail}`;
}

async function extractFactSheet(article) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'Çince ve İngilizce kaynakları denetleyen bir doğrulama editörüsün.',
          'Kaynakta açıkça bulunan olguları çıkar; hiçbir bilgi, yorum, bağlam veya alıntı uydurma.',
          'Sayıları, tarihleri, kişi ve kurum adlarını aynen koru.',
          'Çince adlar için kaynakta Latin yazımı varsa onu kullan; yoksa standart Hanyu Pinyin kullan.',
          'Tanıtım dili, site navigasyonu, telif satırları ve görsel altyazılarını olgu sayma.',
          'Kaynağın tam haber mi, kısa duyuru mu, fotoğraf galerisi mi olduğunu sınıflandır.',
          'En az beş bağımsız somut olgu ve açık bir haber değeri yoksa publishable=false ver.',
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
          'JSON şeması: {"publishable":true,"sourceType":"article|interview|review|announcement|gallery","newsValue":"neden güncel ve haber değeri taşıyor","angle":"haberin somut gelişmesi","facts":["doğrulanmış olgu"],"people":["kişi"],"organisations":["kurum"],"places":["yer"],"numbers":["sayı veya tarih"],"quotes":[{"speaker":"konuşan","text":"kaynakta gerçekten bulunan kısa alıntı"}],"context":["kaynakta bulunan arka plan bilgisi"]}'
        ].join('\n\n')
      }
    ]
  });
  const sheet = parseJson(response.output_text);
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
    quotes: (Array.isArray(sheet.quotes) ? sheet.quotes : []).map((quote) => ({ speaker: cleanString(quote?.speaker), text: cleanString(quote?.text) })).filter((quote) => quote.text).slice(0, 8),
    context: list(sheet.context, 15)
  };
}

async function writeNewsroomDraft(article, factSheet, feedback = []) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'SanatÇin için çalışan kıdemli bir Türkçe kültür-sanat haber editörüsün.',
          'Çeviri yapma; doğrulanmış olgu fişini kullanarak doğal Türkçe haber yaz.',
          'Türkçe cümle kuruluşunu kullan; kaynak dilin sözdizimini ve kalıplarını taşıma.',
          'Çin yer adlarında yerleşik Türkçe karşılıkları kullan: Beijing yerine Pekin gibi. Türkçede karşılığı olan kurum adlarını çevir; gerekli olduğunda özgün adı ilk kullanımda parantez içinde bir kez ver.',
          'Ham Pinyin kurum zincirleri, kaynak metni yorumlayan editör notları ve “metinde belirtilmiyor”, “daha fazla bilgi için kaynak” gibi ifadeler kullanma.',
          'İlk paragrafta kim-ne-nerede-ne zaman bilgisini ver, sonraki paragraflarda önem ve bağlamı açıkla.',
          'Olgu fişinde bulunmayan bilgi, sıfat, neden-sonuç ilişkisi, duygu, alıntı veya hüküm ekleme.',
          'Basın bülteni övgülerini ve propaganda dilini tarafsızlaştır.',
          'Başlık somut gelişmeyi anlatsın, 32-82 karakter olsun; iki nokta ve uzun zincir tamlamaları sınırlı kullan.',
          'Spot 105-180 karakterlik tek cümle olsun ve başlığı tekrarlamasın.',
          'Gövde 4-7 kısa paragraf, en az 650 karakter olsun. Hiçbir Çince karakter bırakma.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          feedback.length ? `Önceki taslaktaki sorunları gider: ${feedback.join(' | ')}` : '',
          `Kategori: ${article.category}`,
          `Kaynak: ${article.source.name}`,
          `Doğrulanmış olgu fişi:\n${JSON.stringify(factSheet)}`,
          'JSON şeması: {"title":"32-82 karakter","excerpt":"105-180 karakter","paragraphs":["paragraf 1","paragraf 2","paragraf 3","paragraf 4"],"tags":["en fazla 5 etiket"]}'
        ].filter(Boolean).join('\n\n')
      }
    ]
  });
  return normalizeDraft(article, parseJson(response.output_text));
}

async function copyEditDraft(article, factSheet, draft, feedback = []) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'Ulusal bir kültür-sanat yayınında çalışan Türkçe haber redaktörüsün.',
          'Taslağı kelime kelime çevrilmiş hissini tamamen giderecek biçimde yeniden yaz.',
          'Akıcı, açık, tarafsız ve yaşayan Türkiye Türkçesi kullan; devrik, yapay ve zincirleme tamlamaları düzelt.',
          'Pekin gibi yerleşik Türkçe adları kullan; ham Pinyin kurum adlarını doğal Türkçe karşılıklarıyla açıkla.',
          'Kaynak metne ilişkin editör notu, eksik bilgi uyarısı, okura yönlendirme veya süreç açıklaması yazma.',
          'Başlık, spot ve ilk paragraftaki tekrarları kaldır. Paragraflar arasında mantıklı akış kur.',
          'Özel ad, tarih, sayı, alıntı ve olayları olgu fişinin dışına çıkarma; yeni bilgi ekleme.',
          'Başlık 32-82, spot 105-180 karakter; gövde 4-7 paragraf ve en az 650 karakter olmalı.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          feedback.length ? `Mutlaka düzeltilecek sorunlar: ${feedback.join(' | ')}` : '',
          `Doğrulanmış olgu fişi:\n${JSON.stringify(factSheet)}`,
          `Ham Türkçe taslak:\n${JSON.stringify({ title: draft.title, excerpt: draft.excerpt, paragraphs: draft.paragraphs, tags: draft.tags })}`,
          'JSON şeması: {"title":"başlık","excerpt":"spot","paragraphs":["paragraf"],"tags":["etiket"]}'
        ].filter(Boolean).join('\n\n')
      }
    ]
  });
  return normalizeDraft(article, parseJson(response.output_text));
}

async function auditDraft(factSheet, draft) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'Türkçe haber taslağını doğrulanmış olgu fişiyle karşılaştıran son yayın denetçisisin.',
          'Şu koşulların hepsi sağlanmadıkça accepted=false ver:',
          'başlık, spot ve gövdedeki her somut iddia olgu fişince desteklenir;',
          'kişi, kurum, yer, tarih, sayı ve alıntılar değiştirilmemiştir;',
          'metin doğal Türkiye Türkçesiyle yazılmıştır ve çeviri kokusu taşımaz;',
          'açıklanmamış Pinyin kurum zinciri, kaynak-metin yorumu veya editoryal süreç notu yoktur;',
          'başlık somuttur, spot başlığı tekrarlamaz, giriş temel haberi açıklar;',
          'metin reklam, propaganda, navigasyon, yasal site artığı veya Çince karakter içermez.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `OLGU FİŞİ:\n${JSON.stringify(factSheet)}\n\nTÜRKÇE TASLAK:\n${JSON.stringify({ title: draft.title, excerpt: draft.excerpt, paragraphs: draft.paragraphs })}\n\nJSON şeması: {"accepted":true,"issues":["kısa ve somut sorun"]}`
      }
    ]
  });
  const result = parseJson(response.output_text);
  return {
    accepted: result.accepted === true,
    issues: (Array.isArray(result.issues) ? result.issues : [result.reason]).map(cleanString).filter(Boolean).slice(0, 8)
  };
}

async function auditTurkishNewsStyle(draft) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'Yalnız Türkçe dil ve haber yazımı kalitesini denetleyen bağımsız bir yazı işleri müdürüsün.',
          'Olgu doğrulaması yapma; metnin doğal Türkiye Türkçesi, açıklık, ritim, başlık ekonomisi ve paragraf akışını değerlendir.',
          'Çeviri kokusu, yapay tamlama, ham Pinyin zinciri, tekrar, dolgu, kaynak metni anlatan editör notu veya ansiklopedik yığılma varsa accepted=false ver.',
          'Bir ulusal kültür-sanat servisinde doğrudan yayımlanabilecek düzey olmadıkça accepted=false ver.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `TASLAK:\n${JSON.stringify({ title: draft.title, excerpt: draft.excerpt, paragraphs: draft.paragraphs })}\n\nJSON şeması: {"accepted":true,"issues":["kısa ve uygulanabilir sorun"]}`
      }
    ]
  });
  const result = parseJson(response.output_text);
  return {
    accepted: result.accepted === true,
    issues: (Array.isArray(result.issues) ? result.issues : [result.reason]).map(cleanString).filter(Boolean).slice(0, 8)
  };
}

export async function translateArticle(article) {
  const factSheet = await extractFactSheet(article);
  if (!factSheet.publishable || !factSheet.angle || !factSheet.newsValue || factSheet.facts.length < 5) {
    throw new Error('Kaynak metin tam, güncel ve olgusal bir haber yazmak için yeterli değil.');
  }

  const firstDraft = await writeNewsroomDraft(article, factSheet);
  let draft = await copyEditDraft(article, factSheet, firstDraft, translationIssues(firstDraft));
  let audit = await auditDraft(factSheet, draft);
  let styleAudit = await auditTurkishNewsStyle(draft);
  let mechanicalIssues = translationIssues(draft);

  if (!audit.accepted || !styleAudit.accepted || mechanicalIssues.length) {
    const feedback = [...new Set([...audit.issues, ...styleAudit.issues, ...mechanicalIssues])];
    draft = await copyEditDraft(article, factSheet, draft, feedback.length ? feedback : ['Daha doğal ve kaynakla tam uyumlu bir Türkçe haber olarak yeniden yaz.']);
    audit = await auditDraft(factSheet, draft);
    styleAudit = await auditTurkishNewsStyle(draft);
    mechanicalIssues = translationIssues(draft);
  }

  if (!audit.accepted) throw new Error(`Editoryal doğrulama başarısız: ${audit.issues.join(' ') || 'gerekçe belirtilmedi'}`);
  if (!styleAudit.accepted) throw new Error(`Türkçe yazı işleri denetimi başarısız: ${styleAudit.issues.join(' ') || 'gerekçe belirtilmedi'}`);
  if (mechanicalIssues.length) throw new Error(`Türkçe mekanik kalite kontrolü başarısız: ${mechanicalIssues.join(' ')}`);
  assertTranslationQuality(draft);
  return { ...draft, factSheet, editorialMode: 'fact-sheet-turkish-newsroom-v3' };
}
