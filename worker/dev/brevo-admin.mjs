const action = String(process.env.BREVO_ADMIN_ACTION || 'idle').trim();
const apiKey = process.env.BREVO_API_KEY || '';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
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
