import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAiScores, buildBalancedShortlist, diversifyBySource, diversifyByTopic, isNearTopicRepeat, looksLikeCinemaCandidate, rerankInputsResilient, selectCinemaRescueCandidates, sourceCrowdingPenalty } from '../src/rank.js';

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

test('aynı kaynaktan tekrar yayınlandıkça yumuşak çeşitlilik cezası artar', () => {
  assert.equal(sourceCrowdingPenalty(0), 0);
  assert.equal(sourceCrowdingPenalty(1), 3);
  assert.equal(sourceCrowdingPenalty(2), 8);
  assert.equal(sourceCrowdingPenalty(3), 15);
  assert.equal(sourceCrowdingPenalty(5), 15);
});

test('aynı konudaki adayları elemeden kuyruğa dağıtır', () => {
  const input = [
    { id: 'a', title: 'Şanghay çağdaş sanat sergisi yeni eserlerle açıldı' },
    { id: 'b', title: 'Şanghay çağdaş sanat sergisi yeni yapıtlarla açıldı' },
    { id: 'c', title: 'Pekin film festivali uluslararası seçkisini açıkladı' }
  ];
  assert.deepEqual(diversifyByTopic(input).map((item) => item.id), ['a', 'c', 'b']);
});

test('AI konu kümesi aynı olayı farklı başlıklarda da yakalar', () => {
  const prior = { title: 'Bir tasarımcının yeni koleksiyonu', topicCluster: 'beijing-fashion-week-2026' };
  const candidate = { title: 'Başkentte podyuma çıkan başka bir marka', topicCluster: 'BEIJING-FASHION-WEEK-2026' };
  assert.equal(isNearTopicRepeat(candidate, [prior]), true);
});

test('farklı konu kümelerini portföy tekrarı saymaz', () => {
  const prior = { title: 'Şanghay müzesinde bronz eserler', topicCluster: 'shanghai-bronze-exhibition' };
  const candidate = { title: 'Pekin film festivalinin yarışma seçkisi', topicCluster: 'beijing-film-festival' };
  assert.equal(isNearTopicRepeat(candidate, [prior]), false);
});


test('sinema adaylarını AI kısa listesinde ayrı bir rezervle korur', () => {
  const source = { id: 'culture', name: 'Culture', quality: 9 };
  const candidates = [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `culture-${index}`,
      title: `Çağdaş sanat sergisi ${index}`,
      summary: 'Yeni sergi farklı sanatçıları buluşturuyor.',
      category: 'kultur-sanat',
      eligible: true,
      score: 100 - index,
      source
    })),
    {
      id: 'hidden-film',
      title: 'Yeni Çin filmi uluslararası festivalde ilk gösterimini yaptı',
      summary: 'Yönetmen ve oyuncular filmin prömiyerine katıldı.',
      category: 'kultur-sanat',
      eligible: true,
      score: 55,
      source
    }
  ];
  const shortlist = buildBalancedShortlist(candidates, 8);
  assert.equal(looksLikeCinemaCandidate(candidates.at(-1)), true);
  assert.ok(shortlist.some((item) => item.id === 'hidden-film'));
});

test('aynı yayıncı ailesindeki farklı kaynakları çeşitlilikte tek grup sayar', () => {
  const input = [
    { id: 'cd-culture-1', score: 100, source: { id: 'cd-culture', publisherGroup: 'china-daily-network' } },
    { id: 'cd-fashion-1', score: 99, source: { id: 'cd-fashion', publisherGroup: 'china-daily-network' } },
    { id: 'cgtn-1', score: 90, source: { id: 'cgtn', publisherGroup: 'cgtn' } },
    { id: 'xinhua-1', score: 80, source: { id: 'xinhua', publisherGroup: 'xinhua' } }
  ];
  assert.deepEqual(
    diversifyBySource(input).map((item) => item.id),
    ['cd-culture-1', 'cgtn-1', 'xinhua-1', 'cd-fashion-1']
  );
});


test('AI kısa listesi tek yayıncı ailesinin havuzu kaplamasını önler', () => {
  const make = (group, count, base) => Array.from({ length: count }, (_, index) => ({
    id: `${group}-${index}`,
    title: `Kültür haberi ${group} ${index}`,
    summary: 'Sanat ve kültür alanında yeni bir gelişme.',
    category: 'kultur-sanat',
    eligible: true,
    score: base - index,
    source: { id: `${group}-source`, publisherGroup: group, name: group, quality: 9 }
  }));
  const shortlist = buildBalancedShortlist([
    ...make('dominant', 40, 100),
    ...make('publisher-b', 8, 90),
    ...make('publisher-c', 8, 89),
    ...make('publisher-d', 8, 88)
  ], 20);
  const dominantCount = shortlist.filter((item) => item.source.publisherGroup === 'dominant').length;
  assert.equal(shortlist.length, 20);
  assert.ok(dominantCount <= 6);
  assert.ok(new Set(shortlist.map((item) => item.source.publisherGroup)).size >= 4);
});

test('post-AI sinema kurtarma yalnız elenen veya yanlış kategorilenen sinema adaylarını seçer', () => {
  const shortlist = [
    { id: 'film-a', title: 'Yeni film festivalde gösterildi', category: 'sinema', score: 90, source: { id: 'a', publisherGroup: 'a' } },
    { id: 'film-b', title: 'Yeni drama dizisi yayına başladı', category: 'sinema', score: 85, source: { id: 'b', publisherGroup: 'b' } },
    { id: 'film-c', title: 'Belgesel yönetmeni yeni yapımını anlattı', category: 'sinema', score: 80, source: { id: 'c', publisherGroup: 'c' } },
    { id: 'art-a', title: 'Yeni sergi açıldı', category: 'kultur-sanat', score: 95, source: { id: 'd', publisherGroup: 'd' } }
  ];
  const ranked = [
    { ...shortlist[0], eligible: true, category: 'sinema' },
    { ...shortlist[1], eligible: false, category: 'uygunsuz' },
    { ...shortlist[2], eligible: true, category: 'kultur-sanat' },
    { ...shortlist[3], eligible: true, category: 'kultur-sanat' }
  ];
  assert.deepEqual(selectCinemaRescueCandidates(shortlist, ranked).map((item) => item.id), ['film-b', 'film-c']);
});


test('iyi haber yanlış kategoriye sırf kota için zorlanmaz', () => {
  const now = new Date('2026-09-27T02:00:00Z');
  const candidate = {
    id: 'mooncake',
    title: 'China’s mooncakes get a fresh twist',
    summary: 'New fillings and lighter recipes reshape Mid-Autumn mooncakes.',
    publishedAt: '2026-09-27T01:00:00Z',
    source: { id: 'cgtn-culture', name: 'CGTN Culture', quality: 9 }
  };
  const [ranked] = applyAiScores([candidate], [{
    id: 'mooncake',
    eligible: true,
    category: 'moda-tasarim',
    fit: 8,
    categoryFit: 4,
    interest: 80,
    relevance: 80,
    storyStrength: 75,
    institutionalEvent: false,
    commercialDominant: false,
    recentTopicRepeat: false,
    topicCluster: 'mid-autumn-mooncake-2026',
    contentType: 'city-life',
    reason: 'Gastronomi ana konu; tasarım tali.'
  }], now);
  assert.equal(ranked.eligible, false);
  assert.equal(ranked.category, 'uygunsuz');
  assert.equal(ranked.categoryFit, 4);
});

test('yakın eşikteki güvenli kültür haberi yalnız minimum hedef rezervine alınır', () => {
  const candidate = {
    id: 'reserve',
    title: 'Neighbourhood craft workshops open to the public',
    summary: 'A city programme connects residents with working craftspeople.',
    publishedAt: new Date().toISOString(),
    source: { id: 'trusted', name: 'Trusted Source', quality: 9 }
  };
  const [ranked] = applyAiScores([candidate], [{
    id: 'reserve', eligible: false, category: 'sehir-yasam', fit: 6, categoryFit: 6,
    interest: 70, relevance: 75, storyStrength: 70, institutionalEvent: false,
    commercialDominant: false, recentTopicRepeat: false, reason: 'Gerçek ama ikincil şehir kültürü haberi.'
  }]);
  assert.equal(ranked.eligible, false);
  assert.equal(ranked.minimumTargetRescue, true);
  assert.equal(ranked.rescueCategory, 'sehir-yasam');
  assert.ok(ranked.rescueScore >= 50);
});

