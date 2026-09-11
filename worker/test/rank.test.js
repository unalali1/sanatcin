import test from 'node:test';
import assert from 'node:assert/strict';
import { diversifyBySource, rerankInputsResilient } from '../src/rank.js';

const silentLogger = () => {};

test('başarısız büyük partiyi iki küçük parçaya bölerek kurtarır', async () => {
  const input = Array.from({ length: 4 }, (_, index) => ({ id: String(index + 1) }));
  const calls = [];
  const rerank = async (batch) => {
    calls.push(batch.map((item) => item.id));
    if (batch.length === 4) throw new Error('Request timed out.');
    return batch.map((item) => ({ ...item, eligible: true }));
  };

  const items = await rerankInputsResilient(input, {
    batchSize: 4,
    concurrency: 1,
    rerank,
    logger: silentLogger
  });

  assert.deepEqual(items.map((item) => item.id), ['1', '2', '3', '4']);
  assert.deepEqual(calls, [['1', '2', '3', '4'], ['1', '2'], ['3', '4']]);
});

test('bir partinin hatasında diğer partinin başarılı sonuçlarını korur', async () => {
  const input = Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1) }));
  const rerank = async (batch) => {
    if (batch.some((item) => Number(item.id) <= 3)) throw new Error('geçici hata');
    return batch.map((item) => ({ ...item, eligible: true }));
  };

  const items = await rerankInputsResilient(input, {
    batchSize: 3,
    concurrency: 2,
    rerank,
    logger: silentLogger
  });

  assert.deepEqual(items.map((item) => item.id), ['4', '5', '6']);
});

test('bütün partiler ve alt parçalar başarısızsa güvenli biçimde durur', async () => {
  const input = [{ id: '1' }, { id: '2' }];
  await assert.rejects(
    rerankInputsResilient(input, {
      batchSize: 2,
      concurrency: 1,
      rerank: async () => { throw new Error('servis kullanılamıyor'); },
      logger: silentLogger
    }),
    /Tüm yapay zekâ sıralama partileri başarısız/
  );
});

test('kategori kuyruğunu puanı koruyarak kaynaklar arasında dönüşümlü kurar', () => {
  const source = (id) => ({ id });
  const input = [
    { id: 'a1', score: 100, source: source('a') },
    { id: 'a2', score: 99, source: source('a') },
    { id: 'a3', score: 98, source: source('a') },
    { id: 'b1', score: 90, source: source('b') },
    { id: 'c1', score: 80, source: source('c') },
    { id: 'b2', score: 70, source: source('b') }
  ];

  assert.deepEqual(
    diversifyBySource(input).map((item) => item.id),
    ['a1', 'b1', 'c1', 'a2', 'b2', 'a3']
  );
});
