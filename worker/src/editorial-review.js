// Bounded, explainable newsroom checks. These are not a semantic accuracy score.
// Only unambiguous calques require repair; contextual terminology stays advisory.
export const NEWSROOM_REVIEW_GUIDANCE = [
  'Dil denetimini puanla geçiştirme: her cümlede kimin ne yaptığını ve Türkçede aynı olayın nasıl anlatılacağını denetle.',
  'Geçit töreni bağlamındaki “halk geçitleri” ve “Han tarzı flaş moblar” gibi aktarmaları kelime değiştirerek değil, kaynak anlamını koruyarak yeniden kur. Bu örnekleri haberin olgusu gibi metne ekleme.',
  '“Somut olmayan kültürel miras taşıyıcısı” bir resmî unvansa anlamını koru ve ustanın hangi zanaatı yaşattığını açıkla; unvanı UNESCO statüsü gibi doğrulanmamış bir iddiaya dönüştürme.',
  'Kurumun kimliğini koruyarak Türkçe açıklayıcı karşılık kullan; gerekirse özgün adını ilk kullanımda parantezde ver. Marka, kişi ve eser adlarını körlemesine çevirmeden terimleri bağlamında açıkla.',
  'Spot girişin aynısı olmasın: ana gelişmeyi girişte ver, spotta doğrulanmış tamamlayıcı ayrıntıyı kullan. Yalnız metni uzatmak için aynı görüşü sonuç paragrafında tekrarlama.',
  'Uluslararası haberde Çinli sanatçı veya tasarımcının katkısı kaynakta ana unsurlardan biriyse bunu girişte görünür kıl; tali Çin bağlantısını ana gelişme gibi büyütme.',
  'Başlık düzeltmesinde doğrulanmış ayırt edici kişiyi veya ayrıntıyı genel bir “festival başladı” duyurusuna feda etme. Sırf değişiklik için başlığı değiştirme.'
].join(' ');

const RULES = [
  { code: 'literal_folk_parade', severity: 'repair', pattern: /(?<!\p{L})halk geçi(?:t(?:leri|lerini|lerine|lerinde|lerinin|lerinden)|d(?:i|ini|ine|inde|inin|inden))(?!\p{L})/iu,
    message: '“Halk geçidi” ifadesini kaynakta anlatılan geçit töreni veya geleneksel gösteri bağlamında doğal Türkçeyle yeniden kur.' },
  { code: 'literal_han_flashmob', severity: 'repair', pattern: /(?<!\p{L})Han tarzı flaş mob\p{L}*/iu,
    message: '“Han tarzı flaş mob” ifadesini, kaynaktaki dönem/kültür ve toplu gösteri anlamını koruyarak açıkla.' },
  { code: 'heritage_title', severity: 'review', pattern: /kültürel miras taşıyıcısı/iu,
    message: 'Miras taşıyıcısı unvanını bağlamıyla açıkla; zanaat, usta ve resmî tanınma bilgisini birbirine karıştırma.' },
  { code: 'unexplained_institution', severity: 'review', pattern: /Beijing Music Festival|State Opera South Australia|Fédération de la Haute Couture et de la Mode/iu,
    message: 'Kurum adının yanında anlaşılır Türkçe karşılık bulunduğunu denetle; özgün ad gerekli olabilir.' },
  { code: 'fashion_calque', severity: 'review', pattern: /kumaş odaklı ölçülü minimalizm|hareket hâlindeki bedeni merkeze al|sıvı lamé/iu,
    message: 'Moda terimini veya soyut tasarım ifadesini kaynakta anlatılan kumaş, kesim ya da kullanım özelliği üzerinden açıkla.' }
];

const normalize = value => String(value ?? '').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function newsroomFindings({ title = '', excerpt = '', text = '', paragraphs = [] } = {}) {
  const body = text || paragraphs.join('\n\n');
  const combined = `${title}\n${excerpt}\n${body}`;
  // Preserve attributed direct quotations; checks concern the newsroom's own wording.
  const prose = combined.toLocaleLowerCase('tr-TR').replace(/“[^”]*”|"[^"\n]*"|«[^»]*»/gu, '');
  const findings = RULES.filter(rule => rule.pattern.test(prose))
    .map(({ code, severity, message }) => ({ code, severity, message }));
  const lead = paragraphs[0] || body.split(/\n+/u)[0] || '';
  const spot = normalize(excerpt);
  if (spot.length >= 80 && normalize(lead).includes(spot)) {
    findings.push({ code: 'spot_lead_repeat', severity: 'review', message: 'Spot girişte aynen tekrarlanıyor; olgu eklemeden tamamlayıcı ayrıntı seç.' });
  }
  return findings;
}

export function headlineRevisionIssues(before = '', after = '', factSheet = {}) {
  const calendar = /festival\p{L}*.{0,65}(?:başladı|açıldı|düzenlendi|gerçekleştirildi)(?!\p{L})/iu;
  const previous = normalize(before);
  const current = normalize(after);
  if (!previous || !current || previous === current) return [];
  const people = (Array.isArray(factSheet.people) ? factSheet.people : [])
    .filter(person => typeof person === 'string' && person.trim().length > 3);
  const retainedPerson = people.some(person => previous.includes(normalize(person))
    && current.split(' ').includes(normalize(person).split(' ').at(-1)));
  const lostPerson = people.some(person => {
      const name = normalize(person);
      const surname = name.split(' ').at(-1);
      return previous.includes(name) && !current.includes(name)
        && !current.split(' ').includes(surname);
    });
  const lostAge = /\d+ yaşındaki/iu.test(before) && !/\d+ yaşındaki/iu.test(after);
  if (calendar.test(after) && !calendar.test(before) && (lostPerson || (lostAge && !retainedPerson))) {
    return ['Ayırt edici kişi/yaş bilgisini kaybeden genel festival duyurusu; mevcut başlığı koru.'];
  }
  const oldCodes = new Set(newsroomFindings({ title: before }).map(item => item.code));
  return newsroomFindings({ title: after })
    .filter(item => item.severity === 'repair' && !oldCodes.has(item.code))
    .map(item => item.message);
}
