import { log } from './logger.js';
import { runDossierPublisher, validatePublisherEnvironment } from './dossier-publisher.js';

async function run() {
  validatePublisherEnvironment();
  await runDossierPublisher();
}

run().catch((error) => {
  log('fatal', 'Çin Sanatları Dosyası publisher durdu', {
    reason: 'publisher_failed',
    error: error.stack || error.message
  });
  process.exitCode = 1;
});
