// Single deterministic guard shared by the caption builder and WordPress publisher.
// This is deliberately independent of any AI model, Buffer account or WordPress API.
export const INSTAGRAM_FALLBACK_HASHTAGS = Object.freeze({
  'kultur-sanat': ['KültürSanat', 'ÇinSanatı', 'Sanat'],
  sinema: ['Sinema', 'ÇinSineması', 'FilmFestivali'],
  'moda-tasarim': ['Moda', 'ÇinModası', 'Tasarım'],
  'sehir-yasam': ['ŞehirYaşamı', 'ÇindeYaşam', 'Kültür'],
  editoren: ['KültürSanat', 'Editörden', 'Sanat'],
  'editorden': ['KültürSanat', 'Editörden', 'Sanat']
});

export function instagramCaptionProblems(text = '') {
  const value = String(text ?? '');
  const problems = [];
  if (value.length < 350 || value.length > 1800) problems.push('length');
  const tags = value.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (new Set(tags.map(tag => tag.toLocaleLowerCase('tr-TR'))).size < 4) problems.push('hashtags');
  if (!tags.includes('#SanatÇin')) problems.push('brand-hashtag');
  if ((value.match(/\p{Extended_Pictographic}/gu) ?? []).length < 4) problems.push('emojis');
  if (!value.includes('Haberin tamamı SanatÇin’de.')) problems.push('call-to-action');
  if (!value.includes('\n\n')) problems.push('paragraph-breaks');
  return problems;
}

export function assertInstagramCaptionReady(text) {
  const problems = instagramCaptionProblems(text);
  if (problems.length) throw new Error('Instagram metni kalite denetiminden geçemedi: ' + problems.join(', '));
  return text;
}

export function assertInstagramCaptionStored(meta, expected, postId) {
  if (!expected || meta?.sanatcin_social_instagram_text !== expected) {
    throw new Error('Instagram metni WordPress REST yanıtında doğrulanamadı (post ' + postId + ').');
  }
  return true;
}
