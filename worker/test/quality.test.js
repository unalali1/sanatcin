import test from 'node:test';
import assert from 'node:assert/strict';
import { assertImageDimensions, countCjk, editorialFluencyProfile, imageDimensions, isUsableImageUrl, likelyDuplicateTitles, sourceContentIssues, nativeNameRegression, titleSimilarity, translationIssues } from '../src/quality.js';

test('Çince karakterleri yakalar', () => {
  assert.equal(countCjk('Türkçe metin 龟兹'), 2);
  assert.ok(translationIssues({
    title: 'Yeterince uzun bir Türkçe haber başlığı',
    excerpt: 'Bu, kalite kontrolü için gereken uzunluğu rahatlıkla karşılayan açıklayıcı bir Türkçe haber spotudur.',
    text: `${'Bu haber kültür ve sanat alanındaki gelişmeleri doğal bir Türkçe ile aktarıyor.\n\n'.repeat(12)}龟兹`
  }).some((item) => item.includes('Çince')));
});

test('Türkçe karşılıkla açıklanan özgün Çince adı ilk kullanımda kabul eder', () => {
  const intro = 'Çin’in yeni dönem dizisi Orkide Kokusu Hâlâ Aynı (“兰香如故”, Lán Xiāng Rú Gù), çekimler için kurulan geleneksel bahçesiyle izleyiciyle buluştu.';
  const paragraphs = [
    intro,
    'Yapım ekibi, bahçenin yalnızca görkemli görünmesini değil, gerçekten yaşanmış bir mekân hissi vermesini amaçladı ve avlular ile köşkleri aylar boyunca yeniden düzenledi.',
    'Dizinin görsel dünyasında Jiangnan bahçelerinden yararlanıldı; su, bitki örtüsü ve geleneksel mimari unsurlar aynı yerleşim içinde bir araya getirildi.',
    'Yapımcılar, ayrıntılı fiziksel setin karakterlerin gündelik hayatını daha inandırıcı bir atmosfer içinde anlatmaya yardımcı olduğunu belirtti.'
  ];
  const text = `${paragraphs.join('\\n\\n')} ${'Bu yaklaşım dönemin gündelik yaşamını daha doğal bir görsel dille aktarmayı amaçlıyor. '.repeat(8)}`;
  const issues = translationIssues({
    title: 'Bir dönem dizisi için sekiz ayda geleneksel Çin bahçesi kuruldu',
    excerpt: 'Çin’in yeni dönem dizisi için sekiz ayda kurulan geleneksel bahçe seti, yapımın dönem atmosferini gerçek mekân duygusuyla güçlendiriyor.',
    paragraphs,
    text
  }, { nativeNames: [{ type: 'work', turkish: 'Orkide Kokusu Hâlâ Aynı', hanzi: '兰香如故', pinyin: 'Lán Xiāng Rú Gù', verified: true }] });
  assert.ok(!issues.some((item) => item.includes('Çince')));
});

test('doğrulanmış özgün ad içindeki Pinyin ham Pinyin sayılmaz', () => {
  const paragraphs = [
    'Yeni sergi, Çin Kültürü Müzesi (“中国文化博物馆”, Zhongguo Wenhua Bowuguan) çevresinde şekillenen bir kültürel miras seçkisini ziyaretçilerle buluşturuyor.',
    'Sergide geleneksel üretim yöntemleri, farklı dönemlere ait nesneler ve çağdaş yorumlar aynı anlatı içinde bir araya getiriliyor.',
    'Küratörler, seçkinin tarihsel malzemeyi bugünün izleyicisine daha açık bir bağlam içinde sunmayı amaçladığını belirtiyor.',
    'Program kapsamında konuşmalar ve atölyeler de düzenleniyor; etkinliklerin ayrıntıları kurumun duyurularında paylaşılacak.'
  ];
  const text = `${paragraphs.join('\\n\\n')} ${'Bu yaklaşım kültürel mirası doğal ve anlaşılır bir Türkçe anlatımla aktarmayı amaçlıyor. '.repeat(8)}`;
  const issues = translationIssues({
    title: 'Pekin’de kültürel mirasa odaklanan yeni sergi kapılarını açtı',
    excerpt: 'Yeni sergi, geleneksel üretim yöntemleriyle çağdaş yorumları bir araya getirerek Çin kültürel mirasına farklı bir bakış sunuyor.',
    paragraphs,
    text
  }, { nativeNames: [{ type: 'institution', turkish: 'Çin Kültürü Müzesi', hanzi: '中国文化博物馆', pinyin: 'Zhongguo Wenhua Bowuguan', verified: true }] });
  assert.ok(!issues.some((item) => item.includes('Pinyin')));
  assert.ok(!issues.some((item) => item.includes('Çince')));
});

test('olgu fişinde doğrulanmamış Çince ad kısa kalıpta olsa da reddedilir', () => {
  const text = `Yeni dizi Orkide Kokusu Hâlâ Aynı (“兰香如故”, Lán Xiāng Rú Gù) adıyla tanıtıldı. ${'Yapım, geleneksel bahçe mimarisini dönem anlatısının bir parçası olarak kullanıyor. '.repeat(10)}`;
  const issues = translationIssues({
    title: 'Çin dönem dizisi için geleneksel bahçe seti kuruldu',
    excerpt: 'Yeni dönem dizisi için kurulan geleneksel bahçe seti, yapımın tarihsel atmosferini gerçek mekân ayrıntılarıyla güçlendiriyor.',
    paragraphs: text.split('\n\n'),
    text
  }, { nativeNames: [] });
  assert.ok(issues.some((item) => item.includes('doğrulanmamış')));
});

test('son okuma doğrulanmış yerel adı silemez veya değiştiremez', () => {
  const nativeNames = [{ type: 'work', turkish: 'Orkide Kokusu Hâlâ Aynı', hanzi: '兰香如故', pinyin: 'Lán Xiāng Rú Gù', verified: true }];
  const before = { text: 'Dizi Orkide Kokusu Hâlâ Aynı (“兰香如故”, Lán Xiāng Rú Gù) adıyla gösterime girdi.' };
  const removed = { text: 'Dizi Orkide Kokusu Hâlâ Aynı adıyla gösterime girdi.' };
  const changed = { text: 'Dizi Orkide Kokusu Hâlâ Aynı (“兰香如旧”, Lán Xiāng Rú Jiù) adıyla gösterime girdi.' };
  assert.equal(nativeNameRegression(before, removed, nativeNames), true);
  assert.equal(nativeNameRegression(before, changed, nativeNames), true);
  assert.equal(nativeNameRegression(before, before, nativeNames), false);
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

test('çeviri kokusu taşıyan kalıpları akıcılık puanında cezalandırır', () => {
  const natural = editorialFluencyProfile({
    title: 'Mağaralarda konser dönemi',
    excerpt: 'Guizhou’daki mağaralar bu sonbaharda konserlere açıldı.',
    text: 'Müzisyenler doğal akustiği kullanarak üç konser verdi. Dinleyiciler yankının performansa kattığı etkiyi salonda izledi.'
  });
  const translated = editorialFluencyProfile({
    title: 'Mağaralar yeni deneyimlere ev sahipliği yapıyor',
    excerpt: 'Bu dönüşümün dikkat çeken örneklerinden biri farklı deneyimsel etkinlikleri bir araya getiriyor.',
    text: 'Mağaralar artık yalnızca doğal güzellikleriyle değil, yeni deneyimler sunmasıyla da öne çıkıyor. Bu yaklaşım yeni bir kültürel alan yaratıyor.'
  });
  assert.ok(translated.translationeseHits >= 3);
  assert.ok(translated.score < natural.score);
});

test('aynı etkinlikteki farklı özneleri mükerrer saymaz', () => {
  assert.equal(likelyDuplicateTitles(
    'ASUS ve Intel, Pekin Moda Haftası’nda yapay zekâ bilgisayarını tanıttı',
    'Heykeltıraş Zhu Bingren, Pekin Moda Haftası’nın açılışını yaptı'
  ), false);
  assert.equal(likelyDuplicateTitles(
    'Yongle Ansiklopedisi’nin iki cildi Çin’e bağışlandı',
    'Paris’ten alınan Yongle Ansiklopedisi’nin iki cildi Çin’e bağışlandı'
  ), true);
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

test('kaynak görsellerinde daha esnek çözünürlük ve oran kabul eder', () => {
  const buffer = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(720, 16);
  buffer.writeUInt32BE(900, 20);
  assert.deepEqual(assertImageDimensions(buffer, 'image/png', { minWidth: 640, minHeight: 360, minRatio: 0.75, maxRatio: 3.2 }), { width: 720, height: 900 });
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
