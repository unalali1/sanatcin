// Editorial guidance and contextual checks. Findings prompt a source-grounded
// correction; they never substitute a guessed translation or historical fact.
export const ARTS_EDITOR_GUIDANCE = [
  'Görsel sanatlarda sergi, yerleştirme, retrospektif, koleksiyon ve eser terimlerini gerçek işlevine göre kullan; sergilenmeyen bir eseri sergilendi diye yazma. Müze haberinde nesnenin, sanatçının ve mekânın rollerini ayır.',
  'Sinemada gösterim, vizyon, festival seçkisi, ödül ve Oscar başvuru/katılım hakkı ayrı aşamalardır. Festival ödülünü Oscar adaylığı veya Oscar ödülü gibi gösterme; teknik yeterlilik ifadesini okurun anlayacağı, kaynakta doğrulanan süreçle açıkla.',
  'Tiyatro ve operada oyuncu, rol, sahneleme, dekor, koreografi ve icra tekniğini birbirine karıştırma. Kaynakta anlamı açıklanmayan Çince sahne tekniğine rastgele Türkçe ad verme; kısa açıklama için kaynakta doğrulanmış fiziksel hareketi kullan.',
  'Moda ve tasarımda look sözcüğünü bağlama göre kıyafet, tasarım, kombin ya da podyuma çıkan parça olarak anlat; “görünüm sergilendi” gibi düz çeviriye sığınma. Kokunun defiledeki kullanımını anlatırken markayı, etkinliği, giysiyi ve kokuyu ayrı özne olarak kur.',
  'Geleneksel Çin kültürü ve somut olmayan mirasta bayramın tarihini, anlamını ve bugünkü uygulamasını yalnız olgu fişi destekliyorsa açıkla. Yerleşik Türkçe karşılığı öncele; özgün kavramın anlamı belirsizse kaynağa dönmeden kelime kelime çeviri veya tarihsel açıklama uydurma.',
  'Başlık haberin esas gelişmesini tek okumada anlatmalı. Somut ama tali bir ayrıntı ana haberi örtmemeli; doğal soru başlığı haberin yanıtını gövdede gerçekten veriyorsa korunabilir.',
  'Spot başlığı başka sözcüklerle tekrarlamasın; doğrulanmış ikinci önemli unsuru versin. Giriş ana haberi, ikinci paragraf neden ve bağlamı, sonraki paragraflar önem sırasına göre ayrıntıları taşısın. Zaten güçlü cümleyi sırf değişiklik için oynatma.'
].join(' ');

const lower = value => String(value ?? '').toLocaleLowerCase('tr-TR');
const finding = (code, severity, field, message) => ({ code, severity, field, message });

export function contextualArtsFindings({ title = '', excerpt = '', text = '', paragraphs = [] } = {}, factSheet = {}) {
  const body = text || paragraphs.join('\n\n');
  const headline = lower(title);
  const spot = lower(excerpt);
  const prose = lower(body).replace(/“[^”]*”|"[^"\n]*"|«[^»]*»/gu, '');
  const facts = lower(JSON.stringify(factSheet));
  const findings = [];

  if (/gurme kokular[ıi]/u.test(headline) && /tatlı ekseninin dışına taşı/u.test(headline)) {
    findings.push(finding('fragrance_axis', 'repair', 'title', 'Koku eğilimini soyut “eksen” kalıbıyla değil, kaynakta doğrulanan koku örnekleri veya somut eğilimle anlat.'));
  }
  if (/defile/u.test(headline) && /kokusu keselerle yayıldı/u.test(headline) && /moda haftası|koleksiyon/u.test(prose)) {
    findings.push(finding('runway_scent_angle', 'repair', 'title', 'Keseler kaynakta doğrulanmış olsa da başlıkta defilenin ve giysi-koku ilişkisinin haber değerini açıklığa kavuştur.'));
  }
  if (/oscar yeterliliği kazandı/u.test(headline)) {
    findings.push(finding('oscar_qualification', 'repair', 'title', 'Ödülle elde edilen Oscar sürecini kaynağın doğruladığı başvuru veya katılım hakkı olarak açık anlat; adaylık ya da Oscar ödülü ima etme.'));
  }
  if (/çin dişi manipülasyonu/u.test(prose) && /opera|sahne|oyuncu/u.test(prose)) {
    findings.push(finding('opera_technique', 'repair', 'body', 'Bu sahne tekniği çevirisi Türkçede anlaşılmıyor. Kaynağın anlattığı hareketi doğrula ve kısa doğal açıklama kullan; yeni teknik adı uydurma.'));
  }
  if (/podyum anlatısının parçası oldu/u.test(prose) && /defile|moda|podyum|koleksiyon/u.test(prose)) {
    findings.push(finding('runway_narrative', 'repair', 'body', 'Kıyafetin, kokunun veya nesnenin defilede ne yaptığını somut fiille anlat; kaynağa dayanmayan yorum ekleme.'));
  }
  if (/\d+[’']?(?:den|dan|ten|tan)? fazla görünüm sergilendi/u.test(prose) && /defile|moda|podyum|koleksiyon/u.test(prose)) {
    findings.push(finding('fashion_looks', 'repair', 'body', 'Look sayısını ve kapsamını koruyup bağlama uygun kıyafet/tasarım/çıkış sözcüğünü seç; “görünüm sergilendi” düz çevirisini açıklığa kavuştur.'));
  }
  if (/oscar(?:’|')?a aday|oscar adaylığı/u.test(`${headline} ${spot}`)
      && /oscar.{0,70}(?:başvuru|katılma|yeterlilik)/u.test(facts)
      && !/oscar.{0,30}aday/u.test(facts)) {
    findings.push(finding('oscar_candidacy_overclaim', 'repair', 'title_spot', 'Olgu fişi yalnız başvuru/katılım hakkını doğruluyor; başlık veya spot Oscar adaylığı ilan etmemeli.'));
  }
  const normalized = value => lower(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (normalized(excerpt).length >= 80 && normalized(body.split('\n')[0]).includes(normalized(excerpt))) {
    findings.push(finding('spot_lead_repeat', 'repair', 'excerpt', 'Spot girişte aynen tekrar ediyor; kaynakta doğrulanmış tamamlayıcı ayrıntıyı spotta kullan.'));
  }
  return findings;
}
