import OpenAI from 'openai';
import { config } from './config.js';
import { assertTranslationQuality, translationIssues } from './quality.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

function chunks(text, maxChars = 6000) {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const output = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      output.push(current);
      current = '';
    }
    current += `${current ? '\n\n' : ''}${paragraph}`;
  }
  if (current) output.push(current);
  return output;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

async function translateChunk(text, index, total) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'Çince ve İngilizce bilen kıdemli bir Türkçe haber çevirmeni ve editörüsün.',
          'Kaynak metindeki doğrulanabilir bilgileri eksiksiz koru; bilgi ekleme, tahmin yürütme veya abartma.',
          'Kelime kelime çeviri yapma; doğal, açık ve profesyonel Türkçe haber dili kullan.',
          'Çince kişi ve yer adlarını standart Hanyu Pinyin yazımıyla Latin harflerine aktar.',
          'Başlıklar dahil hiçbir Çince karakter bırakma.',
          'Fotoğraf altyazılarını, fotoğraf kredilerini, editör notlarını, navigasyon kalıntılarını ve “son/编辑/记者/摄/供图” türü kaynak sitesi artıklarını çıkar.',
          'Yalnızca Türkçe haber metnini ver.'
        ].join(' ')
      },
      { role: 'user', content: `Bu, haberin ${index + 1}/${total} bölümüdür:\n\n${text}` }
    ]
  });
  return response.output_text.trim();
}

async function polishChunk(sourceText, draft, index, total, problems = []) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: [
          'Kıdemli bir Türkçe kültür-sanat haber editörüsün.',
          'Taslağı kaynak metinle karşılaştır ve anlam hatalarını düzelt.',
          'Bütün yabancı cümleleri Türkçeye çevir; hiçbir Çince karakter bırakma.',
          'Özel adları standart Latin harfli yazımla ver.',
          'Düşük kaliteli makine çevirisi kalıplarını temizle, cümleleri doğal Türkçe söz dizimiyle yeniden kur.',
          'Yeni bilgi ekleme, özetleme veya yorum yapma.',
          'Fotoğraf kredilerini ve editoryal artıkları çıkar.',
          'Yalnızca yayıma hazır Türkçe gövde metnini ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Bölüm ${index + 1}/${total}\n${problems.length ? `Düzeltilmesi gereken sorunlar: ${problems.join(' ')}\n` : ''}\nKAYNAK:\n${sourceText}\n\nTÜRKÇE TASLAK:\n${draft}`
      }
    ]
  });
  return response.output_text.trim();
}

async function createMetadata(article, translatedText, problems = []) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: 'Bir Türkçe kültür-sanat sitesinin kıdemli editörüsün. Başlık ve spot tamamen Türkçe olmalı; Çince karakter kullanma. Özel adları Latin harfleriyle yaz. Geçerli JSON dışında hiçbir şey yazma.'
      },
      {
        role: 'user',
        content: `${problems.length ? `Önceki denemedeki sorunlar: ${problems.join(' ')}\n` : ''}Kaynak başlığı: ${article.title}\nKategori: ${article.category}\nMetin: ${translatedText.slice(0, 6000)}\n\nŞu JSON biçiminde Türkçe metadata üret: {"title":"60-100 karakterlik doğal haber başlığı","excerpt":"140-200 karakterlik haber spotu","tags":["en fazla 5 etiket"]}`
      }
    ]
  });
  const raw = response.output_text.replace(/^```json\s*|\s*```$/g, '').trim();
  return JSON.parse(raw);
}

export async function translateArticle(article) {
  const sourceParts = chunks(article.text);
  const editedParts = [];
  for (let index = 0; index < sourceParts.length; index += 1) {
    const draft = await translateChunk(sourceParts[index], index, sourceParts.length);
    let edited = await polishChunk(sourceParts[index], draft, index, sourceParts.length);
    const problems = translationIssues({ title: 'Geçici haber başlığı kontrolü', excerpt: 'Geçici spot metni yalnızca gövde kalite kontrolü için yeterli uzunlukta hazırlanmıştır.', text: edited })
      .filter((item) => !item.startsWith('Başlık') && !item.startsWith('Spot'));
    if (problems.length) edited = await polishChunk(sourceParts[index], edited, index, sourceParts.length, problems);
    editedParts.push(edited);
  }

  const fullText = editedParts.join('\n\n');
  let metadata = await createMetadata(article, fullText);
  let issues = translationIssues({ ...metadata, text: fullText });
  if (issues.some((item) => item.startsWith('Başlık') || item.startsWith('Spot') || item.includes('Çince'))) {
    metadata = await createMetadata(article, fullText, issues);
    issues = translationIssues({ ...metadata, text: fullText });
  }
  assertTranslationQuality({ ...metadata, text: fullText });
  const bodyHtml = fullText.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n');
  return { ...article, ...metadata, bodyHtml };
}

