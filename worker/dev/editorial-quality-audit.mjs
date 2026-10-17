// Offline audit of actual first publications. No model call, write to WP, or deploy.
// node dev/editorial-quality-audit.mjs ../docs/editorial-quality-audit-2026-10-17.json
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { newsroomFindings } from '../src/editorial-review.js';
import { headlineEditorialWarnings, editorialFluencyProfile, numericFactRegression } from '../src/quality.js';

const baseline = '6df7ff2de7e235127a2cdc7403a9d9a9c91d1e08';
const oldReviewSource = execFileSync('git', ['show', `${baseline}:worker/src/editorial-review.js`], { encoding: 'utf8' });
const oldReviewUrl = `data:text/javascript;base64,${Buffer.from(oldReviewSource).toString('base64')}`;
const oldQualitySource = execFileSync('git', ['show', `${baseline}:worker/src/quality.js`], { encoding: 'utf8' })
  .replace("from './editorial-review.js'", `from '${oldReviewUrl}'`);
const oldReview = await import(oldReviewUrl);
const oldQuality = await import(`data:text/javascript;base64,${Buffer.from(oldQualitySource).toString('base64')}`);
const fixture = name => fs.readFile(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse);
const [a, b, excerptRows] = await Promise.all([
  fixture('editorial-2026-10-17.json'), fixture('editorial-2026-10-14-extra.json'), fixture('editorial-excerpts-2026-10-17.json')
]);
const excerpts = new Map(excerptRows.map(row => [row.id, row.excerpt]));
const all = [...a, ...b];
const first = all.filter(row => row.parent > 0);
const manual = new Map(all.filter(row => row.parent === 0).map(row => [row.id, row]));
const entity = value => value.replace(/&#(\d+);/gu, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(?:nbsp|amp|quot|lt|gt);/gu, token => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' })[token]);
const plain = value => entity(value.replace(/<[^>]*>/gu, '')).replace(/\s+/gu, ' ').trim();
function draft(row) {
  const paragraphs = [...row.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)].map(match => plain(match[1]));
  return { title: row.title, excerpt: excerpts.get(row.id) ?? '', paragraphs, text: paragraphs.join('\n\n') };
}
const stop = new Set(['ve','ile','bir','bu','için','da','de','ise','daha','olan','olarak','şanghay','çin']);
function overlap(d) {
  const words = value => new Set((value.toLocaleLowerCase('tr-TR').match(/\p{L}+/gu) ?? []).filter(x => x.length >= 4 && !stop.has(x)));
  const title = words(d.title), spot = words(d.excerpt);
  return title.size ? [...title].filter(word => spot.has(word)).length / title.size : 0;
}
function countWords(d) { return (d.text.match(/\p{L}+/gu) ?? []).length; }
function summarize(findings, headlineWarnings, words, fluency, repetitions) {
  const repairs = findings.filter(x => x.severity === 'repair');
  return {
    mechanicalFindingCount: repairs.length,
    mechanicalPer1000Words: words ? Math.round(repairs.length * 1000 / words * 100) / 100 : null,
    headlineReview: headlineWarnings.length > 0 || repairs.some(x => x.field === 'title' || x.field === 'title_spot'),
    spotLeadRepeat: findings.some(x => x.code === 'spot_lead_repeat'),
    titleSpotOverlap: Math.round(repetitions * 100) / 100,
    heuristicFluency: fluency.score,
    findingCodes: findings.map(x => x.code)
  };
}
const rows = first.map(row => {
  const d = draft(row), words = countWords(d), repetition = overlap(d);
  const oldFindings = oldReview.newsroomFindings(d);
  const newFindings = newsroomFindings(d);
  const oldWarnings = oldQuality.headlineEditorialWarnings(d.title);
  const newWarnings = headlineEditorialWarnings(d.title);
  const sourceUrl = row.html.match(/<aside[^>]*class="[^"]*sanatcin-source[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/iu)?.[1] ?? null;
  return {
    postId: row.parent, firstRevisionId: row.id, date: row.date, sourceUrl, wordCount: words,
    oldControls: summarize(oldFindings, oldWarnings, words, oldQuality.editorialFluencyProfile(d), repetition),
    newControls: summarize(newFindings, newWarnings, words, editorialFluencyProfile(d), repetition)
  };
});
const totals = group => ({
  words: rows.reduce((sum, row) => sum + row.wordCount, 0),
  flaggedMechanicalArticles: rows.filter(row => row[group].mechanicalFindingCount > 0).length,
  mechanicalFindings: rows.reduce((sum, row) => sum + row[group].mechanicalFindingCount, 0),
  mechanicalFindingsPer1000Words: Math.round(rows.reduce((sum, row) => sum + row[group].mechanicalFindingCount, 0) * 1000 / rows.reduce((sum, row) => sum + row.wordCount, 0) * 100) / 100,
  headlineReviewArticles: rows.filter(row => row[group].headlineReview).length,
  spotLeadRepeatArticles: rows.filter(row => row[group].spotLeadRepeat).length,
  titleSpotOverlapAtLeast0_7: rows.filter(row => row[group].titleSpotOverlap >= .7).length,
  meanHeuristicFluency: Math.round(rows.reduce((sum, row) => sum + row[group].heuristicFluency, 0) / rows.length * 10) / 10
});
const pairs = first.filter(row => manual.has(row.parent)).map(row => {
  const before = draft(row), after = draft(manual.get(row.parent));
  return {
    postId: row.parent, firstRevisionId: row.id, firstTitle: before.title, manualTitle: after.title,
    headlineChanged: before.title !== after.title,
    bodyChanged: before.text !== after.text,
    baselineFluencyFirst: oldQuality.editorialFluencyProfile(before).score,
    baselineFluencyManual: oldQuality.editorialFluencyProfile(after).score,
    numericDifferenceFlag: numericFactRegression(before, after),
    firstLead: before.paragraphs[0], manualLead: after.paragraphs[0],
    firstExcerpt: before.excerpt, manualExcerpt: after.excerpt,
    firstExampleParagraph: before.paragraphs[1], manualExampleParagraph: after.paragraphs[1]
  };
});
const output = {
  methodology: 'Same 30 first-published texts evaluated by old and new deterministic checks; these are not regenerated model outputs or human quality scores.',
  baseline, count: rows.length, firstPublicationOnly: true,
  oldControls: totals('oldControls'), newControls: totals('newControls'),
  grammarAndSemanticAccuracy: 'not measured by deterministic checks',
  sourceFidelity: 'source articles were not independently compared; numeric differences in manual edits are diagnostic, not confirmed errors',
  liveModelReplay: 'not run; model credentials unavailable in this environment',
  sevenManualPairs: pairs, rows
};
const target = process.argv[2];
if (!target) throw new Error('Provide a report JSON path.');
await fs.writeFile(target, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ count: output.count, old: output.oldControls, current: output.newControls, paired: pairs.length }));
