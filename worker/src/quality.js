const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu;
const TURKISH_WORD_PATTERN = /\b(?:ve|bir|bu|için|ile|olarak|olan|daha|ancak|ise|göre|tarafından|üzerine|arasında|sonra|önce)\b/giu;
const BAD_IMAGE_PATTERN = /(?:^|[\/_-])(?:logo|avatar|icon|placeholder|default|sprite|qrcode|qr-code)(?:[\/_\.\?-]|$)/i;
const BOILERPLATE_PATTERNS = [
  /all rights reserved|tüm hakları saklıdır|版权所有/iu,
  /(?:京)?ICP(?:备|证)|ICP kayıt numarası|ICP belgesi/iu,
  /business license|işletme sicil numarası|营业执照/iu,
  /publication business permit|yayın işletme izni|出版物经营许可证/iu,
  /telecommunications?.{0,30}(?:permit|license)|telekomünikasyon.{0,40}izni|电信与信息服务业务经营许可证/iu,
  /other VOGUE sites|diğer VOGUE siteleri|更多VOGUE网站/iu,
  /(?:privacy policy|cookie policy|terms (?:of use|and conditions)|gizlilik politikası|çerez politikası|kullanım koşulları)/iu,
  /(?:follow us|subscribe|newsletter|sign in|log in|bizi takip edin|abone ol|giriş yap)/iu
];

const OUTPUT_BOILERPLATE_PATTERNS = [
  ...BOILERPLATE_PATTERNS,
  /(?:ana sayfa|haberler|iletişim|hakkımızda).{0,80}(?:gizlilik|çerez|kullanım koşulları)/iu
];

export function countCjk(value = '') {
  return value.match(CJK_PATTERN)?.length ?? 0;
}

export function translationIssues({ title = '', excerpt = '', text = '', paragraphs = [] }) {
  const issues = [];
  const combined = `${title}\n${excerpt}\n${text}`.trim();
  const paragraphCount = paragraphs.length || text.split(/\n{2,}/).filter((item) => item.trim()).length;
  if (text.trim().length < 700) issues.push('Türkçe haber gövdesi 700 karakterden kısa.');
  if (paragraphCount < 4) issues.push('Türkçe haber gövdesi en az dört paragraf içermiyor.');
  if (countCjk(combined) > 0) issues.push('Metinde çevrilmemiş Çince karakterler bulunuyor.');
  const words = text.match(/\p{L}+/gu) ?? [];
  const turkishSignals = text.match(TURKISH_WORD_PATTERN)?.length ?? 0;
  if (words.length >= 80 && turkishSignals < 4) issues.push('Metin akıcı Türkçe haber dili olarak doğrulanamadı.');
  if (title.trim().length < 35 || title.trim().length > 105) issues.push('Başlık uzunluğu uygun değil.');
  if (excerpt.trim().length < 100 || excerpt.trim().length > 220) issues.push('Spot uzunluğu uygun değil.');
  if (OUTPUT_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(combined))) {
    issues.push('Türkçe metinde navigasyon, üyelik veya yasal site artığı bulunuyor.');
  }
  const titleLetters = title.match(/\p{L}/gu) ?? [];
  const upperLetters = title.match(/\p{Lu}/gu) ?? [];
  if (titleLetters.length > 15 && upperLetters.length / titleLetters.length > 0.72) {
    issues.push('Başlık gereksiz biçimde büyük harflerden oluşuyor.');
  }
  return issues;
}

export function assertTranslationQuality(article) {
  const issues = translationIssues(article);
  if (issues.length) throw new Error(`Çeviri kalite kontrolü başarısız: ${issues.join(' ')}`);
}

export function sourceContentIssues(text = '') {
  const compact = text.replace(/\s+/g, ' ').trim();
  const boilerplateHits = BOILERPLATE_PATTERNS.filter((pattern) => pattern.test(compact)).length;
  const issues = [];
  if (compact.length < 500) issues.push('Makale gövdesi güvenilir biçimde çıkarılamadı.');
  if (boilerplateHits >= 2) issues.push('Makale yerine site navigasyonu veya yasal metin çıkarıldı.');
  return issues;
}

export function assertSourceContentQuality(text) {
  const issues = sourceContentIssues(text);
  if (issues.length) throw new Error(issues.join(' '));
}

export function imageDimensions(buffer, contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (mime === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (mime === 'image/webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8X') {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (format === 'VP8 ' && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (format === 'VP8L' && buffer.length >= 25) {
      return {
        width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
        height: 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10)
      };
    }
  }
  return null;
}

export function assertImageDimensions(buffer, contentType) {
  const dimensions = imageDimensions(buffer, contentType);
  if (!dimensions) throw new Error('Kaynak görsel boyutları doğrulanamadı.');
  if (dimensions.width < 1000 || dimensions.height < 560) {
    throw new Error(`Kaynak görsel çözünürlüğü yetersiz: ${dimensions.width}x${dimensions.height}.`);
  }
  const ratio = dimensions.width / dimensions.height;
  if (ratio < 1.15 || ratio > 2.4) throw new Error(`Kaynak görsel oranı haber kartlarına uygun değil: ${dimensions.width}x${dimensions.height}.`);
  return dimensions;
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

const TITLE_STOP_WORDS = new Set(['ve', 'ile', 'bir', 'bu', 'için', 'da', 'de', 'mi', 'mı', 'mu', 'mü', 'the', 'and', 'of', 'in', 'to']);

export function normalizedTitleTokens(value = '') {
  return new Set(value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !TITLE_STOP_WORDS.has(token)));
}

export function titleSimilarity(left, right) {
  const a = normalizedTitleTokens(left);
  const b = normalizedTitleTokens(right);
  if (!a.size || !b.size) return { score: 0, shared: 0 };
  const shared = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return { score: shared / union, shared };
}
