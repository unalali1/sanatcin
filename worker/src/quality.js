const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu;
const ALLOWED_CJK_NATIVE_NAME_PATTERN = /Türkçeye\s+[“"][^“”"\n]{1,140}[”"]\s+diye\s+çevrilebilecek[^“”"\n]{0,100}[“"][^“”"\n]*[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF][^“”"\n]*[”"]\s*(?:\([^)\n]{1,100}\))?/giu;
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
  /(?:ana sayfa|haberler|iletişim|hakkımızda).{0,80}(?:gizlilik|çerez|kullanım koşulları)/iu,
  /(?:daha fazla|ayrıntılı) bilgi için.{0,80}(?:kaynak|internet sitesi|sayfa)/iu,
  /(?:haberde|kaynakta|metinde).{0,70}(?:belirtilmemiş|yer almıyor|aktarılmıyor|açıklanmıyor)/iu,
  /(?:haber|metin|içerik) için kullanılan (?:fotoğraf|görsel)/iu,
  /(?:web|internet|çevrimiçi) (?:editörü|sürümü|sayfası)/iu,
  /okuyucuya.{0,60}(?:sunuluyor|aktarılıyor|veriliyor)/iu,
  /\bkaynak metne göre\b|\bkaynağa göre\b|\bmetinde belirtildi(?:ği gibi)?\b|\bkaynakta belirtildiği gibi\b/iu,
  /\bkaynak,\s/iu
];

const RAW_PINYIN_MARKERS = /\b(?:sheng|shi|xian|qu|zhen|zhou|zizhiqu|renmin|zhengfu|wenhua|bowuguan|meishuguan|daxue|ribao|dianshitai)\b/giu;
const NEWSROOM_CLICHES = /\b(?:dikkat çekiyor|öne çıkıyor|gözler önüne seriyor|önemli bir adım|büyük ilgi gördü|sahnede|görücüye çıktı)\b/giu;
const NOMINALIZATION_PATTERN = /\b\p{L}{4,}(?:ılması|ilmesi|ulması|ülmesi|lanması|lenmesi)\b/giu;
const TURKISH_HEADLINE_CONTEXT = /\b(?:sergi|festival|film|sinema|moda|müze|ödül|sanat|edebiyat|şiir|tasarım|konser|tiyatro|opera|mimari|kent|şehir|Pekin|Şanghay|Çin)\b/iu;
const FOREIGN_PROPER_NAME_LEAD = /^[“"'‘]?[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){1,4}[”"'’]?(?:,|\s)/u;

export function countCjk(value = '') {
  return value.match(CJK_PATTERN)?.length ?? 0;
}

function countUnexpectedCjk(value = '') {
  const withoutAllowedNativeNames = String(value).replace(ALLOWED_CJK_NATIVE_NAME_PATTERN, '');
  return countCjk(withoutAllowedNativeNames);
}

export function translationIssues({ title = '', excerpt = '', text = '', paragraphs = [] }) {
  const issues = [];
  const combined = `${title}\n${excerpt}\n${text}`.trim();
  const paragraphCount = paragraphs.length || text.split(/\n{2,}/).filter((item) => item.trim()).length;
  if (text.trim().length < 600) issues.push('Türkçe haber gövdesi 600 karakterden kısa.');
  if (paragraphCount < 3) issues.push('Türkçe haber gövdesi en az üç paragraf içermiyor.');
  if (countUnexpectedCjk(combined) > 0) issues.push('Metinde açıklanmamış veya izin verilen ilk kullanım biçimi dışında Çince karakterler bulunuyor.');
  const words = text.match(/\p{L}+/gu) ?? [];
  const turkishSignals = text.match(TURKISH_WORD_PATTERN)?.length ?? 0;
  if (words.length >= 80 && turkishSignals < 4) issues.push('Metin akıcı Türkçe haber dili olarak doğrulanamadı.');
  if (title.trim().length < 32 || title.trim().length > 82) issues.push('Başlık 32-82 karakter aralığında değil.');
  if (excerpt.trim().length < 105 || excerpt.trim().length > 180) issues.push('Spot 105-180 karakter aralığında değil.');
  if (OUTPUT_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(combined))) {
    issues.push('Türkçe metinde navigasyon, editoryal not veya kaynak-site artığı bulunuyor.');
  }
  const pinyinMarkers = combined.match(RAW_PINYIN_MARKERS)?.length ?? 0;
  if (pinyinMarkers >= 2) issues.push('Kurum veya yer adlarında açıklanmamış ham Pinyin zinciri bulunuyor.');

  const rawSentences = text.split(/(?<=[.!?])\s+/u).map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const sentences = rawSentences.map((item) => item.toLocaleLowerCase('tr-TR')).filter((item) => item.length > 45);
  if (new Set(sentences).size < sentences.length) issues.push('Haber gövdesinde yinelenen cümle bulunuyor.');
  const longSentences = rawSentences.filter((sentence) => (sentence.match(/\p{L}+/gu) ?? []).length > 38);
  if (longSentences.length >= 2) issues.push('Metinde birden fazla aşırı uzun cümle bulunuyor; Türkçe haber ritmi için bölünmeli.');
  const nominalizations = combined.match(NOMINALIZATION_PATTERN)?.length ?? 0;
  if (nominalizations >= 7) issues.push('Metinde yabancı sözdizimini andıran aşırı isimleştirme yoğunluğu var.');
  const clichéCount = combined.match(NEWSROOM_CLICHES)?.length ?? 0;
  if (clichéCount >= 3) issues.push('Metinde fazla sayıda kalıp haber ifadesi bulunuyor.');

  const paragraphStarts = paragraphs.map((paragraph) => String(paragraph).split(/\s+/).slice(0, 7).join(' ').toLocaleLowerCase('tr-TR')).filter(Boolean);
  if (paragraphStarts.length && new Set(paragraphStarts).size < paragraphStarts.length) issues.push('Paragraflar aynı ifadeyle tekrarlı biçimde başlıyor.');
  const titleLetters = title.match(/\p{L}/gu) ?? [];
  const upperLetters = title.match(/\p{Lu}/gu) ?? [];
  if (titleLetters.length > 15 && upperLetters.length / titleLetters.length > 0.72) {
    issues.push('Başlık gereksiz biçimde büyük harflerden oluşuyor.');
  }
  if (/\bÇin bağlantılı\b/iu.test(title)) {
    issues.push('Başlıkta “Çin bağlantılı” gibi muğlak bir ifade var; mümkünse daha kesin özne kullanılmalı.');
  }
  if (FOREIGN_PROPER_NAME_LEAD.test(title.trim()) && !TURKISH_HEADLINE_CONTEXT.test(title)) {
    issues.push('Başlık bilinmeyen yabancı özel adla başlıyor; Türk okuyucu için ne olduğunu açıklayan bağlam eklenmeli.');
  }
  return issues;
}

export function headlineQualityRegression(before = '', after = '') {
  const previous = String(before).trim();
  const current = String(after).trim();
  if (!previous || !current || previous === current) return false;
  const meaningful = /(?:sanat|sanatçı|sergi|eser|film|sinema|moda|tasarım|koleksiyon|festival|müze|edebiyat|tiyatro|opera|mimari|zanaat)/iu;
  const weakAdministrative = /\b(?:açıkladı|belirtti|duyurdu|kabul etti|düzenlendi|gerçekleştirildi|başkan|müdür|sözcü|gösterim(?:e)?|izlenme|beğeni|takipçi)\b/iu;
  return meaningful.test(previous) && weakAdministrative.test(current) && !weakAdministrative.test(previous);
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
  const sentences = compact.split(/(?<=[.!?。！？])\s+/u).filter((item) => item.trim().length > 30);
  if (compact.length < 1100 && sentences.length < 6) issues.push('Kaynak, tam haber yerine kısa duyuru veya görsel altyazı dizisi gibi görünüyor.');
  return issues;
}

export function assertSourceContentQuality(text) {
  const issues = sourceContentIssues(text);
  if (issues.length) throw new Error(issues.join(' '));
}

export function imageDimensions(buffer, contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (mime === 'image/png' && buffer.length >= 24 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg' && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (offset + 9 >= buffer.length) return null;
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (offset + 4 > buffer.length) return null;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) return null;
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

export function assertImageDimensions(buffer, contentType, {
  minWidth = 900,
  minHeight = 500,
  minRatio = 1,
  maxRatio = 2.6
} = {}) {
  const dimensions = imageDimensions(buffer, contentType);
  if (!dimensions) throw new Error('Kaynak görsel boyutları doğrulanamadı.');
  if (dimensions.width < minWidth || dimensions.height < minHeight) {
    throw new Error(`Kaynak görsel çözünürlüğü yetersiz: ${dimensions.width}x${dimensions.height}.`);
  }
  const ratio = dimensions.width / dimensions.height;
  if (ratio < minRatio || ratio > maxRatio) throw new Error(`Kaynak görsel oranı haber kartlarına uygun değil: ${dimensions.width}x${dimensions.height}.`);
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

const TITLE_STOP_WORDS = new Set([
  've', 'ile', 'bir', 'bu', 'için', 'da', 'de', 'mi', 'mı', 'mu', 'mü',
  'the', 'and', 'of', 'in', 'to', 'çin', 'cin', 'china', 'chinese'
]);

function normalizedTitleTokenList(value = '') {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !TITLE_STOP_WORDS.has(token));
}

export function normalizedTitleTokens(value = '') {
  return new Set(normalizedTitleTokenList(value));
}

function longestSharedRun(leftTokens, rightTokens) {
  let longest = 0;
  for (let left = 0; left < leftTokens.length; left += 1) {
    for (let right = 0; right < rightTokens.length; right += 1) {
      let run = 0;
      while (
        left + run < leftTokens.length
        && right + run < rightTokens.length
        && leftTokens[left + run] === rightTokens[right + run]
      ) run += 1;
      if (run > longest) longest = run;
    }
  }
  return longest;
}

export function titleSimilarity(left, right) {
  const leftList = normalizedTitleTokenList(left);
  const rightList = normalizedTitleTokenList(right);
  const a = new Set(leftList);
  const b = new Set(rightList);
  if (!a.size || !b.size) return { score: 0, shared: 0 };
  const shared = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const longestRun = longestSharedRun(leftList, rightList);
  const sequenceBoost = longestRun >= 3 ? 0.7 : longestRun === 2 ? 0.45 : 0;
  return {
    score: Math.max(shared / union, sequenceBoost),
    shared: longestRun >= 3 ? Math.max(shared, 4) : shared
  };
}