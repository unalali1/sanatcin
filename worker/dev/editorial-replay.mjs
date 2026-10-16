// Local-only comparison runner: no index.js, WordPress, newsletter or deployment imports.
// Usage: node dev/editorial-replay.mjs INPUT.json OUTPUT.json
// INPUT: [{ id, article: {title,text,url,category,source:{id,name}}, before:{title,excerpt,paragraphs} }]
import fs from 'node:fs/promises';
import OpenAI from 'openai';
import { config } from '../src/config.js';
import { observeEditorialQuality } from './editorial-observation.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Provide local input and output JSON paths.');
if (!config.openaiApiKey || !process.env.OPENAI_FACT_MODEL || !process.env.OPENAI_EDITOR_MODEL) {
  throw new Error('Live replay not run: explicitly supply existing OPENAI_API_KEY, OPENAI_FACT_MODEL and OPENAI_EDITOR_MODEL. No model fallback is allowed for this comparison.');
}
const cases = JSON.parse(await fs.readFile(inputPath, 'utf8'));
if (!Array.isArray(cases) || !cases.length || cases.length > 10) throw new Error('Use 1–10 cases per bounded run.');
for (const item of cases) {
  if (!item.article?.text?.trim() || !item.article.source?.id || !item.before?.paragraphs?.length) {
    throw new Error('Each case needs a source article and an existing Turkish draft.');
  }
}
// Refuse overwrite before paying for calls. A partial report survives interruption.
const output = await fs.open(outputPath, 'wx');
await output.close();
const { translateArticle } = await import('../src/translate.js');
const client = new OpenAI({ apiKey: config.openaiApiKey, timeout: config.aiRequestTimeoutMs, maxRetries: 0 });
let calls = 0;
const completeJson = async ({model,input,signal}) => {
  calls += 1;
  const response = await client.responses.create({ model, input }, { signal });
  const text = response.output_text;
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
};
const report = { kind: 'local-model-replay', published: false, models: { fact: config.openaiFactModel, editor: config.openaiEditorModel }, results: [] };
for (const item of cases) {
  const startCalls = calls;
  try {
    const after = await translateArticle(item.article, { completeJson, signal: AbortSignal.timeout(600000) });
    const beforeScore = await observeEditorialQuality({ sourceText: item.article.text, draft: item.before }, { completeJson, model: config.openaiEditorModel });
    const afterScore = await observeEditorialQuality({ sourceText: item.article.text, draft: after }, { completeJson, model: config.openaiEditorModel });
    report.results.push({ id: item.id, status: 'generated', before: item.before, after: {title:after.title,excerpt:after.excerpt,paragraphs:after.paragraphs}, beforeScore, afterScore, calls: calls - startCalls });
  } catch {
    report.results.push({ id: item.id, status: 'failed', calls: calls - startCalls });
  }
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ cases: report.results.length, generated: report.results.filter(x => x.status === 'generated').length, calls, published: false }));
