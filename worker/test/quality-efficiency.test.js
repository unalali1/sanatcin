import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../src/config.js';
import { applyAiScores, calculateSameSourcePenalty } from '../src/rank.js';
import { headlineQualityRegression, translationIssues } from '../src/quality.js';

test('daha sıkı editoryal eşik ve daha küçük AI partisi varsayılanları kullanılır', () => {
  assert.equal(config.minEditorialFit, 7);
  assert.equal(config.maxAiCandidates, 60);
  assert.equal(config.aiBatchSize, 15);
  assert.equal(config.aiRerankConcurrency, 2);
});

test('fit 6 yalnız çok güçlü ve taze hikâyede istisna olarak geçer', () => {
  const now = new Date('2026-09-17T10:00:00Z');
  const candidate = { id: 'x', title: 'Museum story', summary: 'art', publishedAt: '2026-09-16T10:00:00Z', source: { id: 's', name: 'Source', quality: 9 } };
  const strong = applyAiScores([candidate], [{ id: 'x', eligible: true, category: 'kultur-sanat', fit: 6, interest: 80, relevance: 90, storyStrength: 85 }], now)[0];
  const weak = applyAiScores([candidate], [{ id: 'x', eligible: true, category: 'kultur-sanat', fit: 6, interest: 80, relevance: 90, storyStrength: 84 }], now)[0];
  assert.equal(strong.eligible, true);
  assert.equal(strong.fit6ExceptionApplied, true);
  assert.equal(weak.eligible, false);
});

test('48 saatlik kaynak çeşitlilik cezası iki ve üç tekrar için uygulanır', () => {
  const now = new Date('2026-09-17T10:00:00Z');
  const one = [{ source_name: 'China Daily – Culture', published_at: '2026-09-17T01:00:00Z' }];
  const two = [...one, { source_name: 'China Daily – Culture', published_at: '2026-09-16T12:00:00Z' }];
  const three = [...two, { source_name: 'China Daily – Culture', published_at: '2026-09-16T05:00:00Z' }];
  assert.equal(calculateSameSourcePenalty('China Daily – Culture', one, now), 0);
  assert.equal(calculateSameSourcePenalty('China Daily – Culture', two, now), 4);
  assert.equal(calculateSameSourcePenalty('China Daily – Culture', three, now), 8);
});

test('üretim sürecini ele veren kaynak meta-dili kalite sorunu sayılır', () => {
  const paragraphs = [
    'Kaynak metne göre sergi bugün açıldı ve ziyaretçilere yeni eserler sunuyor.',
    'Sergide farklı dönemlerden sanatçıların çalışmaları bir araya getiriliyor.',
    'Program hafta boyunca çeşitli etkinliklerle devam edecek ve ziyaretçilere açık olacak.'
  ];
  const issues = translationIssues({
    title: 'Pekin’de yeni çağdaş sanat sergisi kapılarını açtı',
    excerpt: 'Yeni sergi, farklı dönemlerden sanatçıların eserlerini bir araya getirerek ziyaretçilere kapsamlı bir seçki sunuyor.',
    paragraphs,
    text: paragraphs.join('\n\n')
  });
  assert.ok(issues.some((issue) => issue.includes('editoryal not')));
});

test('son okuma güçlü kültür başlığını idari veya metrik başlığa çeviremez', () => {
  assert.equal(headlineQualityRegression('Çinli gençler geleneksel modayı yeniden yorumluyor', 'Trend 142 milyon gösterime ulaştı'), true);
  assert.equal(headlineQualityRegression('Pekin’de çağdaş sanat sergisi açıldı', 'Pekin’de çağdaş sanat sergisi yeni eserlerle açıldı'), false);
});

test('açıklayıcı yabancı kültür-sanat adları doğal Türkçeye aktarılır', () => {
  const translate = readFileSync(new URL('../src/translate.js', import.meta.url), 'utf8');
  assert.match(translate, /açıklayıcı nitelikteyse anlamını koruyan doğal bir Türkçe karşılık üret/);
  assert.match(translate, /Okur İngilizce bilmeden metni anlayabilmeli/);
  assert.match(translate, /gereksiz biçimde İngilizce bırakılmış açıklayıcı sergi/);
  assert.doesNotMatch(translate, /Yerleşik karşılığı olmayan eser ve etkinlik adlarını uydurma biçimde çevirmeden özgün adıyla koru/);
});

test('source health taslak kaydı, dinamik sürüm ve hero meta bağlantıları kodda bulunur', () => {
  const rank = readFileSync(new URL('../src/rank.js', import.meta.url), 'utf8');
  const logger = readFileSync(new URL('../src/logger.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const wordpress = readFileSync(new URL('../src/wordpress.js', import.meta.url), 'utf8');
  const fetchSource = readFileSync(new URL('../src/fetch.js', import.meta.url), 'utf8');
  assert.match(rank, /sanatcin-source-health-state&status=draft/);
  assert.match(logger, /sanatcin-source-health-state&status=draft/);
  assert.match(logger, /export async function flushLogs/);
  assert.match(index, /WORKER_VERSION/);
  assert.match(index, /await flushLogs\(\)/);
  assert.match(index, /process\.exit\(exitCode\)/);
  assert.match(fetchSource, /VirtualConsole/);
  assert.match(fetchSource, /dom\.window\.close\(\)/);
  assert.match(wordpress, /sanatcin_hero_eligible/);
});
