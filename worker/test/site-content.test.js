import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE_PAGES } from '../src/site-content.js';

test('kurumsal sayfalar ve AI görsel açıklaması yayın paketinde bulunur', () => {
  assert.deepEqual(SITE_PAGES.map((page) => page.slug), ['hakkimizda', 'yayin-ilkeleri', 'iletisim']);
  assert.match(SITE_PAGES.find((page) => page.slug === 'yayin-ilkeleri').content, /AI ile üretilmiş temsili editoryal illüstrasyon\./);
  assert.match(SITE_PAGES.find((page) => page.slug === 'iletisim').content, /editor@sanatcin\.com/);
});
