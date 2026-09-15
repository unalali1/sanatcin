import { log, setLogContext } from './logger.js';
import { discoverCommonsImages, selectDossierImages } from './dossier-images.js';
import { polishDossierArticle } from './dossier-polish.js';
import { researchDossierTopic, verifyDossierResearch, writeDossierArticle } from './dossier-research.js';
import { createDossierDraft, dossierRunState, uploadDossierImages } from './dossier-wordpress.js';
import { topicDisplayName } from './dossier-topics.js';

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function validateEnvironment(mode) {
  const required = ['OPENAI_API_KEY', 'WP_BASE_URL', 'WP_USERNAME', 'WP_APP_PASSWORD'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Eksik ortam değişkenleri: ${missing.join(', ')}`);
  if (!['preview', 'draft'].includes(mode)) throw new Error('DOSSIER_MODE yalnız preview veya draft olabilir.');
}

async function run() {
  const mode = String(process.env.DOSSIER_MODE || 'preview').toLowerCase();
  validateEnvironment(mode);
  const now = new Date();
  const timeoutMinutes = Math.max(8, Math.min(integer('DOSSIER_MAX_RUN_MINUTES', 25), 45));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Dosya worker toplam süre sınırını aştı.')), timeoutMinutes * 60_000);

  try {
    const state = await dossierRunState(now);
    setLogContext({ worker: 'chinese-arts-dossier', week: state.weekKey, mode });
    log('info', 'Çin Sanatları Dosyası haftalık çalışma başladı', {
      usedTopics: state.usedSlugs.size,
      remainingTopics: Math.max(0, 52 - state.usedSlugs.size)
    });

    if (state.currentWeekPost) {
      log('info', 'Bu hafta için dosya zaten mevcut; ikinci dosya üretilmedi', {
        postId: state.currentWeekPost.id,
        status: state.currentWeekPost.status,
        slug: state.currentWeekPost.slug
      });
      return;
    }
    if (!state.topic) {
      log('warn', '52 haftalık konu havuzu tamamlandı; yeni konu eklenene kadar çalışma durdu');
      return;
    }

    log('info', 'Haftanın dosya konusu seçildi', {
      topicId: state.topic.id,
      topic: topicDisplayName(state.topic),
      group: state.topic.group
    });

    const research = await researchDossierTopic(state.topic, { signal: controller.signal });
    log('info', 'Birinci araştırma turu tamamlandı', {
      facts: research.facts.length,
      sources: research.sources.length,
      domains: [...new Set(research.sources.map((source) => new URL(source.url).hostname))].length
    });

    const verified = await verifyDossierResearch(research, { signal: controller.signal });
    log('info', 'İkinci fact-check tamamlandı', {
      verifiedFacts: verified.facts.filter((fact) => fact.verification === 'verified').length,
      cautionFacts: verified.facts.filter((fact) => fact.verification === 'caution').length,
      keptFacts: verified.facts.length
    });

    const firstDraft = await writeDossierArticle(verified, { signal: controller.signal });
    const article = await polishDossierArticle(firstDraft, verified, { signal: controller.signal });
    log('info', 'Uzun form Türkçe dosya hazırlandı', {
      title: article.title,
      wordCount: article.wordCount,
      sourceCount: verified.sources.length,
      editorialPass: article.editorialPass || 'base'
    });

    const commonsCandidates = await discoverCommonsImages(state.topic, { signal: controller.signal });
    const images = await selectDossierImages(state.topic, commonsCandidates, { signal: controller.signal });
    log('info', 'Lisanslı dosya görselleri seçildi', {
      commonsCandidates: commonsCandidates.length,
      selectedImages: images.length,
      target: integer('DOSSIER_IMAGE_TARGET', 5),
      hero: images[0]?.title || null,
      heroScore: Math.round(images[0]?.heroScore || images[0]?.finalScore || 0)
    });

    if (mode === 'preview') {
      log('info', 'Preview modu: WordPress taslağı oluşturulmadı', {
        topic: state.topic.slug,
        title: article.title,
        wordCount: article.wordCount,
        images: images.map((image) => ({ title: image.title, license: image.license, source: image.sourcePage, caption: image.captionTr }))
      });
      return;
    }

    const uploaded = images.length ? await uploadDossierImages(images, state.topic, { signal: controller.signal }) : [];
    const post = await createDossierDraft(article, uploaded, state, { signal: controller.signal });
    log('info', 'Çin Sanatları Dosyası WordPress taslağı oluşturuldu', {
      postId: post.id,
      slug: post.slug,
      status: post.status,
      title: post.title,
      imagesUploaded: uploaded.length,
      sources: verified.sources.length,
      wordCount: article.wordCount
    });
  } finally {
    clearTimeout(timer);
  }
}

run().catch((error) => {
  log('fatal', 'Çin Sanatları Dosyası worker durdu', { error: error.stack || error.message });
  process.exitCode = 1;
});
