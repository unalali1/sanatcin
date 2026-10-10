import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramCaptionProblems, assertInstagramCaptionReady, assertInstagramCaptionStored, INSTAGRAM_FALLBACK_HASHTAGS } from '../src/social-caption.js';
const original = '✨ Çin’de bilezik modası: Her boncukta ayrı hikâye\n\n📍 Çinli gençler, geleneksel motiflerden esinlenerek kendi zevklerini yansıtan bilezikler hazırlıyor.\n\n🔎 Takı pazarlarında farklı renk ve biçimlerde boncuklar kullanılıyor. Gençler bunları bir hatıra ya da dostluk simgesi olarak görüyor.\n🖼️ Müzelerdeki atölyeler de bilezik yapımını tanıtırken geleneksel motiflerin güncel tasarımdaki yerini gösteriyor.\n✨ Ziyaretçiler kendi boncuk dizilerini oluşturuyor.\n\n👉 Haberin tamamı SanatÇin’de.\n\n#SanatÇin #Moda #ÇinModası #Tasarım #Boncuk';

test('hand-edited long, emoji-rich caption is ready', () => {
  const text = original;
  assert.deepEqual(instagramCaptionProblems(text), []);
  assert.equal(assertInstagramCaptionReady(text), text);
});
test('default Buffer excerpt cannot pass publication guard', () => {
  assert.ok(instagramCaptionProblems('Çin’de bilezik modası. Haberin devamı sanatcin.com’da.').length >= 4);
  assert.throws(() => assertInstagramCaptionReady('Çin’de bilezik modası.'), /kalite denetiminden/);
});
test('a stored verified field must match byte-for-byte before publishing', () => {
  const text = original;
  assert.equal(assertInstagramCaptionStored({ sanatcin_social_instagram_text: text }, text, 100), true);
  assert.throws(() => assertInstagramCaptionStored({ sanatcin_social_instagram_text: '' }, text, 100), /post 100/);
  assert.throws(() => assertInstagramCaptionStored({}, text, 100), /doğrulanamadı/);
});
test('category fallback always supplies at least three relevant tags', () => {
  assert.deepEqual(INSTAGRAM_FALLBACK_HASHTAGS['moda-tasarim'], ['Moda', 'ÇinModası', 'Tasarım']);
  assert.ok(Object.values(INSTAGRAM_FALLBACK_HASHTAGS).every(tags => tags.length >= 3));
});
