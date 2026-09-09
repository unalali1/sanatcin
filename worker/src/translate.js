import OpenAI from 'openai';
import { config } from './config.js';
import { assertTranslationQuality } from './quality.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

function parseJson(value) {
  return JSON.parse(value.replace(/^```json\s*|\s*```$/g, '').trim());
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeDraft(article, draft) {
  const paragraphs = (Array.isArray(draft.paragraphs) ? draft.paragraphs : [])
    .map(cleanString)
    .filter(Boolean);
  const text = paragraphs.join('\n\n');
  const tags = [...new Set((Array.isArray(draft.tags) ? draft.tags : [])
    .map(cleanString)
    .filter(Boolean))].slice(0, 5);
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

async function createDigest(article, feedback = []) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'SanatÇin için çalışan, Çince ve İngilizce kaynakları okuyabilen kıdemli bir Türkçe haber editörüsün.',
          'Görevin tam metin çevirisi yapmak değil; kaynakta doğrulanabilen bilgilerden özgün, doğal ve telif açısından ölçülü bir Türkçe haber özeti yazmaktır.',
          'Kaynağın cümle yapısını kopyalama. Bilgi, sayı, tarih, unvan, kişi, kurum, eser ve yer adlarını değiştirme; kaynakta olmayan ayrıntı, yorum veya alıntı ekleme.',
          'Çince kişi ve yer adlarını yerleşik Türkçe kullanım varsa onunla, yoksa standart Hanyu Pinyin ile Latin harflerinde yaz. Hiçbir Çince karakter bırakma.',
          'Reklam dili, propaganda, basın bülteni övgüsü, fotoğraf kredisi, editör notu, navigasyon ve yasal site metinlerini çıkar.',
          'Başlık haberin asıl somut gelişmesini anlatsın; sansasyon, kelime kelime çeviri ve belirsiz tamlamalardan kaçın.',
          'Spot başlığı tekrar etmeden haberi bir cümlede özetlesin. Gövde 4-7 kısa paragraf ve en az 700 karakter olsun.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          feedback.length ? `Önceki taslaktaki sorunları gider: ${feedback.join(' | ')}` : '',
          `Kaynak: ${article.source.name}`,
          `Kaynak URL: ${article.url}`,
          `Kaynak başlığı: ${article.title}`,
          `Kategori: ${article.category}`,
          `Kaynak metin:\n${sourceExcerpt(article.text)}`,
          'JSON şeması: {"title":"35-105 karakter","excerpt":"100-220 karakter","paragraphs":["paragraf 1","paragraf 2","paragraf 3","paragraf 4"],"tags":["en fazla 5 etiket"]}'
        ].filter(Boolean).join('\n\n')
      }
    ]
  });
  return normalizeDraft(article, parseJson(response.output_text));
}

async function auditDigest(article, draft) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'Kaynak ile Türkçe haber taslağını karşılaştıran bağımsız bir doğrulama editörüsün.',
          'Aşağıdaki koşulların hepsi sağlanmadıkça accepted=false ver:',
          'haber yalnız kültür-sanat, sinema, moda-tasarım veya şehir yaşamı kapsamındadır;',
          'başlık ve spot gövde tarafından desteklenir; kişi, kurum, tarih, sayı ve olaylar kaynağa sadıktır;',
          'metin doğal Türkçedir ve Çince karakter, reklam, propaganda, navigasyon ya da yasal site artığı içermez;',
          'taslak en az dört paragraftır ve gereksiz tekrar içermez.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `KAYNAK:\n${sourceExcerpt(article.text, 18_000)}\n\nTÜRKÇE TASLAK:\n${JSON.stringify({ title: draft.title, excerpt: draft.excerpt, paragraphs: draft.paragraphs })}\n\nJSON şeması: {"accepted":true,"issues":["kısa ve somut sorun"]}`
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
  let draft = await createDigest(article);
  let audit = await auditDigest(article, draft);
  if (!audit.accepted) {
    draft = await createDigest(article, audit.issues.length ? audit.issues : ['Kaynakla tam uyumlu, doğal bir Türkçe haber olarak yeniden yaz.']);
    audit = await auditDigest(article, draft);
  }
  if (!audit.accepted) throw new Error(`Editoryal doğrulama başarısız: ${audit.issues.join(' ') || 'gerekçe belirtilmedi'}`);
  assertTranslationQuality(draft);
  return { ...draft, editorialMode: 'original-turkish-digest-v1' };
}
