import { readFileSync, writeFileSync, rmSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content, 'utf8');
}

function replaceRequired(content, before, after, label) {
  if (content.includes(after)) return content;
  if (!content.includes(before)) throw new Error(`Patch target not found: ${label}`);
  return content.replace(before, after);
}

// Remove the temporary marker created while validating direct GitHub writes.
rmSync('_tmp_marker', { force: true });

// rank.js — durable source health, stricter fit gate, and 48h source diversity penalty.
{
  const path = 'worker/src/rank.js';
  let content = read(path);
  content = replaceRequired(content,
`      .map((post) => ({
        date: post.date,
        title: stripHtml(post.title?.rendered).slice(0, 180),
        excerpt: stripHtml(post.excerpt?.rendered).slice(0, 220)
      }))`,
`      .map((post) => ({
        date: post.date,
        published_at: post.date,
        source_name: post?.meta?.sanatcin_source_name ?? '',
        source_url: post?.meta?.sanatcin_source_url ?? '',
        title: stripHtml(post.title?.rendered).slice(0, 180),
        excerpt: stripHtml(post.excerpt?.rendered).slice(0, 220)
      }))`,
    'recent editorial context source metadata');

  content = replaceRequired(content,
`    const pages = await wpJson('/wp/v2/pages?slug=sanatcin-source-health&status=private&context=edit&per_page=1&_fields=id,content', { signal });
    const state = parseHealthState(pages?.[0]?.content?.raw ?? '');`,
`    const posts = await wpJson('/wp/v2/posts?slug=sanatcin-source-health-state&status=draft&context=edit&per_page=1&_fields=id,content', { signal });
    const state = parseHealthState(posts?.[0]?.content?.raw ?? '');`,
    'source health read path');

  content = replaceRequired(content,
`export function sourceCrowdingPenalty(previousCount = 0) {
  if (previousCount <= 0) return 0;
  if (previousCount === 1) return 3;
  if (previousCount === 2) return 8;
  return 15;
}
`,
`export function sourceCrowdingPenalty(previousCount = 0) {
  if (previousCount <= 0) return 0;
  if (previousCount === 1) return 3;
  if (previousCount === 2) return 8;
  return 15;
}

export function calculateSameSourcePenalty(sourceName, previousPosts = [], now = new Date()) {
  const normalizedCurrent = String(sourceName ?? '').toLocaleLowerCase('tr-TR').trim();
  if (!normalizedCurrent) return 0;
  const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
  const count = previousPosts.filter((post) => {
    const normalizedPrior = String(post?.source_name ?? '').toLocaleLowerCase('tr-TR').trim();
    const publishedAt = new Date(post?.published_at ?? 0).getTime();
    return normalizedPrior === normalizedCurrent && publishedAt >= cutoff && publishedAt <= now.getTime();
  }).length;
  if (count <= 1) return 0;
  if (count === 2) return 4;
  return 8;
}

function allowFit6Exception(editorialFit, storyStrength, freshness, institutionalEvent, commercialDominant) {
  return editorialFit === 6
    && storyStrength >= 85
    && freshness >= 27
    && !institutionalEvent
    && !commercialDominant;
}
`,
    'source diversity helpers');

  content = replaceRequired(content,
`export function applyAiScores(candidates, items, now = new Date(), sourceHealth = new Map()) {`,
`export function applyAiScores(candidates, items, now = new Date(), sourceHealth = new Map(), previousPosts = []) {`,
    'applyAiScores signature');

  content = replaceRequired(content,
`    const baseEligible = ai.eligible === true && allowedCategories.has(ai.category);
    const eligible = baseEligible
      && editorialFit >= config.minEditorialFit
      && !(commercialDominant && editorialFit <= 6)
      && !health.blocked;`,
`    const baseEligible = ai.eligible === true && allowedCategories.has(ai.category);
    const freshness = freshnessPoints(candidate.publishedAt, now);
    const fit6ExceptionApplied = allowFit6Exception(editorialFit, storyStrength, freshness, institutionalEvent, commercialDominant);
    const eligible = baseEligible
      && (editorialFit >= config.minEditorialFit || fit6ExceptionApplied)
      && !(commercialDominant && editorialFit <= 6)
      && !health.blocked;`,
    'fit 6 exception');

  content = replaceRequired(content,
`    const recentTopicPenalty = recentTopicRepeat ? 10 : 0;
    const sourceHealthPenalty = Number(health.penalty) || 0;
    const rawScore =
      freshnessPoints(candidate.publishedAt, now) +`,
`    const recentTopicPenalty = recentTopicRepeat ? 10 : 0;
    const sourceHealthPenalty = Number(health.penalty) || 0;
    const sameSourcePenalty = calculateSameSourcePenalty(candidate.source?.name, previousPosts, now);
    const rawScore =
      freshness +`,
    'same source score penalty');

  content = replaceRequired(content,
`      recentTopicPenalty -
      sourceHealthPenalty;`,
`      recentTopicPenalty -
      sourceHealthPenalty -
      sameSourcePenalty;`,
    'subtract same source penalty');

  content = replaceRequired(content,
`      sourceHealthPenalty,
      sourceHealthBlocked: health.blocked === true,
      institutionalPenalty,
      commercialPenalty,
      score:`,
`      sourceHealthPenalty,
      sourceHealthBlocked: health.blocked === true,
      sameSourcePenalty,
      fit6ExceptionApplied,
      institutionalPenalty,
      commercialPenalty,
      score:`,
    'expose score adjustments');

  content = replaceRequired(content,
`  const ranked = applyAiScores(shortlist, items, new Date(), sourceHealth);`,
`  const ranked = applyAiScores(shortlist, items, new Date(), sourceHealth, recentContext);`,
    'main rank previous posts');
  content = replaceRequired(content,
`    const rescued = applyAiScores(rescuePool, rescueItems, new Date(), sourceHealth);`,
`    const rescued = applyAiScores(rescuePool, rescueItems, new Date(), sourceHealth, recentContext);`,
    'rescue rank previous posts');
  write(path, content);
}

// quality.js — block production meta-language and detect headline regressions.
{
  const path = 'worker/src/quality.js';
  let content = read(path);
  content = replaceRequired(content,
`  /(?:web|internet|çevrimiçi) (?:editörü|sürümü|sayfası)/iu,
  /okuyucuya.{0,60}(?:sunuluyor|aktarılıyor|veriliyor)/iu
];`,
`  /(?:web|internet|çevrimiçi) (?:editörü|sürümü|sayfası)/iu,
  /okuyucuya.{0,60}(?:sunuluyor|aktarılıyor|veriliyor)/iu,
  /\\bkaynak metne göre\\b|\\bkaynağa göre\\b|\\bmetinde belirtildi(?:ği gibi)?\\b|\\bkaynakta belirtildiği gibi\\b/iu,
  /\\bkaynak,\\s/iu
];`,
    'output meta-language patterns');

  const marker = `export function assertTranslationQuality(article) {`;
  if (!content.includes('export function headlineQualityRegression')) {
    if (!content.includes(marker)) throw new Error('Patch target not found: headline regression insertion');
    const addition = `export function headlineQualityRegression(before = '', after = '') {
  const previous = String(before).trim();
  const current = String(after).trim();
  if (!previous || !current || previous === current) return false;
  const meaningful = /\\b(?:sanat|sanatçı|sergi|eser|film|sinema|moda|tasarım|koleksiyon|festival|müze|edebiyat|tiyatro|opera|mimari|zanaat)\\b/iu;
  const weakAdministrative = /\\b(?:açıkladı|belirtti|duyurdu|kabul etti|düzenlendi|gerçekleştirildi|başkan|müdür|sözcü|gösterim|izlenme|beğeni|takipçi)\\b/iu;
  return meaningful.test(previous) && weakAdministrative.test(current) && !weakAdministrative.test(previous);
}

`;
    content = content.replace(marker, addition + marker);
  }
  write(path, content);
}

// translate.js — prevent meta-language and protect stronger original headlines.
{
  const path = 'worker/src/translate.js';
  let content = read(path);
  content = replaceRequired(content,
`import { translationIssues } from './quality.js';`,
`import { headlineQualityRegression, translationIssues } from './quality.js';`,
    'translate quality import');

  content = replaceRequired(content,
`          'SanatÇin haber merkezinde çalışan kıdemli bir Türkiye Türkçesi editörü ve olgu denetçisisin.',`,
`          'SanatÇin haber merkezinde çalışan kıdemli bir Türkiye Türkçesi editörü ve olgu denetçisisin.',
          "Metnin üretim sürecini anlatan meta-dil kullanma; 'Kaynak metne göre', 'Kaynak, ...' ve 'metinde belirtildi' gibi ifadeler yazma. Bilgi atfedilecekse gerçek kaynak, kişi veya kurum adını kullan.",`,
    'writer meta-language prompt');

  content = replaceRequired(content,
`          'Sen kaynak dilden çeviri yapan biri değil, Türkçe bir haber merkezinin son okuma ve başlık editörüsün.',`,
`          'Sen kaynak dilden çeviri yapan biri değil, Türkçe bir haber merkezinin son okuma ve başlık editörüsün.',
          "Metnin üretim sürecini anlatan meta-dil kullanma; 'Kaynak metne göre', 'Kaynak, ...' ve 'metinde belirtildi' gibi ifadeler yazma. Bilgi atfedilecekse gerçek kaynak, kişi veya kurum adını kullan.",`,
    'polish meta-language prompt');

  content = replaceRequired(content,
`      const polishedIssues = translationIssues(polished.draft);
      if (polishedIssues.length <= prePolishIssues.length) {
        final = polished;`,
`      const polishedIssues = translationIssues(polished.draft);
      const headlineRegression = headlineQualityRegression(prePolish.draft.title, polished.draft.title);
      if (polishedIssues.length <= prePolishIssues.length && !headlineRegression) {
        final = polished;`,
    'headline regression guard');

  content = replaceRequired(content,
`      } else {
        log('warn', 'Türkçe son okuma mekanik kaliteyi düşürdü; önceki taslak korundu', {
          source: article.source.id,
          beforeIssues: prePolishIssues,
          afterIssues: polishedIssues
        });
      }`,
`      } else {
        log('warn', headlineRegression
          ? 'Türkçe son okuma başlık kalitesini düşürdü; önceki taslak korundu'
          : 'Türkçe son okuma mekanik kaliteyi düşürdü; önceki taslak korundu', {
          source: article.source.id,
          beforeIssues: prePolishIssues,
          afterIssues: polishedIssues,
          beforeTitle: prePolish.draft.title,
          afterTitle: polished.draft.title,
          headlineRegression
        });
      }`,
    'headline regression log');
  write(path, content);
}

// wordpress.js — distinguish ordinary featured images from homepage-hero-safe images.
{
  const path = 'worker/src/wordpress.js';
  let content = read(path);
  const resolutionBlock = `function resolutionPreference(dimensions = {}) {
  const width = Number(dimensions.width) || 0;
  const height = Number(dimensions.height) || 0;
  if (width >= 1600 && height >= 900) return 8;
  if (width >= 1200 && height >= 675) return 5;
  if (width >= 900 && height >= 500) return 2;
  return 0;
}
`;
  if (!content.includes('function heroImageEligible')) {
    if (!content.includes(resolutionBlock)) throw new Error('Patch target not found: hero helper insertion');
    const helper = `${resolutionBlock}
function heroImageEligible(dimensions = {}, cropSafe = false, scene = 'other', kind = '') {
  const width = Number(dimensions.width) || 0;
  const height = Number(dimensions.height) || 0;
  if (!cropSafe || width < 1200 || height <= 0) return false;
  const ratio = width / height;
  if (ratio < 1.35 || ratio > 2.1) return false;
  if (kind === 'event-poster' || scene === 'poster' || scene === 'portrait') return false;
  return true;
}
`;
    content = content.replace(resolutionBlock, helper);
  }

  content = replaceRequired(content,
`  image.hasHuman = validation.hasHuman;
  image.cropSafe = validation.cropSafe;
  return image;`,
`  image.hasHuman = validation.hasHuman;
  image.cropSafe = validation.cropSafe;
  image.heroEligible = heroImageEligible(image.dimensions, image.cropSafe, image.scene, image.kind);
  return image;`,
    'generated hero eligibility');

  content = replaceRequired(content,
`        hasHuman: validation.hasHuman,
        cropSafe: validation.cropSafe,
        altText: validation.altText,`,
`        hasHuman: validation.hasHuman,
        cropSafe: validation.cropSafe,
        heroEligible: heroImageEligible(image.dimensions, validation.cropSafe, validation.scene, validation.kind),
        altText: validation.altText,`,
    'source hero eligibility');

  content = replaceRequired(content,
`      hasHuman: best.hasHuman,
      cropSafe: best.cropSafe
    });`,
`      hasHuman: best.hasHuman,
      cropSafe: best.cropSafe,
      heroEligible: best.heroEligible
    });`,
    'source hero log');

  content = replaceRequired(content,
`        hasHuman: generated.hasHuman,
        cropSafe: generated.cropSafe,
        realPersonCentered: article.realPersonCentered === true`,
`        hasHuman: generated.hasHuman,
        cropSafe: generated.cropSafe,
        heroEligible: generated.heroEligible,
        realPersonCentered: article.realPersonCentered === true`,
    'generated hero log');

  content = replaceRequired(content,
`      sanatcin_original_title: article.originalTitle,
      sanatcin_editorial_mode: article.editorialMode`,
`      sanatcin_original_title: article.originalTitle,
      sanatcin_editorial_mode: article.editorialMode,
      sanatcin_hero_eligible: image?.heroEligible ? 1 : 0`,
    'hero post meta');
  write(path, content);
}

// index.js — report the actual package version instead of a stale constant.
{
  const path = 'worker/src/index.js';
  let content = read(path);
  if (!content.includes("import { readFileSync } from 'node:fs';")) {
    content = `import { readFileSync } from 'node:fs';\n` + content;
  }
  if (!content.includes('const WORKER_VERSION =')) {
    const anchor = `import { assertNoSimilarPublishedTitle, knownHashes, prepareFeaturedImage, publishArticle, syncSiteContent } from './wordpress.js';\n`;
    if (!content.includes(anchor)) throw new Error('Patch target not found: worker version anchor');
    content = content.replace(anchor, `${anchor}\nconst WORKER_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? 'unknown';\n`);
  }
  content = replaceRequired(content,
`  setLogContext({ runId, workerVersion: '0.9.1' });`,
`  setLogContext({ runId, workerVersion: WORKER_VERSION });`,
    'worker version log context');
  write(path, content);
}

// WordPress plugin — register hero eligibility metadata used by the homepage.
{
  const path = 'wordpress/plugin/sanatcin-automation/sanatcin-automation.php';
  let content = read(path);
  content = replaceRequired(content, ' * Version: 0.5.0', ' * Version: 0.5.1', 'plugin header version');
  content = replaceRequired(content, "const SANATCIN_AUTOMATION_VERSION = '0.5.0';", "const SANATCIN_AUTOMATION_VERSION = '0.5.1';", 'plugin constant version');
  content = replaceRequired(content,
`    'sanatcin_score' => 'number',
    'sanatcin_original_title' => 'string',`,
`    'sanatcin_score' => 'number',
    'sanatcin_hero_eligible' => 'number',
    'sanatcin_original_title' => 'string',`,
    'hero meta registration');
  write(path, content);
}

// Tests for the new deterministic gates.
{
  const path = 'worker/test/quality-efficiency.test.js';
  const content = `import test from 'node:test';
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
    text: paragraphs.join('\\n\\n')
  });
  assert.ok(issues.some((issue) => issue.includes('editoryal not')));
});

test('son okuma güçlü kültür başlığını idari veya metrik başlığa çeviremez', () => {
  assert.equal(headlineQualityRegression('Çinli gençler geleneksel modayı yeniden yorumluyor', 'Trend 142 milyon gösterime ulaştı'), true);
  assert.equal(headlineQualityRegression('Pekin’de çağdaş sanat sergisi açıldı', 'Pekin’de çağdaş sanat sergisi yeni eserlerle açıldı'), false);
});

test('source health taslak kaydı, dinamik sürüm ve hero meta bağlantıları kodda bulunur', () => {
  const rank = readFileSync(new URL('../src/rank.js', import.meta.url), 'utf8');
  const logger = readFileSync(new URL('../src/logger.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const wordpress = readFileSync(new URL('../src/wordpress.js', import.meta.url), 'utf8');
  assert.match(rank, /sanatcin-source-health-state&status=draft/);
  assert.match(logger, /sanatcin-source-health-state&status=draft/);
  assert.match(index, /WORKER_VERSION/);
  assert.match(wordpress, /sanatcin_hero_eligible/);
});
`;
  write(path, content);
}

console.log('Quality/efficiency patch applied.');
