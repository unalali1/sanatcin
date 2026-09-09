const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu;
const TURKISH_WORD_PATTERN = /\b(?:ve|bir|bu|için|ile|olarak|olan|daha|ancak|ise|göre|tarafından|üzerine|arasında|sonra|önce)\b/giu;
const BAD_IMAGE_PATTERN = /(?:^|[\/_-])(?:logo|avatar|icon|placeholder|default|sprite|qrcode|qr-code)(?:[\/_\.\?-]|$)/i;

export function countCjk(value = '') {
  return value.match(CJK_PATTERN)?.length ?? 0;
}

export function translationIssues({ title = '', excerpt = '', text = '' }) {
  const issues = [];
  const combined = `${title}\n${excerpt}\n${text}`.trim();
  if (text.trim().length < 300) issues.push('Türkçe haber gövdesi 300 karakterden kısa.');
  if (countCjk(combined) > 0) issues.push('Metinde çevrilmemiş Çince karakterler bulunuyor.');
  const words = text.match(/\p{L}+/gu) ?? [];
  const turkishSignals = text.match(TURKISH_WORD_PATTERN)?.length ?? 0;
  if (words.length >= 80 && turkishSignals < 4) issues.push('Metin akıcı Türkçe haber dili olarak doğrulanamadı.');
  if (title.trim().length < 20 || title.trim().length > 120) issues.push('Başlık uzunluğu uygun değil.');
  if (excerpt.trim().length < 80 || excerpt.trim().length > 240) issues.push('Spot uzunluğu uygun değil.');
  return issues;
}

export function assertTranslationQuality(article) {
  const issues = translationIssues(article);
  if (issues.length) throw new Error(`Çeviri kalite kontrolü başarısız: ${issues.join(' ')}`);
}

export function isUsableImageUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (BAD_IMAGE_PATTERN.test(`${url.pathname}${url.search}`)) return false;
    if (/\.(?:svg|gif)(?:$|\?)/i.test(`${url.pathname}${url.search}`)) return false;
    return true;
  } catch {
    return false;
  }
}

