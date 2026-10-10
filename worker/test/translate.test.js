import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { normalizeInstagramText, translateArticle } from '../src/translate.js';

const article = {
  title: 'New exhibition explores contemporary craft in Shanghai',
  text: 'A new exhibition opened in Shanghai on September 10. The exhibition brings together 42 works by 18 artists. Curator Lin Wei said the selection examines how traditional craft changes through contemporary practice. The programme includes talks and workshops and will remain open until October 20.'.repeat(6),
  url: 'https://example.com/culture/exhibition',
  category: 'kultur-sanat',
  source: { id: 'example-culture', name: 'Example Culture' }
};

const factSheet = {
  publishable: true,
  sourceType: 'article',
  newsValue: 'Yeni bir serginin açılması',
  angle: 'Geleneksel zanaat ile çağdaş üretimi buluşturan sergi',
  facts: [
    'Sergi 10 Eylül tarihinde Şanghay’da açıldı.',
    'Seçkide 18 sanatçının 42 eseri bulunuyor.',
    'Küratörün adı Lin Wei.',
    'Program 20 Ekim’e kadar sürecek.'
  ],
  people: ['Lin Wei'],
  organisations: [],
  places: ['Shanghai'],
  numbers: ['10 September', '42', '18', '20 October'],
  quotes: [],
  context: ['Programda konuşmalar ve atölyeler bulunuyor.']
};

function editorialResult(excerpt = 'Şanghay’da açılan sergi, geleneksel zanaatın çağdaş üretimle kurduğu ilişkiyi 18 sanatçının 42 eseri üzerinden ele alıyor.') {
  return {
    accepted: true,
    issues: [],
    title: 'Şanghay’da çağdaş zanaata odaklanan yeni sergi açıldı',
    excerpt,
    paragraphs: [
      'Geleneksel zanaat ile çağdaş sanat arasındaki ilişkiye odaklanan yeni bir sergi, 10 Eylül’de Şanghay’da kapılarını açtı. Seçki, farklı kuşaklardan 18 sanatçının toplam 42 eserini bir araya getiriyor.',
      'Sergide malzeme, üretim tekniği ve el işçiliğinin güncel sanat pratikleri içindeki yeri inceleniyor. Çalışmalar, geçmişten aktarılan yöntemlerin bugünün ifade biçimleriyle nasıl yeniden yorumlandığını gösteriyor.',
      'Küratör Lin Wei, seçkinin geleneksel zanaatı değişmez bir miras olarak değil, çağdaş üretimle birlikte dönüşen canlı bir alan olarak ele aldığını belirtiyor. Eserlerin yerleştirilme biçimi de bu karşılaşmayı görünür kılmayı amaçlıyor.',
      'Sergiye eşlik eden programda sanatçı konuşmaları ile uygulamalı atölyeler yer alıyor. Ziyaretçiler, yapıtların üretim süreçlerini ve kullanılan malzemeleri bu etkinliklerde daha yakından inceleyebilecek. Program 20 Ekim’e kadar sürecek.'
    ],
    tags: ['Şanghay', 'çağdaş sanat', 'zanaat', 'sergi']
  };
}

test('Instagram metnindeki kaçışlı satır sonları gerçek satır sonlarına çevrilir', () => {
  const input = '🎨 Başlık\\n\\n📍 Açıklama\\n✨ Ayrıntı\\n\\n👉 Haberin tamamı SanatÇin’de.\\n\\n#SanatÇin #Çin';
  const output = normalizeInstagramText(input);
  assert.equal(output, '🎨 Başlık\n\n📍 Açıklama\n✨ Ayrıntı\n\n👉 Haberin tamamı SanatÇin’de.\n\n#SanatÇin #Çin');
  assert.doesNotMatch(output, /\\\\n/);
});

test('olgu çıkarımı, haber yazımı ve Türkçe son okuma ardışık çalışır', async () => {
  const calls = [];
  const completeJson = async (request) => {
    calls.push(request);
    return calls.length === 1 ? { factSheet } : editorialResult();
  };

  const result = await translateArticle(article, { completeJson });

  assert.equal(calls.length, 5);
  assert.equal(calls[0].model, config.openaiFactModel);
  assert.equal(calls[1].model, config.openaiEditorModel);
  assert.equal(calls[2].model, config.openaiEditorModel);
  assert.equal(calls[3].model, config.openaiEditorModel);
  assert.match(calls[2].input[0].content, /son okuma.*editörüsün/);
  assert.match(calls[1].input[0].content, /yalnız haber hammaddesidir/);
  assert.match(calls[1].input[0].content, /Bir Türk gazeteci bu cümleyi gerçekten böyle kurar mı/);
  assert.match(calls[2].input[0].content, /Taslağın bilgi sırasına da bağlı değilsin/);
  assert.match(calls[2].input[0].content, /Cümlenin yabancı dilden çevrildiği hissediliyor mu/);
  assert.match(calls[2].input[0].content, /gerçekten YENİDEN YAZ/);
  assert.match(calls[3].input[0].content, /en az üç farklı başlık açısı üret/);
  assert.match(calls[3].input[1].content, /Başlığa özgü editör uyarıları/);
  assert.match(calls[1].input[0].content, /insani dayanışma hikâyesinde|sıradışı bir iyilikte/);
  assert.doesNotMatch(calls[1].input[1].content, /Kaynak metin:/);
  assert.match(calls[1].input[1].content, /leadFacts/);
  assert.equal(result.editorialMode, 'fact-ledger-turkish-newsroom-v18-instagram-editorial');
  assert.match(result.instagramText, /Haberin tamamı SanatÇin’de\./);
  assert.equal(result.factSheet.facts.length, 4);
  assert.match(result.title, /Şanghay/);
});

test('dil veya biçim notu adayı elemek yerine hedefli düzeltme ve son okuma başlatır', async () => {
  const calls = [];
  const completeJson = async (request) => {
    calls.push(request);
    if (calls.length === 1) return { factSheet };
    if (calls.length === 2) return editorialResult('Kısa spot.');
    return editorialResult();
  };

  const result = await translateArticle(article, { completeJson });

  assert.equal(calls.length, 6);
  assert.equal(calls[2].model, config.openaiEditorModel);
  assert.match(calls[2].input[1].content, /Spot 105-180 karakter aralığında değil/);
  assert.match(calls[3].input[0].content, /son okuma.*editörüsün/);
  assert.ok(result.excerpt.length >= 105);
});

test('değişen son okuma güçlü editör hakemi daha doğal bulursa ana sürüm olur', async () => {
  const calls = [];
  const first = editorialResult();
  const polished = { ...editorialResult(), title: 'Şanghay’daki sergi çağdaş zanaata yeni bir yorum getiriyor' };
  const completeJson = async (request) => {
    calls.push(request);
    if (calls.length === 1) return { factSheet };
    if (calls.length === 2) return first;
    if (calls.length === 3) return polished;
    if (calls.length === 4) return { preferred: 'B', reason: 'B, aynı olguları daha doğal Türkiye Türkçesiyle aktarıyor.', aScore: 84, bScore: 94 };
    return { title: polished.title, reason: 'Mevcut başlık korunmalı.' };
  };

  const result = await translateArticle(article, { completeJson });

  assert.equal(calls.length, 6);
  assert.equal(calls[3].model, config.openaiEditorModel);
  assert.match(calls[3].input[0].content, /B ise çeviri kokusunu gidermek/);
  assert.match(calls[3].input[1].content, /Doğrulanmış olgu fişi/);
  assert.equal(result.title, polished.title);
});

test('hakem eski sürümü seçerse akıcı sürüm geri atılmadan onarılıp yeniden değerlendirilir', async () => {
  const calls = [];
  const first = editorialResult();
  const polished = { ...editorialResult(), title: 'Şanghay’daki sergi çağdaş zanaatı bugünün diliyle yorumluyor' };
  const repaired = {
    ...polished,
    paragraphs: [
      polished.paragraphs[0],
      polished.paragraphs[1],
      polished.paragraphs[2],
      'Sergiye eşlik eden programda sanatçı konuşmaları ve atölyeler bulunuyor. Toplam 42 eserin yer aldığı sergi 20 Ekim’e kadar açık kalacak.'
    ]
  };
  const completeJson = async (request) => {
    calls.push(request);
    if (calls.length === 1) return { factSheet };
    if (calls.length === 2) return first;
    if (calls.length === 3) return polished;
    if (calls.length === 4) return { preferred: 'A', reason: 'B sürümünde program ayrıntısı daha zayıf kalmış.', aScore: 90, bScore: 86 };
    if (calls.length === 5) return repaired;
    if (calls.length === 6) return { preferred: 'B', reason: 'Eksik ayrıntı tamamlandı; B artık daha doğal ve aynı ölçüde doğru.', aScore: 88, bScore: 95 };
    return { title: repaired.title, reason: 'Başlık doğal ve yeterince somut.' };
  };

  const result = await translateArticle(article, { completeJson });

  assert.equal(calls.length, 8);
  assert.match(calls[4].input[1].content, /Eski sürümün yabancı dilden çevrilmiş hissi veren cümle yapısına dönme/);
  assert.equal(calls[5].model, config.openaiEditorModel);
  assert.equal(result.title, repaired.title);
  assert.match(result.text, /42 eserin/);
});

test('düşük Türkçe doğallık puanı yayını kesmeden hedefli düzeltme başlatır', async () => {
  const calls = [];
  const awkward = {
    ...editorialResult(),
    paragraphs: [
      'Sergi artık yalnızca geleneksel zanaatı göstermiyor, farklı deneyimsel etkinlikleri de bir araya getiriyor. Bu dönüşümün dikkat çeken örneklerinden biri olarak yeni bir kültürel alan yaratıyor.',
      'Bu yaklaşım izleyicilere yeni bir deneyim sunuyor ve üretim süreçlerinin deneyimlenmesini mümkün kılıyor. Etkinlik, farklı deneyimleri aynı model içinde bir araya getiriyor.',
      'Program, sanatçılara daha geniş bir söz alanı açıyor. Bu dönüşüm, çağdaş zanaatın öne çıkan örneklerinden biri olarak dikkat çekiyor.',
      'Sergi 20 Ekim’e kadar açık kalacak. Programda konuşmalar ve atölyeler düzenlenecek; toplam 42 eser ziyaretçilerle buluşacak.'
    ]
  };
  const completeJson = async (request) => {
    calls.push(request);
    if (calls.length === 1) return { factSheet };
    if (calls.length === 2) return awkward;
    return editorialResult();
  };

  await translateArticle(article, { completeJson });

  assert.equal(calls.length, 6);
  assert.match(calls[2].input[1].content, /Türkçe doğallık puanı düşük/);
});


test('başlık mikro-editörü ancak bağımsız hakem açıkça daha iyi bulursa kabul edilir', async () => {
  const calls = [];
  const original = editorialResult();
  const proposedTitle = 'Şanghay’da 42 eser çağdaş zanaatın dönüşümünü anlatıyor';
  const completeJson = async (request) => {
    calls.push(request);
    if (calls.length === 1) return { factSheet };
    if (calls.length === 2) return original;
    if (calls.length === 3) return original;
    if (calls.length === 4) return { title: proposedTitle, reason: 'Sayıyı öne çıkarıyor.' };
    return { preferred: 'A', reason: 'Mevcut başlık hikâyeyi daha doğal ve güçlü anlatıyor.', aScore: 9, bScore: 7 };
  };

  const result = await translateArticle(article, { completeJson });

  assert.equal(calls.length, 6);
  assert.equal(calls[4].model, config.openaiEditorModel);
  assert.equal(result.title, original.title);
});

test('duplicate first draft stops before polish, repair and headline requests', async () => {
  let calls = 0;
  await assert.rejects(translateArticle(article, {
    completeJson: async () => ++calls === 1 ? { factSheet } : editorialResult(),
    validateDraft: async () => { throw new Error('Benzer haber daha önce yayımlanmış'); }
  }), /Benzer haber/);
  assert.equal(calls, 2);
});

test('nonduplicate early guard adds no AI call to the normal pipeline', async () => {
  let calls = 0;
  let checks = 0;
  await translateArticle(article, {
    completeJson: async () => ++calls === 1 ? { factSheet } : editorialResult(),
    validateDraft: async () => { checks += 1; }
  });
  assert.equal(calls, 5);
  assert.equal(checks, 1);
});
