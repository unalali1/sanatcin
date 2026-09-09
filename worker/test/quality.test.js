import test from 'node:test';
import assert from 'node:assert/strict';
import { countCjk, isUsableImageUrl, translationIssues } from '../src/quality.js';

test('Çince karakterleri yakalar', () => {
  assert.equal(countCjk('Türkçe metin 龟兹'), 2);
  assert.ok(translationIssues({
    title: 'Yeterince uzun bir Türkçe haber başlığı',
    excerpt: 'Bu, kalite kontrolü için gereken uzunluğu rahatlıkla karşılayan açıklayıcı bir Türkçe haber spotudur.',
    text: `${'Bu haber kültür ve sanat alanındaki gelişmeleri doğal bir Türkçe ile aktarıyor. '.repeat(12)}龟兹`
  }).some((item) => item.includes('Çince')));
});

test('Akıcı Türkçe metni kabul eder', () => {
  const issues = translationIssues({
    title: 'Pekin’de kültürel mirasa yeni bir bakış',
    excerpt: 'Yeni sergi, tarihî eserleri çağdaş yöntemlerle ele alarak ziyaretçilere kapsamlı ve anlaşılır bir deneyim sunuyor.',
    text: 'Sergi, kültürel mirasın korunması için geliştirilen yeni yöntemleri bir araya getiriyor. Ziyaretçiler, tarihî eserlerin nasıl restore edildiğini ve günümüz sanatçılarına nasıl ilham verdiğini ayrıntılı biçimde görebiliyor. Etkinlikte ayrıca araştırmacılar ile sanatçılar arasında kurulan işbirliğinin sonuçları anlatılıyor. Programın önümüzdeki aylarda farklı kentlere taşınması ve daha geniş bir izleyici kitlesine ulaşması planlanıyor.'
  });
  assert.deepEqual(issues, []);
});

test('Logo ve yer tutucu görselleri reddeder', () => {
  assert.equal(isUsableImageUrl('https://example.com/assets/site-logo.png'), false);
  assert.equal(isUsableImageUrl('https://example.com/images/placeholder.jpg'), false);
  assert.equal(isUsableImageUrl('https://example.com/news/exhibition-2026.webp'), true);
});

