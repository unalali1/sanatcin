import { log, setLogContext } from './logger.js';
import { campaignNameExists, createBrevoDraft, fetchRecentWordPressPosts, renderNewsletterHtml, selectNewsletterPosts } from './newsletter.js';

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function isoWeek(date = new Date()) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function run() {
  const siteUrl = (process.env.WP_BASE_URL || 'https://sanatcin.com').replace(/\/$/, '');
  const mode = (process.env.NEWSLETTER_MODE || 'preview').toLowerCase();
  const lookbackDays = Math.max(1, Math.min(integer('NEWSLETTER_LOOKBACK_DAYS', 7), 21));
  const maxItems = Math.max(4, Math.min(integer('NEWSLETTER_MAX_ITEMS', 6), 8));
  const senderEmail = process.env.NEWSLETTER_SENDER_EMAIL || 'editor@sanatcin.com';
  const senderName = process.env.NEWSLETTER_SENDER_NAME || 'SanatÇin';
  const logoUrl = process.env.NEWSLETTER_LOGO_URL || `${siteUrl}/wp-content/uploads/2026/09/SanatCin-Logo.png`;
  const week = isoWeek();
  const campaignName = `${process.env.NEWSLETTER_CAMPAIGN_PREFIX || 'SanatÇin Haftalık Seçki'} · ${week}`;
  const subject = process.env.NEWSLETTER_SUBJECT || 'SanatÇin Haftalık Seçki';

  setLogContext({ runId: `newsletter-${week}`, worker: 'newsletter' });
  log('info', 'Newsletter seçkisi hazırlanıyor', { mode, siteUrl, lookbackDays, maxItems, campaignName });

  const posts = await fetchRecentWordPressPosts({
    siteUrl,
    lookbackDays,
    perPage: 100,
    signal: AbortSignal.timeout(30000)
  });
  const selected = selectNewsletterPosts(posts, maxItems);
  if (selected.length < 4) {
    throw new Error(`Newsletter için yeterli içerik yok: ${selected.length} içerik bulundu.`);
  }

  const htmlContent = renderNewsletterHtml(selected, { siteUrl, logoUrl });
  log('info', 'Newsletter seçkisi hazır', {
    count: selected.length,
    items: selected.map((post) => ({ id: post.id, title: post.title?.rendered, score: post.meta?.sanatcin_score ?? 0, link: post.link }))
  });

  if (mode === 'preview') {
    log('info', 'Preview modu: Brevo taslağı oluşturulmadı', { htmlBytes: Buffer.byteLength(htmlContent) });
    return;
  }
  if (mode !== 'draft') throw new Error('NEWSLETTER_MODE yalnız preview veya draft olabilir.');

  const apiKey = process.env.BREVO_API_KEY || '';
  const listId = integer('BREVO_LIST_ID', 0);
  if (await campaignNameExists({ apiKey, campaignName })) {
    log('info', 'Bu haftanın Brevo taslağı zaten mevcut; yinelenmedi', { campaignName });
    return;
  }

  const campaign = await createBrevoDraft({
    apiKey,
    listId,
    senderEmail,
    senderName,
    subject,
    campaignName,
    htmlContent
  });
  log('info', 'Brevo newsletter taslağı oluşturuldu; otomatik gönderim yapılmadı', {
    campaignId: campaign?.id,
    campaignName,
    subject,
    recipientsListId: listId
  });
}

run().catch((error) => {
  log('fatal', 'Newsletter çalıştırıcısı durdu', { error: error.stack || error.message });
  process.exitCode = 1;
});
