// Image identities use downloaded byte hashes first; URLs only identify known
// resizes of one source file. Distinct photos are never dropped for sharing a person.
function sourceImageIdentity(value = '') {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname).replace(/-\d{2,5}x\d{2,5}(?=\.[a-z]{3,5}$)/iu, '');
    return `${url.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return '';
  }
}

export function uniqueEditorialImages(primary = {}, candidates = []) {
  const hashes = new Set(primary.imageHash ? [primary.imageHash] : []);
  const sources = new Set(sourceImageIdentity(primary.sourceUrl) ? [sourceImageIdentity(primary.sourceUrl)] : []);
  const images = [];
  const duplicates = [];
  for (const image of candidates) {
    const source = sourceImageIdentity(image.sourceUrl);
    if ((image.imageHash && hashes.has(image.imageHash)) || (source && sources.has(source))) {
      duplicates.push({ sourceUrl: image.sourceUrl, reason: 'same-bytes-or-source-photo' });
      continue;
    }
    images.push(image);
    if (image.imageHash) hashes.add(image.imageHash);
    if (source) sources.add(source);
  }
  return { images, duplicates };
}

export function inlineImageFindings(html = '') {
  const source = String(html);
  const sourceIndex = source.search(/<aside\b[^>]*class=["'][^"']*sanatcin-source/iu);
  const figures = [...source.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure\s*>/giu)];
  const seen = new Set();
  const findings = [];
  for (const figure of figures) {
    if (sourceIndex >= 0 && figure.index > sourceIndex) {
      findings.push({ code: 'figure_after_source', severity: 'major' });
    }
    const src = figure[0].match(/<img\b[^>]*\bsrc=["']([^"']+)["']/iu)?.[1];
    if (!src) continue;
    const key = sourceImageIdentity(src) || src;
    if (seen.has(key)) findings.push({ code: 'duplicate_inline_image', severity: 'major' });
    seen.add(key);
  }
  return findings;
}
