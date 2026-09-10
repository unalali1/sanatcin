import test from 'node:test';
import assert from 'node:assert/strict';
import { countCjk, imageDimensions, isUsableImageUrl, sourceContentIssues, titleSimilarity, translationIssues } from '../src/quality.js';

test('Çince karakterleri yakalar', () => {
  assert.equal(countCjk('Türkçe metin 龟兹'), 2);
  assert.ok(translationIssues({
    title: 'Yeterince uzun bir Türkçe haber başlığı',
    excerpt: 'Bu, kalite kontrolü için gereken uzunluğu rahatlıkla karşılayan açıklayıcı bir Türkçe haber spotudur.',
    text: `${'Bu haber kültür ve sanat alanındaki gelişmeleri doğal bir Türkçe ile aktarıyor.\n\n'.repeat(12)}龟兹`
  }).some((item) => item.includes('Çince')));
});

test('Akıcı Türkçe metni kabul eder', () => {
  const issues = translationIssues({
    title: 'Pekin’de kültürel mirasa çağdaş yöntemlerle yeni bir bakış',
    excerpt: 'Yeni sergi, tarihî eserleri çağdaş yöntemlerle ele alarak ziyaretçilere kapsamlı ve anlaşılır bir deneyim sunuyor.',
    text: [
      'Sergi, kültürel mirasın korunması için geliştirilen yeni yöntemleri bir araya getiriyor. Ziyaretçiler, tarihî eserlerin nasıl restore edildiğini ve günümüz sanatçılarına nasıl ilham verdiğini ayrıntılı biçimde görebiliyor.',
      'Etkinlikte ayrıca araştırmacılar ile sanatçılar arasında kurulan işbirliğinin sonuçları anlatılıyor. Uzmanlar, farklı dönemlere ait eserlerin malzeme özelliklerini ve koruma koşullarını ziyaretçilerle paylaşıyor.',
      'Program, geleneksel yöntemlerle dijital kayıt tekniklerini aynı anlatı içinde buluşturuyor. Bu yaklaşım sayesinde eserlerin üretim süreci ve zaman içinde geçirdiği değişimler daha açık biçimde izlenebiliyor.',
      'Serginin önümüzdeki aylarda farklı kentlere taşınması ve daha geniş bir izleyici kitlesine ulaşması planlanıyor. Düzenleyiciler, yeni duraklara ilişkin ayrıntıların daha sonra açıklanacağını belirtiyor.'
    ].join('\n\n')
  });
  assert.deepEqual(issues, []);
});

test('kaynak süreci notlarını ve ham Pinyin zincirlerini reddeder', () => {
  const base = {
    title: 'Pekin’de açılan sergi kültürel mirasa yeni bir pencere açıyor',
    excerpt: 'Yeni sergi, geleneksel üretim yöntemlerini çağdaş çalışmalarla bir araya getirerek izleyiciye kapsamlı bir seçki sunuyor.',
    paragraphs: [
      'Haberde etkinliğin açılış tarihi belirtilmemiş; daha fazla bilgi için kaynak internet sitesine bakılabilir.',
      'Beijing Shi Wenhua Ju temsilcileri serginin önemini anlattı ve izleyicilerle bir araya geldi.',
      'Program, farklı dönemlerden yapıtları aynı çatı altında buluşturuyor ve üretim süreçlerine ilişkin örnekler içeriyor.',
      'Sergide yer alan çalışmalar, geleneksel yöntemlerle çağdaş yorumların nasıl bir araya geldiğini ortaya koyuyor.'
    ]
  };
  const issues = translationIssues({ ...base, text: `${base.paragraphs.join('\n\n')} ${'Bu gelişme kültür ve sanat alanında yeni bir buluşma oluşturuyor. '.repeat(8)}` });
  assert.ok(issues.some((item) => item.includes('kaynak-site artığı')));
  assert.ok(issues.some((item) => item.includes('Pinyin')));
});

test('yinelenen haber cümlelerini reddeder', () => {
  const repeated = 'Sergi, geleneksel yöntemlerle çağdaş yorumları aynı salonda buluşturarak izleyiciye geniş bir seçki sunuyor.';
  const text = [repeated, repeated, 'Programda farklı dönemlerden sanatçıların çalışmaları yer alıyor ve üretim süreçleri ayrıntılı biçimde ele alınıyor.', 'Etkinlik, sanatçılar ile izleyiciler arasında yeni bir tartışma alanı açmayı amaçlıyor.', ...Array(7).fill('Küratörler seçkinin tarihsel bağlamını yeni yapıtlarla birlikte açıklıyor ve farklı disiplinler arasındaki ilişkiyi görünür kılıyor.')].join('\n\n');
  const issues = translationIssues({
    title: 'Pekin’de çağdaş sanat sergisi yeni yapıtlarla açıldı',
    excerpt: 'Yeni sergi, farklı kuşaklardan sanatçıların çalışmalarını aynı çatı altında buluşturarak izleyiciye kapsamlı bir seçki sunuyor.',
    text,
    paragraphs: text.split('\n\n')
  });
  assert.ok(issues.some((item) => item.includes('yinelenen cümle')));
});

test('Logo ve yer tutucu görselleri reddeder', () => {
  assert.equal(isUsableImageUrl('https://example.com/assets/site-logo.png'), false);
  assert.equal(isUsableImageUrl('https://example.com/images/placeholder.jpg'), false);
  assert.equal(isUsableImageUrl('https://example.com/news/exhibition-2026.webp'), true);
});

test('Yasal site metnini haber gövdesi olarak reddeder', () => {
  const text = '中国大陆更多VOGUE网站 版权所有 北京风华创想网络有限公司 京ICP备09041637号 出版物经营许可证 营业执照 电信与信息服务业务经营许可证';
  assert.ok(sourceContentIssues(text.repeat(4)).some((item) => item.includes('yasal metin')));
});

test('PNG boyutlarını okur', () => {
  const buffer = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(1280, 16);
  buffer.writeUInt32BE(720, 20);
  assert.deepEqual(imageDimensions(buffer, 'image/png'), { width: 1280, height: 720 });
});

test('geçersiz JPEG içindeki rastgele baytları boyut sanmaz', () => {
  const buffer = Buffer.alloc(40);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xc0;
  assert.equal(imageDimensions(buffer, 'image/jpeg'), null);
});

test('benzer başlıkları ortak anlamlı kelimelerle yakalar', () => {
  const result = titleSimilarity(
    'Şanghay’da çağdaş sanat sergisi yeni eserlerle açıldı',
    'Şanghay çağdaş sanat sergisi yeni yapıtlarla ziyarete açıldı'
  );
  assert.ok(result.shared >= 4);
  assert.ok(result.score >= 0.62);
});
