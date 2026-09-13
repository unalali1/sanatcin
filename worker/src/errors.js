const rules = [
  ['DATE_INVALID', /tarih|Eski makale/i, 'date'],
  ['EDITORIAL_INVALID', /olgu|Editoryal|Çeviri|Türkçe|başlık|spot/i, 'editorial'],
  ['DUPLICATE', /benzer haber|known|daha önce/i, 'duplicate'],
  ['SOURCE_EXTRACTION', /Makale gövdesi|site navigasyonu|kısa duyuru|görsel altyazı/i, 'source'],
  ['IMAGE_INVALID', /görsel|image|HTTP 403|çözünürlük|oranı/i, 'image'],
  ['SOURCE_NETWORK', /HTTP|fetch|abort|timeout/i, 'source']
];

export function classifyError(error) {
  const message = String(error?.message ?? error);
  const match = rules.find(([, pattern]) => pattern.test(message));
  return match
    ? { code: match[0], group: match[2], message }
    : { code: 'UNCLASSIFIED', group: 'other', message };
}
