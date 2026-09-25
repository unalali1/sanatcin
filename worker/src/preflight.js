import { mapLimit } from './concurrency.js';
import { classifyError } from './errors.js';

// Bounded existing extraction requests run before ranking and are reused later.
export async function preflightCandidates(candidates, selected, {
  extract, signal, concurrency = 2, maxMs = 20_000
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const articles = new Map();
  const rejected = new Map();
  let checked = 0;
  try {
    await mapLimit(selected, concurrency, async (candidate) => {
      if (combined.aborted || candidate.source?.browser) return;
      checked += 1;
      try {
        const article = await extract(candidate, { signal: combined, allowBrowser: false });
        articles.set(candidate.url, article);
      } catch (error) {
        if (!combined.aborted && classifyError(error).code === 'SOURCE_EXTRACTION') {
          rejected.set(candidate.url, { candidate, error: String(error.message) });
        }
      }
    });
    signal?.throwIfAborted();
    return {
      candidates: candidates.filter((candidate) => !rejected.has(candidate.url)).map((candidate) => {
        const article = articles.get(candidate.url);
        return article ? { ...candidate, summary: article.text.slice(0, 600), sourcePreflight: 'usable' } : candidate;
      }),
      articles, rejected, checked
    };
  } finally { clearTimeout(timer); }
}
