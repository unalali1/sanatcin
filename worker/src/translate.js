import OpenAI from 'openai';
import { config } from './config.js';

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
      { role: 'system', content: 'Profesyonel bir Türkçe haber çevirmenisin. Metni eksiksiz çevir; özetleme, yorum ekleme, paragraf atlama. Özel adları ve sayıları koru. Akıcı Türkçe haber dili kullan. Yalnız çeviriyi ver.' },
      { role: 'user', content: `Bu, haberin ${index + 1}/${total} bölümüdür:\n\n${text}` }
    ]
  });
  return response.output_text.trim();
}

async function createMetadata(article, translatedText) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      { role: 'system', content: 'Bir Türkçe kültür-sanat sitesinin editörüsün. Geçerli JSON dışında hiçbir şey yazma.' },
      { role: 'user', content: `Kaynak başlığı: ${article.title}\nKategori: ${article.category}\nMetin: ${translatedText.slice(0, 5000)}\n\nŞu JSON biçiminde Türkçe metadata üret: {"title":"60-90 karakterlik haber başlığı","excerpt":"140-180 karakterlik spot","tags":["en fazla 5 etiket"]}` }
    ]
  });
  const raw = response.output_text.replace(/^```json\s*|\s*```$/g, '').trim();
  return JSON.parse(raw);
}

export async function translateArticle(article) {
  const parts = chunks(article.text);
  const translated = [];
  for (let index = 0; index < parts.length; index += 1) {
    translated.push(await translateChunk(parts[index], index, parts.length));
  }
  const fullText = translated.join('\n\n');
  const metadata = await createMetadata(article, fullText);
  const bodyHtml = fullText.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n');
  return { ...article, ...metadata, bodyHtml };
}

