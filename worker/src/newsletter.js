import { load } from 'cheerio';
import { titleSimilarity } from './quality.js';

const REGULAR_CATEGORY_SLUGS = ['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam'];
const NEWSLETTER_TITLE_SIMILARITY_THRESHOLD = 0.45;

function text(value = '') {
  return load(`<div>${value}</div>`).text().replace(/\s+/g, ' ').trim();
}

function titleText(post) {
  return text(post?.title?.rendered || '');
}

function score(post) {
  return Number(post?.meta?.sanatcin_score ?? 0) || 0;
}

function dateValue(post) {
  return Date.parse(post?.date_gmt || post?.date || 0) || 0;
}

function categories(post) {
  const groups = post?._embedded?.['wp:term'] ?? [];
  return groups.flat().filter((term) => term.taxonomy === 'category');
}

function hasCategory(post, slug) {
  return categories(post).some((category) => category.slug === slug);
}

function sortPosts(posts) {
  return [...posts].sort((a, b) => score(b) - score(a) || dateValue(b) - dateValue(a));
}

function isDuplicateTopic(candidate, selected) {
  const candidateTitle = titleText(candidate);
  if (!candidateTitle) return true;
  return selected.some((existing) => {
    const similarity = titleSimilarity(candidateTitle, titleText(existing));
    return similarity.score >= NEWSLETTER_TITLE_SIMILARITY_THRESHOLD && similarity.shared >= 2;
  });
}

export function selectNewsletterPosts(posts, maxItems = 6) {
  const selected = [];
  const selectedIds = new Set();
  const pick = (candidate) => {
    if (!candidate || selectedIds.has(candidate.id) || selected.length >= maxItems) return false;
    if (isDuplicateTopic(candidate, selected)) return false;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    return true;
  };
  const pickBest = (candidates) => {
    for (const candidate of sortPosts(candidates)) {
      if (pick(candidate)) return candidate;
    }
    return null;
  };

  pickBest(posts.filter((post) => hasCategory(post, 'editorden')));

  for (const slug of REGULAR_CATEGORY_SLUGS) {
    pickBest(posts.filter((post) => hasCategory(post, slug) && !selectedIds.has(post.id)));
  }

  for (const post of sortPosts(posts.filter((post) => !selectedIds.has(post.id)))) pick(post);
  return selected.slice(0, maxItems);
}

function featuredImage(post) {
  const media = post?._embedded?.['wp:featuredmedia']?.[0];
  return media?.media_details?.sizes?.large?.source_url || media?.source_url || '';
}

function categoryLabel(post) {
  const category = categories(post).find((item) => item.slug !== 'uncategorized');
  return category?.name || 'SanatÇin';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

export function renderNewsletterHtml(posts, { siteUrl = 'https://sanatcin.com', logoUrl = '' } = {}) {
  const cards = posts.map((post) => {
    const title = titleText(post);
    const excerpt = text(post?.excerpt?.rendered || '').slice(0, 240);
    const image = featuredImage(post);
    const link = post?.link || siteUrl;
    const label = text(categoryLabel(post));
    return `
      <tr><td style="padding:0 0 30px;">
        ${image ? `<a href="${escapeHtml(link)}"><img src="${escapeHtml(image)}" alt="" width="600" style="display:block;width:100%;height:auto;border:0;margin:0 0 14px;"></a>` : ''}
        <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a91529;margin:0 0 7px;">${escapeHtml(label)}</div>
        <div style="font-family:Georgia,serif;font-size:25px;line-height:1.18;color:#092940;margin:0 0 9px;"><a href="${escapeHtml(link)}" style="color:#092940;text-decoration:none;">${escapeHtml(title)}</a></div>
        <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#576c78;margin:0 0 12px;">${escapeHtml(excerpt)}</div>
        <a href="${escapeHtml(link)}" style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#a91529;text-decoration:none;">Haberi oku →</a>
      </td></tr>`;
  }).join('');

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5ead7;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5ead7;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#fffdf9;"><tr><td style="padding:30px 30px 18px;border-top:5px solid #e0aa3c;background:#041d30;color:#fffdf9;">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="SanatÇin" width="190" style="display:block;max-width:190px;height:auto;margin:0 0 16px;">` : '<div style="font-family:Georgia,serif;font-size:34px;font-weight:700;margin:0 0 12px;">SanatÇin</div>'}<div style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#ffe89a;margin:0 0 8px;">Haftalık Seçki</div><div style="font-family:Georgia,serif;font-size:30px;line-height:1.15;margin:0 0 8px;">SanatÇin Bülteni</div><div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#d6e0e5;">Çin’in kültür, sanat, sinema, moda ve yaşam dünyasından editörün seçtikleri.</div></td></tr><tr><td style="padding:30px;">${cards}</td></tr><tr><td style="padding:22px 30px;background:#082a43;color:#cbd7dc;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;">SanatÇin · Çin kültür ve sanatına Türkçe bir bakış.<br><a href="${escapeHtml(siteUrl)}" style="color:#ffe89a;">sanatcin.com</a></td></tr></table></td></tr></table></body></html>`;
}

export async function fetchRecentWordPressPosts({ siteUrl, lookbackDays = 7, perPage = 50, signal } = {}) {
  const after = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const url = new URL('/wp-json/wp/v2/posts', siteUrl);
  url.searchParams.set('status', 'publish');
  url.searchParams.set('after', after);
  url.searchParams.set('per_page', String(Math.min(100, perPage)));
  url.searchParams.set('orderby', 'date');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('_embed', '1');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`WordPress newsletter verisi alınamadı: HTTP ${response.status}`);
  return response.json();
}

async function brevo(path, apiKey, options = {}) {
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...options,
    headers: { 'api-key': apiKey, accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Brevo ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? null : response.json();
}

export async function createBrevoDraft({ apiKey, listId, senderEmail, senderName = 'SanatÇin', subject, campaignName, htmlContent }) {
  if (!apiKey) throw new Error('BREVO_API_KEY eksik.');
  if (!Number.isInteger(Number(listId)) || Number(listId) <= 0) throw new Error('BREVO_LIST_ID geçerli değil.');
  return brevo('/emailCampaigns', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      name: campaignName,
      subject,
      sender: { name: senderName, email: senderEmail },
      recipients: { listIds: [Number(listId)] },
      htmlContent,
      inlineImageActivation: false,
      mirrorActive: true
    })
  });
}

export async function campaignNameExists({ apiKey, campaignName }) {
  if (!apiKey) return false;
  const data = await brevo('/emailCampaigns?type=classic&status=draft&limit=50&offset=0&sort=desc', apiKey);
  return (data?.campaigns || []).some((campaign) => campaign.name === campaignName);
}
