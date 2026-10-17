import { newsroomFindings } from './editorial-review.js';
import { translationIssues } from './quality.js';

const numbers = value => new Set((String(value ?? '').match(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/gu) ?? [])
  .map(number => number.replace(/[.,]/gu, '')));
const finding = (stage, code, severity, message) => ({ stage, code, severity, message });
const comparable = value => String(value).toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu, '');

function oneLetterTypo(left, right) {
  const a = comparable(left), b = comparable(right);
  if (a === b || Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) === 1;
}

function personTypos(text, people = []) {
  const errors = [];
  for (const person of people) {
    const parts = String(person).trim().split(/\s+/u);
    if (parts.length < 2) continue;
    const first = parts[0], surname = parts.at(-1);
    const mentions = String(text).match(/\p{Lu}[\p{L}.’'-]+\s+[\p{Lu}][\p{L}.’'-]+/gu) ?? [];
    for (const mention of mentions) {
      const [seenFirst, seenSurname] = mention.split(/\s+/u);
      if (comparable(seenFirst) === comparable(first) && oneLetterTypo(seenSurname, surname)) {
        errors.push(`${mention} → ${person}`);
      }
    }
  }
  return [...new Set(errors)];
}

// High-confidence checks only. The fact sheet and source excerpt are evidence,
// not a proof that every semantic assertion in a Turkish article is supported.
export function prepublishQuality({ source = {}, draft = {}, factSheet = {} } = {}) {
  const accuracy = [];
  const language = [];
  const url = String(source.url ?? '').trim();
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error('invalid source URL');
    }
  } catch {
    accuracy.push(finding('A', 'source_link_invalid', 'critical', 'Kaynak bağlantısı geçerli bir HTTP(S) haber adresi değil.'));
  }

  const evidence = `${source.title ?? ''} ${source.text ?? ''} ${JSON.stringify(factSheet)}`;
  const evidenceNumbers = numbers(evidence);
  const unsupported = [...numbers(draft.title)].filter(value => !evidenceNumbers.has(value));
  if (unsupported.length) {
    accuracy.push(finding('A', 'unsupported_headline_number', 'critical', `Başlıktaki sayı kaynak/olgu fişinde bulunmuyor: ${unsupported.join(', ')}.`));
  }
  const body = String(draft.text ?? draft.paragraphs?.join('\n\n') ?? '');
  const title = String(draft.title ?? '');
  const typos = personTypos(`${title}\n${draft.excerpt ?? ''}\n${body}`, factSheet.people);
  if (typos.length) accuracy.push(finding('A', 'verified_person_typo', 'critical', `Doğrulanmış kişi adıyla tek harflik çelişki: ${typos.join('; ')}.`));
  const unknownBodyNumbers = [...numbers(`${draft.excerpt ?? ''} ${body}`)].filter(value => !evidenceNumbers.has(value));
  if (unknownBodyNumbers.length) {
    accuracy.push(finding('A', 'unsupported_body_number', 'critical', `Metindeki sayı kaynak/olgu fişinde bulunmuyor: ${unknownBodyNumbers.join(', ')}.`));
  }
  const headline = `${title} ${draft.excerpt ?? ''}`;
  const factText = JSON.stringify(factSheet).toLocaleLowerCase('tr-TR');
  if (/oscar(?:’|')?a aday|oscar adaylığı/iu.test(headline)
      && /oscar.{0,70}(?:başvuru|katılma|yeterlilik)/iu.test(factText)
      && !/oscar.{0,30}aday/iu.test(factText)) {
    accuracy.push(finding('A', 'oscar_candidacy_overclaim', 'critical', 'Kaynak yalnız Oscar başvurusu veya katılım hakkını doğruluyor; adaylık iddiası yayımlanamaz.'));
  }
  if (/(?<!\p{L})(?:ödül\p{L}*|aday\p{L}*|kazandı|açıldı)(?!\p{L})/iu.test(title)
      && !/(?<!\p{L})(?:ödül\p{L}*|aday\p{L}*|kazandı|açıldı|seçildi|verildi|başvuru\p{L}*)(?!\p{L})/iu.test(body)) {
    language.push(finding('B', 'headline_body_claim', 'minor', 'Başlığın ana iddiası gövdede açıkça karşılanmıyor; editör kontrolü gerekebilir.'));
  }

  for (const item of newsroomFindings(draft, factSheet)) {
    if (item.code === 'oscar_candidacy_overclaim') continue;
    language.push(finding('B', item.code, item.severity === 'repair' ? 'major' : 'minor', item.message));
  }
  const issues = translationIssues(draft, factSheet);
  for (const issue of issues) {
    if (/Çince karakter|kaynak-site artığı|yinelenen cümle|doğrulanmış yerel ad/iu.test(issue)) {
      language.push(finding('B', 'structural_language', 'major', issue));
    } else if (/Başlık 32-82|Spot 105-180|aşırı uzun|isimleştirme|klişe/iu.test(issue)) {
      language.push(finding('B', 'format_or_style', 'minor', issue));
    }
  }
  return {
    accuracy,
    language,
    publishable: !accuracy.some(item => item.severity === 'critical') && !language.some(item => item.severity === 'major')
  };
}

export function assertPrepublishQuality(review) {
  const critical = review.accuracy.filter(item => item.severity === 'critical');
  if (critical.length) {
    const error = new Error(`QUALITY_FACT: Editör incelemesi gerekli: ${critical.map(item => item.message).join(' ')}`);
    error.qualityFindings = critical;
    throw error;
  }
  const major = review.language.filter(item => item.severity === 'major');
  if (major.length) {
    const error = new Error(`QUALITY_LANGUAGE: Hedefli düzeltme başarısız: ${major.map(item => `[${item.code}] ${item.message}`).join(' ')}`);
    error.qualityFindings = major;
    throw error;
  }
}
