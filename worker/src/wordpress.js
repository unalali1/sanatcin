import { config } from './config.js';
import { sourceHash } from './fetch.js';

const auth = `Basic ${Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64')}`;

async function wp(path, options = {}) {
  const response = await fetch(`${config.wpBaseUrl}/wp-json${path}`, {
    ...options,
    headers: { authorization: auth, 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`WordPress ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? null : response.json();
}

export async function knownHashes(hashes) {
  if (config.dryRun || hashes.length === 0) return [];
  const result = await wp('/sanatcin/v1/known', { method: 'POST', body: JSON.stringify({ hashes }) });
  return result.known ?? [];
}

async function categoryId(slug) {
  const categories = await wp(`/wp/v2/categories?slug=${encodeURIComponent(slug)}`);
  if (!categories.length) throw new Error(`WordPress kategorisi bulunamadı: ${slug}`);
  return categories[0].id;
}

export async function publishArticle(article) {
  const sourceLine = `<aside class="sanatcin-source"><strong>Kaynak:</strong> <a href="${article.url}" target="_blank" rel="noopener noreferrer nofollow">${article.source.name}</a></aside>`;
  const payload = {
    title: article.title,
    excerpt: article.excerpt,
    content: `${article.bodyHtml}\n${sourceLine}`,
    status: config.publishStatus,
    categories: [await categoryId(article.category)],
    meta: {
      sanatcin_source_url: article.url,
      sanatcin_source_name: article.source.name,
      sanatcin_source_hash: sourceHash(article.url),
      sanatcin_score: Math.round(article.score),
      sanatcin_original_title: article.originalTitle
    }
  };
  if (config.dryRun) return { id: null, link: null, payload };
  return wp('/wp/v2/posts', { method: 'POST', body: JSON.stringify(payload) });
}

