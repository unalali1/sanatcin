import test from 'node:test';
import assert from 'node:assert/strict';
import { DOSSIER_TOPICS } from '../src/dossier-topics.js';
import { dossierPostMatchesTopic } from '../src/dossier-wordpress.js';
import {
  chooseDossierCandidate,
  runDossierPublisher,
  validateDossierCandidate
} from '../src/dossier-publisher.js';

const NOW = new Date('2026-09-28T02:00:00Z');
const DOSSIER_CATEGORY_ID = 10;

function completedContent() {
  return '<p>' + 'Tamamlanmış, kaynaklı ve editoryal olarak hazırlanmış dosya içeriği. '.repeat(30) + '</p>';
}

function topic(slug) {
  return DOSSIER_TOPICS.find((item) => item.slug === slug);
}

function draftPost(id, topicSlug, overrides = {}) {
  const item = topic(topicSlug);
  return {
    id,
    status: 'draft',
    slug: `cin-sanatlari-dosyasi-${topicSlug}`,
    title: { rendered: item.title },
    content: { rendered: completedContent() },
    categories: [DOSSIER_CATEGORY_ID, 2],
    featured_media: 900 + id,
    date_gmt: '2026-09-25T01:00:00',
    link: `https://sanatcin.com/?p=${id}`,
    author: 2,
    ...overrides
  };
}

function publishedPost(id, topicSlug, overrides = {}) {
  const item = topic(topicSlug);
  return {
    id,
    status: 'publish',
    slug: `cin-sanatlari-dosyasi-${topicSlug}`,
    title: { rendered: item.title },
    content: { rendered: completedContent() },
    categories: [DOSSIER_CATEGORY_ID, 2],
    featured_media: 700 + id,
    date_gmt: '2026-09-14T02:00:00',
    link: `https://sanatcin.com/cin-sanatlari-dosyasi-${topicSlug}/`,
    author: 2,
    ...overrides
  };
}

function fakeClient({ drafts = [], published = [], publishDate = '2026-09-28T02:00:00' } = {}) {
  const draftItems = drafts.map((item) => structuredClone(item));
  const publishedItems = published.map((item) => structuredClone(item));
  const publishCalls = [];

  return {
    publishCalls,
    async categoryId() {
      return DOSSIER_CATEGORY_ID;
    },
    async listDrafts() {
      return draftItems.map((item) => structuredClone(item));
    },
    async listPublished() {
      return publishedItems.map((item) => structuredClone(item));
    },
    async publishPost(id) {
      publishCalls.push(id);
      const index = draftItems.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`draft not found: ${id}`);
      const draft = draftItems.splice(index, 1)[0];
      const publishedPostValue = {
        ...draft,
        status: 'publish',
        date_gmt: publishDate,
        link: `https://sanatcin.com/${draft.slug}/`
      };
      publishedItems.unshift(publishedPostValue);
      return structuredClone(publishedPostValue);
    }
  };
}

const silentLogger = () => {};

test('önceki haftanın aynı konusu tekrar yayımlanmaz', () => {
  const candidate = draftPost(701, 'suzhou-nakisi');
  const history = [publishedPost(601, 'suzhou-nakisi', { date_gmt: '2026-09-18T02:00:00' })];
  const result = validateDossierCandidate(candidate, {
    dossierCategoryId: DOSSIER_CATEGORY_ID,
    publishedPosts: history,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.equal(result.checks.topicUnused, false);
  assert.ok(result.reasons.includes('topicUnused'));
});

test('farklı WordPress yazarı tarafından yayımlanmış eski dosya geçmişte görülür', () => {
  const candidate = draftPost(702, 'pipa', { author: 2 });
  const history = [publishedPost(602, 'pipa', { author: 99, date_gmt: '2026-08-10T02:00:00' })];
  const result = validateDossierCandidate(candidate, {
    dossierCategoryId: DOSSIER_CATEGORY_ID,
    publishedPosts: history,
    now: NOW
  });
  assert.equal(result.valid, false);
  assert.equal(result.checks.topicUnused, false);
});

test('legacy kaligrafi ID 221 ve mürekkep resmi ID 228 konu kimliği olarak tanınır', () => {
  assert.equal(dossierPostMatchesTopic({
    id: 221,
    slug: 'eski-manuel-kayit',
    title: { rendered: 'Arşiv yazısı' }
  }, topic('cin-kaligrafisi')), true);

  assert.equal(dossierPostMatchesTopic({
    id: 228,
    slug: 'eski-manuel-kayit',
    title: { rendered: 'Arşiv yazısı' }
  }, topic('murekkep-resmi')), true);
});

test('placeholder taslak yayımlanmaz ve geçerli eski taslağı bloke etmez', async () => {
  const placeholder = draftPost(704, 'jingtailan-cloisonne', {
    date_gmt: '2026-09-27T01:00:00',
    content: { rendered: '<p>Taslak hazırlanıyor.</p>' }
  });
  const valid = draftPost(703, 'suzhou-nakisi', { date_gmt: '2026-09-26T01:00:00' });
  const client = fakeClient({ drafts: [placeholder, valid] });

  const result = await runDossierPublisher({ now: NOW, client, logger: silentLogger });
  assert.equal(result.status, 'published');
  assert.equal(result.postId, 703);
  assert.deepEqual(client.publishCalls, [703]);
});

test('featured image olmayan taslak yayımlanmaz', async () => {
  const client = fakeClient({
    drafts: [draftPost(705, 'jingtailan-cloisonne', { featured_media: 0 })]
  });
  const result = await runDossierPublisher({ now: NOW, client, logger: silentLogger });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no_valid_dossier_draft');
  assert.equal(client.publishCalls.length, 0);
});

test('aynı ISO haftasında yayımlanmış dosya varsa ikinci yayın yapılmaz', async () => {
  const client = fakeClient({
    drafts: [draftPost(706, 'jingtailan-cloisonne')],
    published: [publishedPost(606, 'suzhou-nakisi', { date_gmt: '2026-09-28T00:30:00' })]
  });
  const result = await runDossierPublisher({ now: NOW, client, logger: silentLogger });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'already_published_this_iso_week');
  assert.equal(client.publishCalls.length, 0);
});

test('birden fazla uygun taslak varsa en yeni geçerli taslak seçilir', () => {
  const older = draftPost(707, 'jingtailan-cloisonne', { date_gmt: '2026-09-24T01:00:00' });
  const newer = draftPost(708, 'suzhou-nakisi', { date_gmt: '2026-09-27T01:00:00' });
  const selection = chooseDossierCandidate([older, newer], {
    dossierCategoryId: DOSSIER_CATEGORY_ID,
    publishedPosts: [],
    now: NOW
  });
  assert.equal(selection.candidate.id, 708);
});

test('geçerli taslak pazartesi publisher jobında publish edilir', async () => {
  const client = fakeClient({ drafts: [draftPost(709, 'jingtailan-cloisonne')] });
  const result = await runDossierPublisher({ now: NOW, client, logger: silentLogger });
  assert.equal(result.status, 'published');
  assert.equal(result.postId, 709);
  assert.equal(result.topicSlug, 'jingtailan-cloisonne');
  assert.deepEqual(client.publishCalls, [709]);
});

test('publisher ikinci kez çalıştığında aynı yazıyı tekrar yayımlamaz', async () => {
  const client = fakeClient({ drafts: [draftPost(710, 'jingtailan-cloisonne')] });
  const first = await runDossierPublisher({ now: NOW, client, logger: silentLogger });
  const second = await runDossierPublisher({ now: NOW, client, logger: silentLogger });

  assert.equal(first.status, 'published');
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'already_published_this_iso_week');
  assert.deepEqual(client.publishCalls, [710]);
});
