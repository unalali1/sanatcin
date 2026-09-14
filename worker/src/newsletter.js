import { load } from 'cheerio';
import { titleSimilarity } from './quality.js';

const REGULAR_CATEGORY_SLUGS = ['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam'];
const NEWSLETTER_TITLE_SIMILARITY_THRESHOLD = 0.45;
const DEFAULT_MASTHEAD_URL = 'https://sanatcin.com/wp-content/uploads/2026/09/arka-plan-2-1024x341.png';

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

function postCardData(post, siteUrl, excerptLength = 200) {
  return {
    title: titleText(post),
    excerpt: text(post?.excerpt?.rendered || '').slice(0, excerptLength),
    image: featuredImage(post),
    link: post?.link || siteUrl,
    label: text(categoryLabel(post))
  };
}

function renderHeroCard(post, siteUrl) {
  const { title, excerpt, image, link, label } = postCardData(post, siteUrl, 230);
  return `
    <tr>
      <td style="padding:0;background:#fffdf9;">
        ${image ? `<a href="${escapeHtml(link)}" style="text-decoration:none;"><img src="${escapeHtml(image)}" alt="" width="720" style="display:block;width:100%;max-width:720px;height:auto;border:0;margin:0;"></a>` : ''}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td class="sc-pad" style="padding:24px 34px 30px;">
              <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#a91529;margin:0 0 8px;">${escapeHtml(label)}</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.16;color:#092940;margin:0 0 10px;"><a href="${escapeHtml(link)}" style="color:#092940;text-decoration:none;">${escapeHtml(title)}</a></div>
              <div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.58;color:#576c78;margin:0 0 14px;">${escapeHtml(excerpt)}</div>
              <a href="${escapeHtml(link)}" style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#a91529;text-decoration:none;">Haberi oku →</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderCompactCard(post, siteUrl) {
  const { title, excerpt, image, link, label } = postCardData(post, siteUrl, 175);
  return `
    <tr>
      <td class="sc-pad" style="padding:26px 34px;border-top:1px solid #eadfce;background:#fffdf9;">
        <table class="sc-story-table" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            ${image ? `<td class="sc-story-img" width="250" valign="top" style="width:250px;padding:0;"><a href="${escapeHtml(link)}" style="text-decoration:none;"><img src="${escapeHtml(image)}" alt="" width="250" style="display:block;width:250px;max-width:100%;height:auto;border:0;margin:0;"></a></td>` : ''}
            <td class="sc-story-copy" valign="top" style="padding:${image ? '0 0 0 22px' : '0'};">
              <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#a91529;margin:0 0 7px;">${escapeHtml(label)}</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.2;color:#092940;margin:0 0 9px;"><a href="${escapeHtml(link)}" style="color:#092940;text-decoration:none;">${escapeHtml(title)}</a></div>
              <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.52;color:#576c78;margin:0 0 11px;">${escapeHtml(excerpt)}</div>
              <a href="${escapeHtml(link)}" style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#a91529;text-decoration:none;">Haberi oku →</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

export function renderNewsletterHtml(posts, { siteUrl = 'https://sanatcin.com', logoUrl = '', mastheadUrl = DEFAULT_MASTHEAD_URL } = {}) {
  const [hero, ...rest] = posts;
  const heroCard = hero ? renderHeroCard(hero, siteUrl) : '';
  const compactCards = rest.map((post) => renderCompactCard(post, siteUrl)).join('');
  const masthead = escapeHtml(mastheadUrl || DEFAULT_MASTHEAD_URL);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;}
  img{-ms-interpolation-mode:bicubic;}
  @media only screen and (max-width:640px){
    .sc-shell{width:100%!important;max-width:100%!important;}
    .sc-pad{padding-left:20px!important;padding-right:20px!important;}
    .sc-masthead-pad{padding:24px 20px 22px!important;}
    .sc-logo{width:210px!important;max-width:72%!important;height:auto!important;}
    .sc-title{font-size:29px!important;}
    .sc-story-img,.sc-story-copy{display:block!important;width:100%!important;max-width:100%!important;}
    .sc-story-img{padding:0 0 16px!important;}
    .sc-story-copy{padding:0!important;}
    .sc-story-img img{width:100%!important;max-width:100%!important;height:auto!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f3eee5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3eee5;">
    <tr>
      <td align="center" style="padding:20px 12px;">
        <table class="sc-shell" role="presentation" width="720" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:720px;background:#fffdf9;box-shadow:0 1px 0 rgba(9,41,64,.06);">
          <tr>
            <td background="${masthead}" bgcolor="#f8f4ec" style="background-color:#f8f4ec;background-image:url('${masthead}');background-repeat:no-repeat;background-position:center right;background-size:cover;border-top:5px solid #d3a34a;">
              <!--[if gte mso 9]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:720px;height:220px;">
                <v:fill type="frame" src="${masthead}" color="#f8f4ec" />
                <v:textbox inset="0,0,0,0">
              <![endif]-->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="sc-masthead-pad" style="padding:30px 34px 28px;">
                    ${logoUrl ? `<img class="sc-logo" src="${escapeHtml(logoUrl)}" alt="SanatÇin" width="270" style="display:block;width:270px;max-width:270px;height:auto;border:0;margin:0 0 24px;">` : '<div style="font-family:Georgia,serif;font-size:38px;font-weight:700;color:#092940;margin:0 0 20px;">SanatÇin</div>'}
                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.45;color:#526672;max-width:330px;">Çin kültür ve sanatına Türkçe bir bakış.</div>
                  </td>
                </tr>
              </table>
              <!--[if gte mso 9]>
                </v:textbox>
              </v:rect>
              <![endif]-->
            </td>
          </tr>
          <tr>
            <td class="sc-pad" style="padding:26px 34px 24px;background:#fffaf2;border-bottom:1px solid #eadfce;">
              <div class="sc-title" style="font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.12;color:#092940;margin:0 0 9px;">SanatÇin Bülteni</div>
              <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#5c6e77;max-width:620px;">Çin’in kültür, sanat, sinema, moda ve yaşam dünyasından editörün seçtikleri.</div>
            </td>
          </tr>
          ${heroCard}
          ${compactCards}
          <tr>
            <td class="sc-pad" style="padding:24px 34px;background:#f5efe4;border-top:1px solid #e4d8c7;color:#53666f;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;">SanatÇin · Çin kültür ve sanatına Türkçe bir bakış.<br><a href="${escapeHtml(siteUrl)}" style="color:#a91529;text-decoration:none;">sanatcin.com</a></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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

export function newsletterCampaignDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function isNewsletterSendWindow(date = new Date(), { utcDay = 0, utcHour = 6, windowMinutes = 20 } = {}) {
  return date.getUTCDay() === utcDay && date.getUTCHours() === utcHour && date.getUTCMinutes() < windowMinutes;
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

export async function findBrevoCampaignByName({ apiKey, campaignName }) {
  if (!apiKey) return null;
  const data = await brevo('/emailCampaigns?type=classic&limit=100&offset=0&sort=desc', apiKey);
  return (data?.campaigns || []).find((campaign) => campaign.name === campaignName) || null;
}

export async function campaignNameExists({ apiKey, campaignName }) {
  return Boolean(await findBrevoCampaignByName({ apiKey, campaignName }));
}

export async function sendBrevoCampaign({ apiKey, campaignId }) {
  if (!apiKey) throw new Error('BREVO_API_KEY eksik.');
  if (!Number.isInteger(Number(campaignId)) || Number(campaignId) <= 0) throw new Error('Brevo campaignId geçerli değil.');
  return brevo(`/emailCampaigns/${Number(campaignId)}/sendNow`, apiKey, { method: 'POST' });
}
