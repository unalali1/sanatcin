import {
  fetchRecentWordPressPosts,
  renderNewsletterHtml,
  selectNewsletterPosts
} from '../src/newsletter.js';

const action = String(process.env.BREVO_ADMIN_ACTION || 'idle').trim();
const apiKey = process.env.BREVO_API_KEY || '';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

async function brevo(path, options = {}) {
  if (!apiKey) throw new Error('BREVO_API_KEY eksik.');
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...options,
    headers: {
      'api-key': apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Brevo ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

async function main() {
  if (action === 'idle') {
    console.log('BREVO_ADMIN_IDLE');
    return;
  }

  if (action === 'list-templates') {
    const data = await brevo('/smtp/templates?limit=1000');
    console.log(JSON.stringify((data?.templates || []).map((template) => ({
      id: template.id,
      name: template.name,
      subject: template.subject,
      isActive: template.isActive,
      tag: template.tag,
      doiTemplate: template.doiTemplate
    })), null, 2));
    return;
  }

  if (action === 'list-campaigns') {
    const data = await brevo('/emailCampaigns?type=classic&limit=100&offset=0&sort=desc');
    console.log(JSON.stringify((data?.campaigns || []).slice(0, 20).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      status: campaign.status,
      scheduledAt: campaign.scheduledAt,
      createdAt: campaign.createdAt,
      modifiedAt: campaign.modifiedAt
    })), null, 2));
    return;
  }

  if (action === 'refresh-draft') {
    if (process.env.BREVO_ADMIN_CONFIRM !== 'REFRESH_DRAFT') {
      throw new Error('BREVO_ADMIN_CONFIRM=REFRESH_DRAFT olmadan kampanya güncellenmez.');
    }
    const campaignId = integer('BREVO_CAMPAIGN_ID', 0);
    if (campaignId <= 0) throw new Error('BREVO_CAMPAIGN_ID geçerli değil.');

    const campaign = await brevo(`/emailCampaigns/${campaignId}`);
    if (campaign?.status !== 'draft') {
      throw new Error(`Yalnız taslak kampanya güncellenebilir. Mevcut durum: ${campaign?.status || 'bilinmiyor'}`);
    }

    const siteUrl = (process.env.WP_BASE_URL || 'https://sanatcin.com').replace(/\/$/, '');
    const lookbackDays = Math.max(1, Math.min(integer('NEWSLETTER_LOOKBACK_DAYS', 7), 21));
    const maxItems = Math.max(4, Math.min(integer('NEWSLETTER_MAX_ITEMS', 6), 8));
    const logoUrl = process.env.NEWSLETTER_LOGO_URL || `${siteUrl}/wp-content/uploads/2026/09/SanatCin-Logo.png`;

    const posts = await fetchRecentWordPressPosts({
      siteUrl,
      lookbackDays,
      perPage: 100,
      signal: AbortSignal.timeout(30000)
    });
    const selected = selectNewsletterPosts(posts, maxItems);
    if (selected.length < 4) throw new Error(`Newsletter için yeterli içerik yok: ${selected.length}`);

    const htmlContent = renderNewsletterHtml(selected, { siteUrl, logoUrl });
    await brevo(`/emailCampaigns/${campaignId}`, {
      method: 'PUT',
      body: JSON.stringify({ htmlContent })
    });

    const verify = await brevo(`/emailCampaigns/${campaignId}`);
    console.log(JSON.stringify({
      refreshed: true,
      campaignId,
      name: verify?.name,
      subject: verify?.subject,
      status: verify?.status,
      htmlBytes: Buffer.byteLength(htmlContent),
      selected: selected.map((post) => ({ id: post.id, title: post.title?.rendered, link: post.link }))
    }, null, 2));
    return;
  }

  if (action === 'update-doi') {
    if (process.env.BREVO_ADMIN_CONFIRM !== 'UPDATE_DOI_TEMPLATE') {
      throw new Error('BREVO_ADMIN_CONFIRM=UPDATE_DOI_TEMPLATE olmadan şablon güncellenmez.');
    }
    const encoded = process.env.BREVO_DOI_HTML_B64 || '';
    if (!encoded) throw new Error('BREVO_DOI_HTML_B64 eksik.');
    const htmlContent = Buffer.from(encoded, 'base64').toString('utf8');
    if (!htmlContent.includes('{{ doubleoptin }}')) {
      throw new Error('Şablonda zorunlu {{ doubleoptin }} bağlantısı yok.');
    }
    await brevo('/smtp/templates/2', {
      method: 'PUT',
      body: JSON.stringify({
        templateName: 'SanatÇin – Abonelik Onayı',
        subject: 'SanatÇin Bülteni aboneliğinizi onaylayın',
        htmlContent,
        isActive: true,
        tag: 'optin'
      })
    });
    const verify = await brevo('/smtp/templates/2');
    console.log(JSON.stringify({
      updated: true,
      id: verify?.id,
      name: verify?.name,
      subject: verify?.subject,
      isActive: verify?.isActive,
      tag: verify?.tag,
      doiTemplate: verify?.doiTemplate,
      hasDoubleOptin: String(verify?.htmlContent || '').includes('{{ doubleoptin }}')
    }, null, 2));
    return;
  }

  throw new Error(`Bilinmeyen BREVO_ADMIN_ACTION: ${action}`);
}

main().catch((error) => fail(error.stack || error.message));
