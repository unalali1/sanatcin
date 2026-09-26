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
  /(?:ana sayfa|haberler|iletişim|hakkımızda).{0,80}(?:gizlilik|çerez|kullanım koşulları)/iu,
  /(?:daha fazla|ayrıntılı) bilgi için.{0,80}(?:kaynak|internet sitesi|sayfa)/iu,
  /(?:haberde|kaynakta|metinde).{0,70}(?:belirtilmemiş|yer almıyor|aktarılmıyor|açıklanmıyor)/iu,
  /(?:haber|metin|içerik) için kullanılan (?:fotoğraf|görsel)/iu,
  /(?:web|internet|çevrimiçi) (?:editörü|sürümü|sayfası)/iu,
  /okuyucuya.{0,60}(?:sunuluyor|aktarılıyor|veriliyor)/iu,
  /\bkaynak metne göre\b|\bkaynağa göre\b|\bmetinde belirtildi(?:ği gibi)?\b|\bkaynakta belirtildiği gibi\b/iu,
  /\bkaynak,\s/iu
];

const RAW_PINYIN_MARKERS = new Set([
  'sheng', 'shi', 'xian', 'qu', 'zhen', 'zhou', 'zizhiqu', 'renmin',
  'zhengfu', 'wenhua', 'bowuguan', 'meishuguan', 'daxue', 'ribao', 'dianshitai'
]);
const STRONG_PINYIN_MARKERS = new Set([
  'zizhiqu', 'renmin', 'zhengfu', 'wenhua', 'bowuguan', 'meishuguan', 'daxue', 'ribao', 'dianshitai'
]);
const NEWSROOM_CLICHES = /\b(?:dikkat çekiyor|öne çıkıyor|gözler önüne seriyor|önemli bir adım|büyük ilgi gördü|sahnede|görücüye çıktı|yer alıyor|aynı sahneyi paylaştı)\b/giu;
const WEAK_HEADLINE_PATTERNS = [
  /\byer alıyor\b/iu,
  /\baynı sahneyi paylaştı\b/iu,
  /\bdikkat çekiyor\b/iu,
  /\böne çıkıyor\b/iu,
  /\b\d[\d.,]*\s*(?:metre|milyon|milyar)\b.{0,24}\bulaşıyor\b/iu
];
const NOMINALIZATION_PATTERN = /\b\p{L}{4,}(?:ılması|ilmesi|ulması|ülmesi|lanması|lenmesi)\b/giu;
const TRANSLATIONESE_PATTERNS = [
  /\bartık yalnızca\b.{0,90}\bdeğil\b/giu,
  /\bbu (?:dönüşüm|eğilim|yaklaşım|model)\b/giu,
  /\bfarklı deneyimsel\b/giu,
  /\bmüziğin mek[aâ]nla birlikte deneyimlenmesi\b/giu,
  /\bdaha geniş bir söz alanı aç/giu,
  /\byeni bir (?:kültürel |tartışma )?alan yarat/giu,
  /\bbir araya getir(?:iyor|di|en|erek)\b/giu,
  /\bdeneyim sun(?:uyor|du|an|mak)\b/giu,
  /\b(?:dikkat çeken|öne çıkan) örneklerinden biri\b/giu,
  /\b(?:dönüşüyor|dönüştü|dönüşümüne)\b/giu,
  /demonstrasyon bölgesi/giu,
  /özgün Çince olmayan/giu,
  /\b(?:tecrübe|deneyim) alanı sun(?:uyor|du)\b/giu
];
const ABSTRACT_REPEAT_WORDS = new Set([
  'deneyim', 'yaklaşım', 'dönüşüm', 'etkinlik', 'süreç', 'alan', 'model', 'unsur', 'bağlam'
]);
const TURKISH_HEADLINE_CONTEXT = /\b(?:sergi|festival|film|sinema|moda|müze|ödül|sanat|edebiyat|şiir|tasarım|konser|tiyatro|opera|mimari|kent|şehir|Pekin|Şanghay|Çin)\b/iu;
const FOREIGN_PROPER_NAME_LEAD = /^[“"'‘]?[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){1,4}[”"'’]?(?:,|\s)/u;

export function countCjk(value = '') {
  return value.match(CJK_PATTERN)?.length ?? 0;
}

function normalizedNativeNames(nativeNames = []) {
  return (Array.isArray(nativeNames) ? nativeNames : [])
    .filter((item) => item?.verified === true && item?.turkish && item?.hanzi && item?.pinyin)
    .map((item) => ({
      turkish: String(item.turkish).trim(),
      hanzi: String(item.hanzi).trim(),
      pinyin: String(item.pinyin).trim()
    }));
}

function nativeNameForms(nativeName) {
  return [
    `${nativeName.turkish} (“${nativeName.hanzi}”, ${nativeName.pinyin})`,
    `${nativeName.turkish} ("${nativeName.hanzi}", ${nativeName.pinyin})`
  ];
}

function stripAllowedNativeNames(value = '', nativeNames = []) {
  let stripped = String(value);
  for (const nativeName of normalizedNativeNames(nativeNames)) {
    for (const form of nativeNameForms(nativeName)) stripped = stripped.split(form).join('');
  }
  return stripped;
}

function countUnexpectedCjk(value = '', nativeNames = []) {
  return countCjk(stripAllowedNativeNames(value, nativeNames));
}

function rawPinyinAdministrativeChainCount(value = '') {
  const sentences = String(value)
    .split(/(?<=[.!?;:])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  let chains = 0;
  for (const sentence of sentences) {
    const tokens = sentence
      .toLocaleLowerCase('tr-TR')
      .match(/[\p{L}-]+/gu) ?? [];
    let matched = false;
    for (let start = 0; start < tokens.length && !matched; start += 1) {
      const window = tokens.slice(start, start + 6);
      const markers = window.filter((token) => RAW_PINYIN_MARKERS.has(token));
      const strongMarkers = markers.filter((token) => STRONG_PINYIN_MARKERS.has(token));
      if ((markers.length >= 2 && strongMarkers.length >= 1) || markers.length >= 3) {
        chains += 1;
        matched = true;
      }
    }
  }
  return chains;
}

export function nativeNameRegression(before = {}, after = {}, nativeNames = []) {
  const beforeCombined = `${before.title || ''}\n${before.excerpt || ''}\n${before.text || ''}`;
  const afterCombined = `${after.title || ''}\n${after.excerpt || ''}\n${after.text || ''}`;
  if (countUnexpectedCjk(afterCombined, nativeNames) > 0) return true;
  return normalizedNativeNames(nativeNames).some((nativeName) => {
    const forms = nativeNameForms(nativeName);
    const existedBefore = forms.some((form) => beforeCombined.includes(form));
    const existsAfter = forms.some((form) => afterCombined.includes(form));
    return existedBefore && !existsAfter;
  });
}

export function translationIssues({ title = '', excerpt = '', text = '', paragraphs = [] }, factSheet = {}) {
  const issues = newsroomLanguageIssues({ title, text, paragraphs });
  const combined = `${title}\n${excerpt}\n${text}`.trim();
  const paragraphCount = paragraphs.length || text.split(/\n{2,}/).filter((item) => item.trim()).length;
  if (text.trim().length < 600) issues.push('Türkçe haber gövdesi 600 karakterden kısa.');
  if (paragraphCount < 3) issues.push('Türkçe haber gövdesi en az üç paragraf içermiyor.');
  if (countUnexpectedCjk(combined, factSheet.nativeNames) > 0) issues.push('Metinde olgu fişinde doğrulanmamış veya izin verilen kısa ilk kullanım biçimi dışında Çince karakterler bulunuyor.');
  if (countCjk(`${title}\n${excerpt}`) > 0) issues.push('Başlık veya spotta Çince karakter bulunuyor; özgün ad yalnız gövdede ilk kullanımda verilmeli.');
  const words = text.match(/\p{L}+/gu) ?? [];
  const turkishSignals = text.match(TURKISH_WORD_PATTERN)?.length ?? 0;
  if (words.length >= 80 && turkishSignals < 4) issues.push('Metin akıcı Türkçe haber dili olarak doğrulanamadı.');
  if (title.trim().length < 32 || title.trim().length > 82) issues.push('Başlık 32-82 karakter aralığında değil.');
  if (excerpt.trim().length < 105 || excerpt.trim().length > 180) issues.push('Spot 105-180 karakter aralığında değil.');
  if (OUTPUT_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(combined))) {
    issues.push('Türkçe metinde navigasyon, editoryal not veya kaynak-site artığı bulunuyor.');
  }
  const pinyinChains = rawPinyinAdministrativeChainCount(stripAllowedNativeNames(combined, factSheet.nativeNames));
  if (pinyinChains > 0) issues.push('Kurum veya yer adlarında açıklanmamış ham Pinyin zinciri bulunuyor.');

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

export function editorialFluencyProfile({ title = '', excerpt = '', text = '' } = {}) {
  const combined = `${title}\n${excerpt}\n${text}`.replace(/\s+/g, ' ').trim();
  const words = combined.toLocaleLowerCase('tr-TR').match(/\p{L}+/gu) ?? [];
  const translationeseHits = TRANSLATIONESE_PATTERNS.reduce((total, pattern) => {
    pattern.lastIndex = 0;
    return total + (combined.match(pattern)?.length ?? 0);
  }, 0);
  const nominalizations = combined.match(NOMINALIZATION_PATTERN)?.length ?? 0;
  const clichéCount = combined.match(NEWSROOM_CLICHES)?.length ?? 0;
  const headlineWeaknessHits = WEAK_HEADLINE_PATTERNS.reduce((total, pattern) => total + (pattern.test(title) ? 1 : 0), 0);
  const abstractCounts = words.reduce((counts, word) => {
    if (ABSTRACT_REPEAT_WORDS.has(word)) counts[word] = (counts[word] ?? 0) + 1;
    return counts;
  }, {});
  const repeatedAbstractWords = Object.entries(abstractCounts)
    .filter(([, count]) => count >= 4)
    .map(([word, count]) => ({ word, count }));
  const newsroomIssueCount = newsroomLanguageIssues({ title, text }).length;
  const densityFactor = Math.max(1, words.length / 180);
  const penalty = Math.round(
    (translationeseHits * 7 + Math.max(0, nominalizations - 3) * 2 + clichéCount * 3
      + headlineWeaknessHits * 5
      + repeatedAbstractWords.reduce((sum, item) => sum + (item.count - 3) * 2, 0)) / densityFactor
  );
  return {
    score: Math.max(0, Math.min(100, 100 - penalty - newsroomIssueCount * 12)),
    newsroomIssueCount,
    translationeseHits,
    nominalizations,
    clichéCount,
    headlineWeaknessHits,
    repeatedAbstractWords
  };
}

export function editorialDraftChanged(before = {}, after = {}) {
  return JSON.stringify({ title: before.title, excerpt: before.excerpt, paragraphs: before.paragraphs })
    !== JSON.stringify({ title: after.title, excerpt: after.excerpt, paragraphs: after.paragraphs });
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

export function detectImageContentType(buffer, contentType = '') {
  if (buffer?.length >= 24 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png';
  if (buffer?.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer?.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';

  const declared = String(contentType).split(';')[0].trim().toLowerCase();
  if (declared === 'image/jpg' || declared === 'image/pjpeg') return 'image/jpeg';
  return declared;
}

function jpegDimensions(buffer) {
  if (!buffer || buffer.length < 11 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  // Some publisher/CDN JPEGs contain metadata/padding layouts that do not line up
  // with a strict segment walker. Scan for a structurally valid SOF marker instead.
  for (let offset = 2; offset + 9 < buffer.length; offset += 1) {
    if (buffer[offset] !== 0xff || !sofMarkers.has(buffer[offset + 1])) continue;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 7 || offset + 2 + segmentLength > buffer.length) continue;
    const precision = buffer[offset + 4];
    const height = buffer.readUInt16BE(offset + 5);
    const width = buffer.readUInt16BE(offset + 7);
    if (![8, 12, 16].includes(precision) || width <= 0 || height <= 0) continue;
    return { width, height };
  }
  return null;
}

export function imageDimensions(buffer, contentType = '') {
  const mime = detectImageContentType(buffer, contentType);
  if (mime === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') return jpegDimensions(buffer);
  if (mime === 'image/webp' && buffer.length >= 30) {
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
const GENERIC_EVENT_TOKENS = new Set([
  'pekin', 'beijing', 'şanghay', 'shanghai', 'çin', 'china', 'chinese',
  'moda', 'fashion', 'haftası', 'week', 'festival', 'festivali', 'sergi',
  'exhibition', 'etkinlik', 'event', 'sanat', 'art'
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

export function likelyDuplicateTitles(left, right) {
  const a = normalizedTitleTokens(left);
  const b = normalizedTitleTokens(right);
  if (!a.size || !b.size) return false;
  // A shared festival name or three-word phrase is not evidence of the same story.
  const shared = [...a].filter((token) => b.has(token));
  const union = new Set([...a, ...b]).size;
  const overlap = shared.length / Math.min(a.size, b.size);
  const jaccard = shared.length / union;
  const years = (value) => new Set(String(value).match(/\b20\d{2}\b/g) ?? []);
  const leftYears = years(left), rightYears = years(right);
  if (leftYears.size && rightYears.size && ![...leftYears].some(year => rightYears.has(year))) return false;
  if (jaccard === 1) return true;
  const generic = new Set([...GENERIC_EVENT_TOKENS, ...normalizedTitleTokenList(
    'Mid Autumn Festival Güz Ortası Bayramı National Day Milli Bayram 2026 2025'
  )]);
  const distinctive = shared.filter((token) => !generic.has(token));
  return shared.length >= 4 && distinctive.length >= 3
    && (jaccard >= 0.62 || (overlap >= 0.9 && jaccard >= 0.45));
}

// Article/card usability is separate: a non-hero image need not stop publication.
export function heroImageEligible(dimensions = {}, cropSafe = false, scene = 'other', kind = '', visualScore = 100) {
  const width = Number(dimensions.width) || 0;
  const height = Number(dimensions.height) || 0;
  const score = Number(visualScore);
  if (!cropSafe || width < 1400 || height <= 0) return false;
  const ratio = width / height;
  if (ratio < 1.35 || ratio > 1.9 || kind === 'event-poster') return false;
  if (Number.isFinite(score) && score < 72) return false;
  return ['runway', 'architecture', 'performance', 'exhibition', 'street', 'food', 'artifact', 'illustration'].includes(scene);
}

const RELATED_TITLE_STOPWORDS = new Set([
  'çin', 'çinde', 'çinin', 'pekin', 'yeni', 'haber', 'sanat', 'kültür', 'şehir', 'yaşam',
  'moda', 'tasarım', 'sinema', 'film', 'ile', 'için', 'bir', 'bu', 've', 'de', 'da',
  'ile', 'olarak', 'olan', 'daha', 'sonra', 'önce', 'üzerine', 'arasında'
]);

function relatedTitleTokens(value = '') {
  return new Set(String(value)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKC')
    .replace(/&(?:amp|#038);/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 4 && !RELATED_TITLE_STOPWORDS.has(token)));
}

export function selectRelatedPosts(articleTitle, categoryId, posts = [], limit = 2) {
  const wantedTokens = relatedTitleTokens(articleTitle);
  const scored = [];
  for (let index = 0; index < posts.length; index += 1) {
    const post = posts[index];
    if (!Array.isArray(post?.categories) || !post.categories.includes(categoryId)) continue;
    const title = String(post?.title?.rendered ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const link = String(post?.link ?? '').trim();
    if (!title || !link || likelyDuplicateTitles(articleTitle, title)) continue;
    const postTokens = relatedTitleTokens(title);
    const overlap = [...wantedTokens].filter((token) => postTokens.has(token)).length;
    const similarity = titleSimilarity(articleTitle, title).score;
    scored.push({ post, title, link, overlap, similarity, index });
  }

  scored.sort((a, b) => (
    b.overlap - a.overlap
    || b.similarity - a.similarity
    || a.index - b.index
  ));

  const topical = scored.filter((item) => item.overlap > 0 || item.similarity >= 0.16);
  const selected = topical.slice(0, limit);
  if (selected.length < limit) {
    for (const item of scored) {
      if (selected.includes(item)) continue;
      selected.push(item);
      if (selected.length >= limit) break;
    }
  }
  return selected.slice(0, limit).map(({ post, title, link }) => ({ id: post.id, title, link }));
}

export function normalizeNewsroomTerms(value = '') {
  return String(value)
    .replace(/\bNational Art Museum of China\b/gu, 'Çin Ulusal Sanat Müzesi')
    .replace(/Çin(?:’in|'in)? Ulusal Günü/giu, 'Çin Milli Bayramı')
    .replace(/Orta Sonbahar (?:Bayramı|Festivali)/giu, 'Güz Ortası Bayramı');
}

export function newsroomLanguageIssues({ title = '', text = '', paragraphs = [] } = {}) {
  const issues = [];
  const combined = `${title}\n${text}`;
  if (/\bNational Art Museum of China\b/u.test(combined)) {
    issues.push('İngilizce kurum adı Türkçeleştirilmeli: Çin Ulusal Sanat Müzesi.');
  }
  if (/yeşim çakıl malzemesi/iu.test(combined)) {
    issues.push('“Yeşim çakıl malzemesi” mekanik bir çeviri; kaynak anlamını koruyarak anlaşılır Türkçe kullan.');
  }
  if (/(?:mühür|mührü|heykel|heykeli)\s+[^.!?]{0,65}izini sürüyor/iu.test(title)) {
    issues.push('Başlıkta nesneye araştırmacı eylemi yükleniyor; bulgunun neyi gösterdiğini açıkla.');
  }
  const match = text.match(/Çincede\s+([^.!?]{5,70})\s+olarak adlandırılıyor/iu);
  if (match && /[çğıöşü]/iu.test(match[1])) {
    issues.push('Çince terim açıklaması Türkçe ifadeyi tekrarlıyor; bilgi vermeyen cümleyi çıkar veya doğrulanmış terimi açıkla.');
  }
  const lead = paragraphs[0] ?? text.split(/\n\n/u)[0] ?? '';
  const levels = lead.match(/(?:eyalet|kent|şehir|bölge|ilçe|köy)(?:ine|inin|indeki|üne|ünün|ündeki|inde|unda|ına|ının|sine|sinin|sindeki|ü|i|si)/giu) ?? [];
  if (levels.length >= 4) issues.push('Giriş idari yer adlarıyla ağırlaşıyor; ana gelişmeyi öne al, alt yer bilgilerini sonraki paragrafa taşı.');
  return issues;
}

export function numericFactRegression(before = {}, after = {}) {
  const body = (draft) => `${draft.title ?? ''} ${draft.excerpt ?? ''} ${draft.text ?? (draft.paragraphs ?? []).join(' ')}`;
  const numbers = (draft) => new Set(body(draft).match(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/gu) ?? []);
  const kept = numbers(after);
  return [...numbers(before)].some((number) => !kept.has(number));
}
