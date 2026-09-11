import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { translateArticle } from '../src/translate.js';

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

test('olgu çıkarımı ve Türkçe haber yazımı farklı modellerle ardışık çalışır', async () => {
  const calls = [];
  const completeJson = async (request) => {
    calls.push(request);
    return calls.length === 1 ? { factSheet } : editorialResult();
  };

  const result = await translateArticle(article, { completeJson });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, config.openaiFactModel);
  assert.equal(calls[1].model, config.openaiEditorModel);
  assert.equal(result.editorialMode, 'fact-ledger-turkish-newsroom-v5');
  assert.equal(result.factSheet.facts.length, 4);
  assert.match(result.title, /Şanghay/);
});

test('dil veya biçim notu adayı elemek yerine tek hedefli düzeltme başlatır', async () => {
  const calls = [];
  const completeJson = async (request) => {
    calls.push(request);
    if (calls.length === 1) return { factSheet };
    if (calls.length === 2) return editorialResult('Kısa spot.');
    return editorialResult();
  };

  const result = await translateArticle(article, { completeJson });

  assert.equal(calls.length, 3);
  assert.equal(calls[2].model, config.openaiEditorModel);
  assert.match(calls[2].input[1].content, /Spot 105-180 karakter aralığında değil/);
  assert.ok(result.excerpt.length >= 105);
});
