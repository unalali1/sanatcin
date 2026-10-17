// Historical shadow check of language signals only. The original source body and
// fact ledger are unavailable in WordPress revisions; Stage A cannot be scored.
// node dev/prepublish-quality-audit.mjs ../docs/prepublish-quality-audit-2026-10-17.json
import fs from 'node:fs/promises';
import { newsroomFindings } from '../src/editorial-review.js';
import { prepublishQuality } from '../src/prepublish-quality.js';

const fixture = name => fs.readFile(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse);
const [oldRows, extraRows, excerptRows, package2] = await Promise.all([
  fixture('editorial-2026-10-17.json'), fixture('editorial-2026-10-14-extra.json'),
  fixture('editorial-excerpts-2026-10-17.json'),
  fs.readFile(new URL('../../docs/editorial-quality-audit-2026-10-17.json', import.meta.url), 'utf8').then(JSON.parse)
]);
const excerpts = new Map(excerptRows.map(item => [item.id, item.excerpt]));
const sourceUrls = new Map(package2.rows.map(item => [item.firstRevisionId, item.sourceUrl]));
const plain = value => value.replace(/<[^>]*>/gu, '').replace(/&#(\d+);/gu, (_, number) => String.fromCodePoint(Number(number)))
  .replace(/&(?:nbsp|amp|quot|lt|gt);/gu, match => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' })[match])
  .replace(/\s+/gu, ' ').trim();
const rows = [...oldRows, ...extraRows].filter(row => row.parent > 0).map(row => {
  const paragraphs = [...row.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)].map(match => plain(match[1]));
  const draft = { title: row.title, excerpt: excerpts.get(row.id), paragraphs, text: paragraphs.join('\n\n') };
  // Only B is read below: draft content is *not* independent source evidence.
  const review = prepublishQuality({ source: { url: sourceUrls.get(row.id) || 'https://example.invalid/unavailable', title: row.title, text: draft.text }, draft });
  return { postId: row.parent, firstRevisionId: row.id,
    package2RepairCodes: newsroomFindings(draft).filter(item => item.severity === 'repair').map(item => item.code),
    package3MajorLanguageCodes: review.language.filter(item => item.severity === 'major').map(item => item.code),
    minorLanguageCount: review.language.filter(item => item.severity === 'minor').length };
});
const output = {
  method: 'Same 30 first-published Turkish revisions. Stage B deterministic shadow check; no generation or source fidelity assessment.',
  stageA: 'not assessed: original source bodies and contemporaneous fact sheets not stored with these revisions',
  count: rows.length,
  package2MajorLanguageArticles: rows.filter(row => row.package2RepairCodes.length).length,
  package3MajorLanguageArticles: rows.filter(row => row.package3MajorLanguageCodes.length).length,
  uncertainWithoutNativeNameLedger: rows.filter(row => !row.package2RepairCodes.length && row.package3MajorLanguageCodes.includes('structural_language')).map(row => row.postId),
  package3MinorLanguageArticles: rows.filter(row => row.minorLanguageCount).length,
  rows
};
if (!process.argv[2]) throw new Error('Provide a JSON output path.');
await fs.writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ count: output.count, package2: output.package2MajorLanguageArticles,
  package3: output.package3MajorLanguageArticles, minor: output.package3MinorLanguageArticles }));
