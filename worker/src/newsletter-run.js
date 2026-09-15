import { log, setLogContext } from './logger.js';
import {
  createBrevoDraft,
  fetchRecentWordPressPosts,
  findBrevoCampaignByName,
  isNewsletterSendWindow,
  newsletterCampaignDate,
  renderNewsletterHtml,
  sendBrevoCampaign
} from './newsletter.js';
import { buildNewsletterSelectionWithDossierBonus } from './newsletter-dossier.js';

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

async function run() {
  const now = new Date();
  const siteUrl = (process.env.WP_BASE_URL || 'https://sanatcin.com').replace(/\/$/, '');
  const mode = (process.env.NEWSLETTER_MODE || 'preview').toLowerCase();
  const lookbackDays = Math.max(1, Math.min(integer('NEWSLETTER_LOOKBACK_DAYS', 7), 21));
  const maxItems = Math.max(4, Math.min(integer('NEWSLETTER_MAX_ITEMS', 6), 8));
  const dossierBonus = Math.max(0, Math.min(integer('NEWSLETTER_DOSSIER_BONUS', 10), 20));
  const senderEmail = process.env.NEWSLETTER_SENDER_EMAIL || 'editor@sanatcin.com';
  const senderName = process.env.NEWSLETTER_SENDER_NAME || 'SanatÇin';
  const logoUrl = process.env.NEWSLETTER_LOGO_URL || `${siteUrl}/wp-content/uploads/2026/09/SanatCin-Logo.png`;
  const campaignDate = newsletterCampaignDate(now);
  const campaignName = `${process.env.NEWSLETTER_CAMPAIGN_PREFIX || 'SanatÇin Haftalık Seçki'} · ${campaignDate}`;
  const subject = process.env.NEWSLETTER_SUBJECT || 'SanatÇin Haftalık Seçki';

  setLogContext({ runId: `newsletter-${campaignDate}`, worker: 'newsletter', newsletterVersion: '0.10.0' });
  log('info', 'Newsletter seçkisi hazırlanıyor', {
    mode,
    siteUrl,
    lookbackDays,
    maxItems,
    campaignName,
    dossierBonus,
    scoreModel: process.env.NEWSLETTER_SCORE_MODEL || process.env.OPENAI_SELECTION_MODEL || 'gpt-5-mini'
  });

  if (!['preview', 'draft', 'send'].includes(mode)) {
    throw new Error('NEWSLETTER_MODE yalnız preview, draft veya send olabilir.');
  }

  if (mode === 'send' && !isNewsletterSendWindow(now)) {
    log('warn', 'Gönderim güvenlik penceresi dışında; newsletter gönderilmedi', {
      nowUtc: now.toISOString(),
      expected: 'Pazar 06:00-06:19 UTC (Türkiye 09:00-09:19)'
    });
    return;
  }

  const posts = await fetchRecentWordPressPosts({
    siteUrl,
    lookbackDays,
    perPage: 100,
    signal: AbortSignal.timeout(30000)
  });
  const selected = await buildNewsletterSelectionWithDossierBonus(posts, maxItems, {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.NEWSLETTER_SCORE_MODEL || process.env.OPENAI_SELECTION_MODEL || 'gpt-5-mini',
    now,
    dossierBonus,
    signal: AbortSignal.timeout(90000)
  });
  if (selected.length < 4) {
    throw new Error(`Newsletter için yeterli içerik yok: ${selected.length} içerik bulundu.`);
  }

  const htmlContent = renderNewsletterHtml(selected, { siteUrl, logoUrl });
  log('info', 'Newsletter seçkisi hazır', {
    count: selected.length,
    heroPostId: selected[0]?.id ?? null,
    items: selected.map((post) => ({
      id: post.id,
      title: post.title?.rendered,
      sanatcinScore: post.meta?.sanatcin_score ?? 0,
      newsletterScore: post.newsletterScore ?? null,
      newsletterScoreMode: post.newsletterScoreMode ?? null,
      newsletterScoreComponents: post.newsletterScoreComponents ?? null,
      newsletterScoreReason: post.newsletterScoreReason ?? null,
      newsletterScoreBonus: post.newsletterScoreBonus ?? 0,
      link: post.link
    }))
  });

  if (mode === 'preview') {
    log('info', 'Preview modu: Brevo taslağı oluşturulmadı', { htmlBytes: Buffer.byteLength(htmlContent) });
    return;
  }

  const apiKey = process.env.BREVO_API_KEY || '';
  const listId = integer('BREVO_LIST_ID', 0);
  const existing = await findBrevoCampaignByName({ apiKey, campaignName });

  if (mode === 'draft') {
    if (existing) {
      log('info', 'Bu tarihli Brevo kampanyası zaten mevcut; yinelenmedi', {
        campaignId: existing.id,
        campaignName,
        status: existing.status
      });
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
    return;
  }

  if (existing && ['sent', 'queued', 'scheduled'].includes(existing.status)) {
    log('info', 'Bu tarihli newsletter zaten gönderilmiş veya sıraya alınmış; tekrar gönderilmedi', {
      campaignId: existing.id,
      campaignName,
      status: existing.status
    });
    return;
  }

  if (existing && existing.status !== 'draft') {
    throw new Error(`Mevcut Brevo kampanyası güvenli gönderim durumunda değil: ${existing.status || 'bilinmiyor'}`);
  }

  let campaignId = existing?.id;
  if (!campaignId) {
    const campaign = await createBrevoDraft({
      apiKey,
      listId,
      senderEmail,
      senderName,
      subject,
      campaignName,
      htmlContent
    });
    campaignId = campaign?.id;
    log('info', 'Gönderim için Brevo newsletter kampanyası oluşturuldu', {
      campaignId,
      campaignName,
      recipientsListId: listId
    });
  } else {
    log('info', 'Mevcut taslak kampanya yeniden kullanılacak', { campaignId, campaignName });
  }

  await sendBrevoCampaign({ apiKey, campaignId });
  log('info', 'Brevo newsletter gönderimi sıraya alındı', {
    campaignId,
    campaignName,
    subject,
    recipientsListId: listId
  });
}

run().catch((error) => {
  log('fatal', 'Newsletter çalıştırıcısı durdu', { error: error.stack || error.message });
  process.exitCode = 1;
});
