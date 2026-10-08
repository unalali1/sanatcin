import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './logger.js';
import {
  editorialDraftChanged,
  normalizeNewsroomTerms,
  numericFactRegression,
  editorialFluencyProfile,
  headlineQualityRegression,
  nativeNameRegression,
  translationIssues
} from './quality.js';

// A failed editorial request should move to the next candidate quickly. The old
// pipeline retried every one of its many AI calls and could spend minutes on one
// article before rejecting it.
const client = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.aiRequestTimeoutMs,
  maxRetries: 0
});

function parseJson(value) {
  const compact = String(value).replace(/^```json\s*|\s*```$/g, '').trim();
  const start = compact.indexOf('{');
  const end = compact.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Editoryal model geçerli JSON döndürmedi.');
  return JSON.parse(compact.slice(start, end + 1));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

function cleanString(value) {
  return normalizeNewsroomTerms(value ?? '')
    .replace(/\bOrta Sonbahar Bayramı\b/giu, 'Güz Ortası Bayramı')
    .replace(/\bOrta Sonbahar Festivali\b/giu, 'Güz Ortası Bayramı')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDraft(article, draft) {
  const paragraphs = (Array.isArray(draft?.paragraphs) ? draft.paragraphs : []).map(cleanString).filter(Boolean);
  const text = paragraphs.join('\n\n');
  const tags = [...new Set((Array.isArray(draft?.tags) ? draft.tags : []).map(cleanString).filter(Boolean))].slice(0, 5);
  return {
    ...article,
    title: cleanString(draft?.title),
    excerpt: cleanString(draft?.excerpt),
    paragraphs,
    text,
    tags,
    bodyHtml: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')
  };
}

function sourceExcerpt(text, maxChars = 18_000) {
  const compact = String(text ?? '').trim();
  if (compact.length <= maxChars) return compact;
  const head = compact.slice(0, Math.floor(maxChars * 0.80));
  const tail = compact.slice(-Math.floor(maxChars * 0.20));
  return `${head}\n\n[KAYNAK METNİN ORTA BÖLÜMÜ KISALTILDI]\n\n${tail}`;
}

function normalizeFactSheet(sheet = {}) {
  const list = (value, limit = 20) => (Array.isArray(value) ? value : []).map(cleanString).filter(Boolean).slice(0, limit);
  const facts = list(sheet.facts, 30);
  return {
    publishable: sheet.publishable === true,
    sourceType: cleanString(sheet.sourceType),
    newsValue: cleanString(sheet.newsValue),
    angle: cleanString(sheet.angle),
    facts,
    leadFacts: list(sheet.leadFacts, 5).length ? list(sheet.leadFacts, 5) : facts.slice(0, 3),
    supportingFacts: list(sheet.supportingFacts, 20).length ? list(sheet.supportingFacts, 20) : facts.slice(3),
    attributionRequired: list(sheet.attributionRequired, 15),
    promotionalClaims: list(sheet.promotionalClaims, 15),
    chronology: list(sheet.chronology, 15),
    terminology: list(sheet.terminology, 20),
    avoidInferences: list(sheet.avoidInferences, 15),
    people: list(sheet.people),
    organisations: list(sheet.organisations),
    places: list(sheet.places),
    numbers: list(sheet.numbers),
    quotes: (Array.isArray(sheet.quotes) ? sheet.quotes : [])
      .map((quote) => ({ speaker: cleanString(quote?.speaker), text: cleanString(quote?.text) }))
      .filter((quote) => quote.text)
      .slice(0, 8),
    context: list(sheet.context, 15),
    nativeNames: (Array.isArray(sheet.nativeNames) ? sheet.nativeNames : [])
      .map((item) => ({
        type: cleanString(item?.type).toLowerCase(),
        turkish: cleanString(item?.turkish),
        hanzi: cleanString(item?.hanzi),
        pinyin: cleanString(item?.pinyin),
        sourceForm: cleanString(item?.sourceForm),
        verified: item?.verified === true
      }))
      .filter((item) => item.verified && item.turkish && item.hanzi && item.pinyin)
      .slice(0, 15)
  };
}

async function requestJson({ model, input, signal }) {
  const response = await client.responses.create({
    model,
    input
  }, { signal });
  return parseJson(response.output_text);
}

async function extractFactSheet(article, signal, completeJson = requestJson) {
  const result = await completeJson({
    model: config.openaiFactModel,
    signal,
    input: [
      {
        role: 'system',
        content: [
          'Bir kültür-sanat haberinin olgu fişini hazırlayan dikkatli bir araştırma editörüsün.',
          'Bu aşamada haber, çeviri, başlık, spot veya Türkçe taslak YAZMA. Yalnız kaynakta açıkça bulunan doğrulanabilir bilgileri çıkar.',
          'Kişi adlarını kaynakta kullanılan tam Latin yazımıyla koru; ad veya soyadı kısaltma. Tarihleri, sayıları, yerleri, kurumları, eser ve etkinlik adlarını değiştirme.',
          'Eser, dizi, film, program, sergi, akım veya kültürel kavramın özgün Çince adı ve pinyin yazımı kaynakta açıkça bulunuyorsa nativeNames alanına yapılandırılmış biçimde kaydet. Yalnız hem Çince karakter hem pinyin kaynakta açıkça bulunuyorsa verified=true ver. İngilizce başlığı otomatik olarak özgün ad kabul etme; kaynakta olmayan Çince adı veya pinyin yazımını tahmin etme ya da uydurma.',
          'Alıntıları konuşanı ve ihtiyat düzeyiyle birlikte kaydet. Kaynakta olmayan yorum, neden-sonuç, duygu, sıfat veya arka plan ekleme.',
          'Haber yazarı kaynak metni görmeyecek. Bu nedenle leadFacts alanına girişte kullanılabilecek en güçlü 2-4 olguyu; supportingFacts alanına ayrıntıları; chronology alanına tarih sırasını eksiksiz yaz.',
          'Kurumların övgü, üstünlük, başarı veya etki iddialarını promotionalClaims alanına; mutlaka bir kişi ya da kuruma bağlanması gereken bilgileri attributionRequired alanına ayır.',
          'Terim, unvan, eser adı ve yer adı için güvenli Türkçe karşılığı terminology alanına yaz. Kaynaktan çıkarılamayacak neden-sonuç ve genellemeleri avoidInferences alanında açıkça belirt.',
          'Kaynak tam bir haber, röportaj, eleştiri, etkinlik haberi ya da açıklayıcı fotoğraf haberiyse; somut bir gelişme ve en az dört doğrulanabilir olgu varsa publishable=true ver.',
          'Kısa ama yeterli bir kültür-sanat haberi yalnız uzun olmadığı için reddedilmemeli. Navigasyon, reklam, salt takvim kaydı veya olgusuz tanıtım metni publishable=false olmalı.',
          'Tarih bağlamını eksiksiz çıkar. Kaynakta geçmiş bir kasım, gelecek bir eylül veya belirli bir yıl yazıyorsa bunu context/numbers alanında kaybetme; Türkçe haberde zamanın yanlış anlaşılmasına yol açacak belirsizliği önle.',
          'Çin National Day tatili için Milli Bayram, Mid-Autumn Festival için Güz Ortası Bayramı kullan. Girişte kaynakla doğrulanmış gelişmeyi, yeri ve haber değerini somut bir fiille anlat; protokol listesini ve uzun kurum adlarını sonraya bırak. Soyut önem cümlesi yerine kaynaktaki eser, üretim veya olay ayrıntısını ver.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Kaynak: ${article.source.name}`,
          `Kaynak URL: ${article.url}`,
          `Kaynak başlığı: ${article.title}`,
          `Önerilen kategori: ${article.category}`,
          `Kaynak metin:\n${sourceExcerpt(article.text)}`,
          'JSON şeması: {"factSheet":{"publishable":true,"sourceType":"article|interview|review|announcement|gallery","newsValue":"somut haber değeri","angle":"somut gelişme","facts":["doğrulanmış olgu"],"leadFacts":["giriş için güçlü olgu"],"supportingFacts":["gövde ayrıntısı"],"attributionRequired":["kime atfedileceği açık iddia"],"promotionalClaims":["kurumsal övgü veya iddia"],"chronology":["tarih ve olay"],"terminology":["kaynak terim = güvenli Türkçe karşılık"],"avoidInferences":["çıkarılmaması gereken sonuç"],"people":["tam kişi adı"],"organisations":["kurum"],"places":["yer"],"numbers":["sayı veya tarih"],"quotes":[{"speaker":"konuşan","text":"kaynak dilindeki kısa alıntı"}],"context":["kaynakta bulunan bağlam"],"nativeNames":[{"type":"work|event|programme|concept|institution","turkish":"doğal Türkçe karşılık","hanzi":"kaynakta geçen Çince karakterler","pinyin":"kaynakta geçen pinyin","sourceForm":"kaynakta geçen tam biçim","verified":true}]}}'
        ].join('\n\n')
      }
    ]
  });
  return normalizeFactSheet(result.factSheet);
}

async function writeTurkishNews(article, factSheet, { draft = null, feedback = [], signal, completeJson = requestJson } = {}) {
  const repairing = Boolean(draft);
  const result = await completeJson({
    model: config.openaiEditorModel,
    signal,
    input: [
      {
        role: 'system',
        content: [
          'SanatÇin haber merkezinde çalışan kıdemli bir Türkiye Türkçesi editörü ve olgu denetçisisin.',
          "Metnin üretim sürecini anlatan meta-dil kullanma; 'Kaynak metne göre', 'Kaynak, ...' ve 'metinde belirtildi' gibi ifadeler yazma. Bilgi atfedilecekse gerçek kaynak, kişi veya kurum adını kullan.",
          repairing
            ? 'Verilen Türkçe metindeki denetim notlarını gider; metni kaynak ve olgu fişine bağlı kalarak yeniden düzenle.'
            : 'Zenginleştirilmiş olgu fişindeki doğrulanmış bilgilerden hareketle Türkçe haberi sıfırdan yaz; kaynak dildeki cümle sırasını yeniden kurmaya çalışma.',
          'Olgu fişi doğruluk sınırıdır, paragraf planı değildir. Kaynak haber ve kaynak başlığı yalnız haber hammaddesidir; cümle sırasını, paragraf sırasını veya vurgu hiyerarşisini kopyalama. Haber örgüsünü Türkçe gazetecilikteki önem sırasına göre kur.',
          'Yazmaya başlamadan önce sessizce üç şeyi belirle: haberin asıl hikâyesi nedir; Türk okuyucu açısından en ilginç ve ayırt edici somut unsur nedir; hangi bilgi girişte, hangisi arka planda kalmalıdır. Bu analizi çıktıda gösterme.',
          'Giriş için özel haber değeri testi: okur ilk iki cümleden haberin esas gelişmesini ve niçin haber olduğunu öğrenmeli. Birden çok örnekli trend haberinde önce ortak eğilimi somut biçimde ortaya koy, tekil örnekleri ikinci paragraftan itibaren işle. Arkeoloji haberinde keşfin ilgi çekici bulgusunu teknik ölçülerden önce, film haberinde eserin kimliğini ve hikâyesini genel açıklamalardan önce ver.',
          'Her paragrafın haberin ana açısıyla ilişkisini denetle. Mekanik olgu listeleri, rastgele şehirler arasında sıçrama ve gereksiz yan ayrıntılar varsa birleştir, yeniden sırala veya kaynak anlamını bozmadan kısalt. Başlık ve spotta ana gelişmeyi tekrar tekrar söyleme.',
          'İlk paragraf kaynak metnin ilk paragrafının çevirisi olmak zorunda değildir. Kim-ne-nerede-ne zaman sorularından kaynakta yanıtı bulunanları doğal biçimde ver; mümkünse haberin en güçlü somut unsurunu ilk 1-2 cümlede görünür kıl. Sonraki paragraflar önem, ayrıntı ve bağlam sırasıyla ilerlemeli.',
          'Kısa, açık ve çoğunlukla etkin cümleler kullan. Kaynak dilin sözdizimini, zincirleme tamlamalarını, tanıtım tonunu ve kelime kelime çeviri kokusunu taşıma. Bir cümle anlamca doğru olsa bile Türkiye Türkçesinde bir gazetecinin doğal biçimde kurmayacağı hissini veriyorsa cümleyi tamamen yeniden kur.',
          'İngilizcedeki isimleştirmeleri Türkçeye aynen aktarma. “karakterlerin gelişimi”, “mesleklerinin ilk yılları”, “iş birliğinin ilerletilmesi” gibi yapıları gerektiğinde fiilli ve doğal Türkçe cümlelere dönüştür.',
          'Kaynak metnin cümle ve paragraf sırasını körü körüne izleme. Türkçe bir editör aynı olguları hangi sırayla ve hangi fiillerle yazardıysa o şekilde yeniden kur.',
          'Paragrafları birbirinden kopuk özet maddeleri gibi kurma. Her paragraf bir öncekinin bıraktığı bilgiye doğal biçimde bağlansın; yapay geçiş kalıpları ve aynı ritimde yinelenen cümlelerden kaçın. Kültür-sanat haberinde kaynakta doğrulanmışsa mekân, eser, malzeme, gelenek veya performansın somut/görsel niteliğini kullanarak metne atmosfer kazandır; kaynakta olmayan betimleme veya duygu ekleme.',
          '“Artık yalnızca ... değil”, “bu dönüşümün dikkat çeken örneklerinden biri”, “farklı deneyimsel”, “söz alanı açıyor”, “yeni bir alan yaratıyor” ve art arda kullanılan “bir araya getiriyor” kalıplarını doğal Türkçe fiillerle yeniden kur.',
          'Aynı soyut sözcüğü — özellikle deneyim, yaklaşım, dönüşüm, süreç, alan veya model — metin boyunca tekrarlama. Somut özne ve eylemi doğrudan söyle.',
          'Bir kişi veya kurumun biyografisindeki her ayrıntıyı taşımak zorunda değilsin. Haberin ana gelişmesi için gerekli olmayan eğitim, görev ve kurum listelerini kısalt; metni özgeçmiş dökümüne dönüştürme.',
          'Türk okurunun bilmeyebileceği Çince teknik terim, sanat tekniği veya kurum sınıflandırmasını açıklamasız romanizasyonla bırakma. Doğal Türkçe karşılığını ver; özgün terimi ancak gerçekten gerekli ise ilk kullanımda parantez içinde koru.',
          '“Dikkat çekiyor”, “öne çıkıyor”, “gözler önüne seriyor”, “önemli bir adım” ve “büyük ilgi gördü” gibi hazır ifadeleri ancak kaynakta somut dayanağı varsa kullan.',
          'Kurum açıklamalarındaki övgü ve iddiaları haberin kendi hükmü gibi yazma; söyleyeni açıkça belirt. Kaynaktaki neden-sonuç ilişkisini güçlendirme veya yeni bir önem atfetme.',
          'Türkiye Türkçesinde yerleşik karşılığı olan şehir ve kavramları Türkçeleştir; Pekin ve Şanghay yazımlarını kullan. Sergi, etkinlik, belgesel, program ve benzeri kültür-sanat adlarının resmî veya yerleşik Türkçe karşılığı varsa onu kullan. Çince olmayan yabancı adlarda böyle bir karşılık yoksa, ad açıklayıcı nitelikteyse anlamını koruyan doğal bir Türkçe karşılık üret; özgün yabancı adı ancak marka niteliği, uluslararası tanınırlık veya anlam belirsizliği nedeniyle gerçekten gerekliyse ilk kullanımda parantez içinde ver. Çince adlandırmalarda ise bir sonraki özel kuralı uygula.',
          'Türkçede yerleşik karşılığı bulunmayan Çince eser, dizi, film, program, sergi, sanat akımı veya kültürel kavram adlarında doğal Türkçe karşılığı metnin ana adı yap. Özgün Çince ad ve pinyin olgu fişindeki nativeNames alanında verified=true olarak bulunuyorsa ilk kullanımda kısa editoryal biçimi uygula: Doğal Türkçe Karşılık (“中文名称”, Pinyin). Türkçe karşılık kelime kelime olmak zorunda değildir; anlamı, çağrışımı ve varsa kelime oyununu mümkün olduğunca korumalıdır. İlk kullanımdan sonra yalnız doğal Türkçe karşılığı kullan. Çin eserleri ve sergilerinde İngilizce ara çeviriyi ekleme; özgün Çince ad varsa doğrulanmış biçimini kullan. Özgün Çince ad kaynakta yoksa tahmin etme veya uydurma; bu durumda yalnız doğal Türkçe karşılığı kullan.',
          'Kişi, kurum ve marka adlarını eksiksiz koru; Lu ya da Liu gibi kısaltmalar yapma. Sayıları, tarihleri ve alıntı anlamlarını değiştirme. Eser ve etkinlik adlarında anlamı, sayıları ve ayırt edici unsurları koru; açıklayıcı yabancı adları Türkçede doğal okunacak biçimde aktar.',
          '“Ambassador”, “envoy”, “representative” gibi unvanları bağlamına göre çevir; marka elçisini veya moda haftası temsilcisini diplomatik büyükelçi gibi gösterme.',
          'Ay ve gün içeren geçmiş/gelecek olaylarda yıl belirsizliği doğuracaksa kaynakta bulunan yılı Türkçe metne ekle. Haberin yayımlandığı tarihe göre “kasım ayında” gibi ifadelerin yanlış zaman algısı yaratmasına izin verme.',
          'Kaynakta geçen her ayrıntıyı kullanmak zorunda değilsin; anlamı bozmayan özetleme, sadeleştirme ve seçme olgu hatası değildir.',
          'Çin’deki Mid-Autumn Festival için Türkçede “Güz Ortası Bayramı” karşılığını kullan; “Orta Sonbahar Bayramı” veya “Orta Sonbahar Festivali” yazma.',
          'Başlığı somutlaştır; spot, başlık ve giriş tekrarlarını gider. Kaynak başlığını editoryal referans olarak kullan: kaynak başlık haberin ana gelişmesini açık, doğru ve geniş biçimde özetliyorsa onun bilgi hiyerarşisini koru ve doğal Türkiye Türkçesine uyarla. Sırf daha yaratıcı görünmek için kaynak başlıktaki ana konuyu dar bir ayrıntıyla değiştirme. Kaynak başlık zayıf, tanıtım dili taşıyor veya Türkçede işlemezse doğrulanmış olgulardan daha iyi bir başlık kur. Sayı, satıcı/katılımcı adedi, tek bir sıra dışı tat ya da kurum duyurusu ancak gerçekten ana haber değeriyse başlığın merkezinde olsun. Zorunlu olmayan İngilizce sözcükleri, uzun yabancı etkinlik/sergi adlarını, yapay tamlamaları, açıklanmamış ham Pinyin zincirlerini ve propaganda dilini temizle. Doğrulanmış özgün Çince adın ardından parantez içinde verilen pinyin bu yasağın dışındadır. Okur İngilizce bilmeden metni anlayabilmeli.',
          'Başlık Türkiye’deki okuyucunun dış bağlam bilmeden tek okumada anlayacağı kadar açıklayıcı olmalı. Türkiye’de geniş ölçüde bilinmeyen bir etkinlik, program, kurum veya marka adını tek başına başlığın merkezine koyma; önce bunun ne olduğunu Türkçe olarak anlat.',
          'Başlıkta mümkünse haberin en ayırt edici somut unsurunu öne çıkar: önemli ödül, sıra dışı mekân, güçlü sayı, ilk olma, tanınmış isim veya özgün kültürel gelişme. Clickbait yapma ve kaynakta olmayan üstünlük ekleme. Başlığı yalnız yer adı + iki isimden oluşan katalog kalıbına bırakma; kaynak izin veriyorsa somut bir eylem, gelişme veya etkinlik türüyle tamamla.',
          '“Çin bağlantılı”, “sahnede”, “buluştu”, “görücüye çıktı”, “heyecanı yaşandı” gibi muğlak veya klişe ifadeler yerine kaynak izin veriyorsa daha kesin özne ve fiil kullan. “X’te Y ve Z” gibi eksik isim dizilerini yalnız güçlü bir dergi başlığı etkisi yaratıyorsa kullan; sıradan haberlerde cümleyi doğal bir fiille tamamla.',
          'Başlık doğal, akıcı ve somut bir Türkçe cümle olsun; kaynak başlığı kopyalanmasın. Okunduğunda çeviri, etkinlik takvimi veya kategori etiketi gibi durmamalı. 32-82 karakter kullan, mümkünse 45-75 karakterde kal.',
          'Spot başlığı tekrarlamayan, haberin önemini açıklayan tek cümle olsun; 105-180 karakter kullan, mümkünse 115-165 karakterde kal.',
          'Haber değerine göre 3-7 kısa paragraf üret. Küçük bir atama veya sergi haberini gereksiz ayrıntıyla uzatma; güçlü trend ve dosya haberinde gerekli bağlamı koru. Gövde en az 600 karakter olmalı. Çince karakter yalnızca doğrulanmış özgün adın, Türkçe karşılığı ve pinyin ile birlikte verilen ilk kullanımında yer alabilir; bunun dışında ham Çince bırakma.',
          'Kaynakta olmayan bilgi, alıntı, yorum veya kesinlik ekleme. Doğrulanamayan bir boşluğu tahminle doldurma.',
          'Düzeltilebilir dil, uzunluk veya biçim sorunu gördüğünde reddetme; metni düzelt ve accepted=true ver.',
          'Yalnız kaynak haber yazmaya gerçekten yetmiyorsa, önemli bir olgu çelişkisi giderilemiyorsa veya güvenilir metin kaynak dışı bilgi eklemeden kurulamıyorsa accepted=false ver.',
          'Yanıtlamadan önce sessiz iki aşamalı editör kontrolü yap. Önce başlığı şu beş soruyla denetle: Türk okur başlığı tek okumada anlıyor mu; haberin ayırt edici unsurunu görüyor mu; başlık kaynak dilden çevrilmiş gibi mi duruyor; yalnız isimleri yan yana diziyor mu; daha doğal ve canlı ama aynı ölçüde doğru bir Türkçe fiille kurulabilir mi? Ardından tüm metne şu testi uygula: “Bir Türk gazeteci bu cümleyi gerçekten böyle kurar mı?” ve “Okur bunun çeviri olduğunu cümle yapısından sezebilir mi?” Sorun varsa teslim etmeden önce yeniden yaz.',
          'Kurum adlarını doğal Türkçeyle ver: National Art Museum of China = Çin Ulusal Sanat Müzesi. Çin eser/sergi adlarının İngilizce ara çevirisini parantezde tekrar etme; doğrulanmış Çince ad ve pinyin yoksa yalnız doğal Türkçe karşılığı kullan. Yeşim gibi malzemelerde kelime kelime teknik tamlama kurma; terimi kaynak anlamıyla kısa ve anlaşılır açıkla. Türkçe ifadeyi “Çincede ... olarak adlandırılıyor” diye tekrarlama. Nesneye “iz sürmek” gibi araştırmacı eylemi yükleme. Girişte idari yer adlarını yığma; ana gelişmeyi öne al. Sanat haberini protokol konuşmalarına boğma; kaynakta bulunan eser ve üretim ayrıntılarını öncele.',
          'Çin National Day tatili için Milli Bayram, Mid-Autumn Festival için Güz Ortası Bayramı kullan. Girişte kaynakla doğrulanmış gelişmeyi, yeri ve haber değerini somut bir fiille anlat; protokol listesini ve uzun kurum adlarını sonraya bırak. Soyut önem cümlesi yerine kaynaktaki eser, üretim veya olay ayrıntısını ver.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Kaynak başlığı: ${article.title}`,
          `Önerilen kategori: ${article.category}`,
          `Olgu fişi:\n${JSON.stringify(factSheet)}`,
          repairing ? `Düzeltilecek Türkçe metin:\n${JSON.stringify({ title: draft.title, excerpt: draft.excerpt, paragraphs: draft.paragraphs, tags: draft.tags })}` : '',
          feedback.length ? `Mekanik denetim notları:\n${feedback.join(' | ')}` : '',
          'JSON şeması: {"accepted":true,"issues":[],"title":"başlık","excerpt":"spot","paragraphs":["paragraf"],"tags":["etiket"]}'
        ].filter(Boolean).join('\n\n')
      }
    ]
  });
  return {
    accepted: result.accepted === true,
    issues: (Array.isArray(result.issues) ? result.issues : [result.reason]).map(cleanString).filter(Boolean).slice(0, 8),
    draft: normalizeDraft(article, result)
  };
}

async function chooseMoreNaturalDraft(article, factSheet, before, after, { signal, completeJson = requestJson } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= config.editorialJudgeRetries; attempt += 1) {
    const judgeSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(config.editorialJudgeTimeoutMs)])
      : AbortSignal.timeout(config.editorialJudgeTimeoutMs);
    try {
      const result = await completeJson({
        model: config.openaiEditorModel,
        signal: judgeSignal,
        input: [
          {
            role: 'system',
            content: [
              'Türkiye Türkçesiyle çalışan tarafsız bir haber dili hakemisin.',
              'İki metin aynı doğrulanmış olgulara dayanıyor. A ilk Türkçe taslak, B ise çeviri kokusunu gidermek için kıdemli editör tarafından yeniden yazılmış sürümdür. Dil doğallığı, açıklık, haber ritmi, somut fiil kullanımı, Türkçe söz dizimi ve çeviri kokusunun yokluğunun yanında başlık ve girişin haberin ANA FİKRİNİ doğru temsil edip etmediğini karşılaştır.',
              'Olgu fişi doğruluk sınırıdır. B kaynakta olmayan bilgi ekliyor, doğrulanmış kişi/sayı/tarihi değiştiriyor veya ana haber gelişmesini bozuyorsa A’yı seç. Buna karşılık A’daki her tali ayrıntının B’de aynı cümleyle veya aynı uzunlukta bulunmasını şart koşma; doğru özetleme ve sadeleştirme bilgi kaybı değildir.',
              'B doğruluk sınırını koruyor ve Türkiye Türkçesinde belirgin biçimde daha doğal okunuyorsa B’yi tercih et. Yalnız “A daha ayrıntılı” gerekçesi, B ana olguları ve haber açısını koruyorsa A’ya dönmek için yeterli değildir. Eşitlikte A korunabilir; ancak B’nin cümle yapısı ve haber akışı açıkça daha doğalsa bunu önceliklendir.',
              'Özellikle şu soruyu bağımsız değerlendir: Okur B metninin yabancı dilden çevrildiğini cümle yapısından hissediyor mu? Hissedilmiyorsa ve olgusal güvenlik korunuyorsa B lehine değerlendir.',
              'İngilizce kurum adını, mekanik malzeme tamlamasını, bilgi vermeyen terim açıklamasını ve nesneye araştırmacı eylemi yükleyen başlığı kalite kusuru say. Yeni olgu eklemeyen doğal Türkçe anlatımı tercih et.',
              'Çin National Day tatili için Milli Bayram, Mid-Autumn Festival için Güz Ortası Bayramı kullan. Girişte kaynakla doğrulanmış gelişmeyi, yeri ve haber değerini somut bir fiille anlat; protokol listesini ve uzun kurum adlarını sonraya bırak. Soyut önem cümlesi yerine kaynaktaki eser, üretim veya olay ayrıntısını ver.',
              'Yalnız geçerli JSON ver.'
            ].join(' ')
          },
          {
            role: 'user',
            content: [
              `Haber açısı: ${factSheet.angle}`,
              `Doğrulanmış olgu fişi:\n${JSON.stringify(factSheet)}`,
              `A sürümü:\n${JSON.stringify({ title: before.title, excerpt: before.excerpt, paragraphs: before.paragraphs })}`,
              `B sürümü:\n${JSON.stringify({ title: after.title, excerpt: after.excerpt, paragraphs: after.paragraphs })}`,
              'JSON şeması: {"preferred":"A|B","reason":"kısa gerekçe","aScore":0,"bScore":0}'
            ].join('\n\n')
          }
        ]
      });
      return {
        preferred: result.preferred === 'B' ? 'B' : 'A',
        reason: cleanString(result.reason).slice(0, 300),
        aScore: Number(result.aScore) || null,
        bScore: Number(result.bScore) || null,
        source: article.source.id
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (attempt < config.editorialJudgeRetries) {
        log('warn', 'Akıcılık hakemi zaman aşımı/hata sonrası bir kez daha denenecek', {
          source: article.source.id,
          attempt: attempt + 1,
          timeoutMs: config.editorialJudgeTimeoutMs,
          error: String(error?.message ?? error).slice(0, 220)
        });
      }
    }
  }
  throw lastError ?? new Error('Akıcılık hakemi sonuç döndürmedi.');
}

async function refineHeadline(article, factSheet, draft, { signal, completeJson = requestJson } = {}) {
  const result = await completeJson({
    model: config.openaiEditorModel,
    signal,
    input: [
      {
        role: 'system',
        content: [
          'Türkçe kültür-sanat haberleri için başlık editörüsün.',
          'Önce kaynak başlığının haberin ana fikrini ne kadar iyi taşıdığını değerlendir. Kaynak başlık açık ve kapsayıcıysa bilgi hiyerarşisini koruyan doğal bir Türkçe uyarlama adaylardan biri olsun. Ardından zihninde en az üç farklı başlık açısı üret: ana haber gelişmesi, kültürel/hikâyesel ayırt edici unsur ve varsa güçlü görsel/mekânsal unsur. Doğruluk, ana fikre sadakat, somutluk, Türkçe doğallık ve haber ritmi bakımından en iyisini seç; yalnız seçtiğin başlığı JSON içinde döndür.',
          'Başlık kaynakta olmayan bilgi, sıfat, önem atfı veya neden-sonuç eklememeli.',
          'Türkiye’de bilinmeyen kurum, etkinlik veya teknik terimi açıklamasız biçimde başlığın merkezine koyma.',
          'Daha somut bir fiil veya daha güçlü bir haber açısı mümkünse “sunuyor”, “genişliyor”, “öne çıkıyor”, “buluşuyor”, “yer alıyor”, “aynı sahneyi paylaştı” gibi jenerik kalıplara yaslanma. Kaynaktaki sayı, katılımcı adedi, tek bir sıra dışı ürün/tat ya da yan duyuru hikâyenin özü değilse sırf kolay veya çarpıcı olduğu için başlığı onun üzerine kurma.',
          'Sayı veya sıra dışı ayrıntı ana haber değeriyse kullan; yalnız rakam var diye başlığı mekanikleştirme.',
          'Başlık yaklaşık 35-95 karakter arasında, tek okumada anlaşılır ve doğal Türkiye Türkçesiyle olmalı.',
          'İngilizce kurum adını, mekanik malzeme tamlamasını, bilgi vermeyen terim açıklamasını ve nesneye araştırmacı eylemi yükleyen başlığı kalite kusuru say. Yeni olgu eklemeyen doğal Türkçe anlatımı tercih et.',
          'Çin National Day tatili için Milli Bayram, Mid-Autumn Festival için Güz Ortası Bayramı kullan. Girişte kaynakla doğrulanmış gelişmeyi, yeri ve haber değerini somut bir fiille anlat; protokol listesini ve uzun kurum adlarını sonraya bırak. Soyut önem cümlesi yerine kaynaktaki eser, üretim veya olay ayrıntısını ver.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Kaynak başlığı: ${article.title}`,
          `Olgu fişi:\n${JSON.stringify(factSheet)}`,
          `Mevcut başlık: ${draft.title}`,
          `Spot: ${draft.excerpt}`,
          `Haber metni:\n${draft.paragraphs.join('\n\n')}`,
          'JSON şeması: {"title":"seçilen başlık","reason":"kısa gerekçe"}'
        ].join('\n\n')
      }
    ]
  });
  const title = cleanString(result.title);
  if (!title || title.length < 15 || title.length > 120 || title === draft.title) {
    return { draft, changed: false, reason: cleanString(result.reason).slice(0, 220) };
  }
  const candidate = { ...draft, title };
  const beforeIssues = editorialIssues(draft, factSheet);
  const afterIssues = editorialIssues(candidate, factSheet);
  const namingRegression = nativeNameRegression(draft, candidate, factSheet.nativeNames);
  if (afterIssues.length > beforeIssues.length || namingRegression) {
    return { draft, changed: false, reason: 'Yeni başlık kalite veya adlandırma kapısından geçmedi.' };
  }
  return { draft: candidate, changed: true, reason: cleanString(result.reason).slice(0, 220) };
}

async function polishTurkishNews(article, factSheet, draft, { signal, completeJson = requestJson } = {}) {
  const result = await completeJson({
    model: config.openaiEditorModel,
    signal,
    input: [
      {
        role: 'system',
        content: [
          'Sen kaynak dilden çeviri yapan biri değil, Türkçe bir haber merkezinin son okuma ve başlık editörüsün.',
          "Metnin üretim sürecini anlatan meta-dil kullanma; 'Kaynak metne göre', 'Kaynak, ...' ve 'metinde belirtildi' gibi ifadeler yazma. Bilgi atfedilecekse gerçek kaynak, kişi veya kurum adını kullan.",
          'Görevin verilen taslağı yeniden çevirmek değil; metindeki çeviri kokusunu, yabancı sözdizimini, gereksiz isimleştirmeleri, mekanik cümle ritmini ve muğlak başlığı temizlemektir. Taslağın bilgi sırasına da bağlı değilsin: olguları değiştirmeden, Türk okur için daha güçlü bir haber akışı gerekiyorsa paragraf ve vurgu sırasını yeniden kur.',
          'Bu metni yayımlanmadan önce bir kez daha gerçekten YENİDEN YAZ. Kaynak dilin cümle sırasını, kelime dizimini ve paragraf örgüsünü unut; aynı doğrulanmış olguları Türkiye’de bir kültür-sanat editörü haberi ilk kez Türkçe kaleme alıyormuş gibi kur. Yüzeysel eş anlamlı sözcük değişiklikleri yapma. Anlamı doğru olsa bile bir Türk gazetecinin doğal biçimde kurmayacağı her cümleyi baştan kur.',
          'Metin, ilk kez Türkçe yazılmış bir kültür-sanat haberi gibi okunmalı. Fiilleri doğal kullan; uzun tamlamaları böl; özne-yüklem ilişkisini Türkçe haber diline göre yeniden kur. Anlamı doğru fakat Türkçesi mekanik bir cümleyi yüzeysel sözcük değişiklikleriyle bırakma; gerekirse baştan yaz.',
          'Başlık, spot ve giriş aynı bilgiyi tekrar etmesin. Paragraflar arasında doğal akış kur. Kültür-sanat haberinde kaynakta bulunan somut mekân, eser, gelenek, malzeme veya performans ayrıntısını uygun olduğunda öne çıkar; fakat kaynakta olmayan atmosfer, yorum, sıfat veya duygu ekleme.',
          'Başlığı ayrıca bağımsız bir editör gibi yeniden değerlendir. Türkiye’de bilinmeyen etkinlik veya kurum adını açıklamasız biçimde başlığın merkezinde bırakma. Gerekirse özel adı gövdeye indir ve başlıkta etkinliğin ne olduğunu açık Türkçeyle söyle.',
          'Başlıkta somut haber değerini mümkün olduğunca görünür kıl; sayı, ödül, sıra dışı mekân, ilk olma veya tanınmış isim varsa ve gerçekten ana gelişmeyse kullan. Clickbait ve abartı yapma.',
          'Muğlak “Çin bağlantılı”, “öne çıkıyor”, “sahnede” gibi ifadeleri ancak gerçekten en doğru ifade buysa koru; aksi halde daha kesin özne-fiil ilişkisi kur.',
          'Çeviri yanlış anlaşılmasına açık meslek/unvanları bağlama göre düzelt. Marka elçisi ile diplomatik büyükelçiyi, küratör ile yönetici/temsilciyi birbirine karıştırma.',
          'Tarih ve zaman bağlamını denetle. Kaynakta yıl varsa ve “kasım ayında” gibi ifade okuyucuyu yanlış yıla götürebilecekse yılı açıkça yaz.',
          'Olgu fişindeki gerçekleri, kişi/kurum/marka adlarını, tarihleri, sayıları ve alıntı anlamlarını kesinlikle değiştirme. Eser, sergi, etkinlik, belgesel ve program adlarının anlamını koru; açıklayıcı yabancı adları doğal Türkçeye aktar. Kaynakta olmayan hiçbir bilgi ekleme.',
          'Çince eser, dizi, film, program, sergi, sanat akımı veya kültürel kavram adı için ilk taslakta doğal Türkçe karşılık + doğrulanmış özgün Çince ad + pinyin biçimi kullanılmışsa bunu koru. Tercih edilen ilk kullanım kalıbı: Doğal Türkçe Karşılık (“中文名称”, Pinyin). Sonraki kullanımlarda yalnız Türkçe karşılığı bırak. Çin eserleri ve sergilerinde İngilizce ara çeviriyi koruma; Türkçe karşılığı ve varsa doğrulanmış özgün Çince adı esas al. Kaynakta olmayan Çince adı asla uydurma.',
          'Mid-Autumn Festival terminolojisini denetle: Türkçe metinde yalnız “Güz Ortası Bayramı” kullan.',
          'Bir ifade zaten doğal Türkçeyse sırf değişiklik yapmak için değiştirme. Ama İngilizce veya Çince cümle iskeletini taşıyan ifadeleri yeniden kur. Metinde gereksiz biçimde İngilizce bırakılmış açıklayıcı sergi, etkinlik, belgesel veya program adı varsa Türkçeleştir.',
          '“demonstrasyon bölgesi” gibi kelime kelime kurum/idarî terim çevirilerini doğal Türkçeyle yeniden kur. Açıklanmamış Pinyin veya yabancı teknik terimi ya Türkçeleştir ya da aynı cümlede kısa biçimde açıkla.',
          'Haber değerine göre 3-7 kısa paragraf, doğal bir başlık ve tek cümlelik spot üret. Küçük haberi sırf uzunluk hedefi için şişirme.',
          'Yanıtlamadan önce sessiz editör kontrolü yap: başlığı tek okumada anlaşılırlık, somutluk, Türkçe doğallık ve haber ritmi açısından denetle. Yer adı + isim listesi, çeviri kokusu veya takvim başlığı hissi veriyorsa daha güçlü bir haber açısıyla yeniden kur. Ardından her paragraf için “Bir Türk gazeteci bunu gerçekten böyle yazar mı?” ve “Cümlenin yabancı dilden çevrildiği hissediliyor mu?” testlerini uygula; evetse o cümleyi teslim etmeden önce yeniden kur.',
          'Kurum adlarını doğal Türkçeyle ver: National Art Museum of China = Çin Ulusal Sanat Müzesi. Çin eser/sergi adlarının İngilizce ara çevirisini parantezde tekrar etme; doğrulanmış Çince ad ve pinyin yoksa yalnız doğal Türkçe karşılığı kullan. Yeşim gibi malzemelerde kelime kelime teknik tamlama kurma; terimi kaynak anlamıyla kısa ve anlaşılır açıkla. Türkçe ifadeyi “Çincede ... olarak adlandırılıyor” diye tekrarlama. Nesneye “iz sürmek” gibi araştırmacı eylemi yükleme. Girişte idari yer adlarını yığma; ana gelişmeyi öne al. Sanat haberini protokol konuşmalarına boğma; kaynakta bulunan eser ve üretim ayrıntılarını öncele.',
          'Çin National Day tatili için Milli Bayram, Mid-Autumn Festival için Güz Ortası Bayramı kullan. Girişte kaynakla doğrulanmış gelişmeyi, yeri ve haber değerini somut bir fiille anlat; protokol listesini ve uzun kurum adlarını sonraya bırak. Soyut önem cümlesi yerine kaynaktaki eser, üretim veya olay ayrıntısını ver.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Kaynak başlığı: ${article.title}`,
          `Olgu fişi:\n${JSON.stringify(factSheet)}`,
          `Son okuma yapılacak taslak:\n${JSON.stringify({ title: draft.title, excerpt: draft.excerpt, paragraphs: draft.paragraphs, tags: draft.tags })}`,
          'JSON şeması: {"accepted":true,"issues":[],"title":"başlık","excerpt":"spot","paragraphs":["paragraf"],"tags":["etiket"]}'
        ].join('\n\n')
      }
    ]
  });
  return {
    accepted: result.accepted !== false,
    issues: (Array.isArray(result.issues) ? result.issues : [result.reason]).map(cleanString).filter(Boolean).slice(0, 8),
    draft: normalizeDraft(article, result)
  };
}

function assertUsableEditorialOutput(draft) {
  if (!draft.title || !draft.excerpt || draft.paragraphs.length < 3 || draft.text.length < 500) {
    throw new Error('Editoryal model eksik veya kullanılamaz bir haber yapısı döndürdü.');
  }
}

function elapsedSeconds(startedAt) {
  return Math.round((Date.now() - startedAt) / 100) / 10;
}

function editorialIssues(draft, factSheet) {
  const issues = translationIssues(draft, factSheet);
  const fluency = editorialFluencyProfile(draft);
  if (fluency.score < 86) {
    const repeated = fluency.repeatedAbstractWords.map((item) => `${item.word}(${item.count})`).join(', ');
    issues.push([
      `Türkçe doğallık puanı düşük (${fluency.score}/100).`,
      fluency.translationeseHits ? `${fluency.translationeseHits} çeviri kalıbını somut ve fiilli Türkçeyle yeniden kur.` : '',
      repeated ? `Tekrarlanan soyut sözcükleri azalt: ${repeated}.` : ''
    ].filter(Boolean).join(' '));
  }
  return issues;
}

function editorialStructureIssues(draft) {
  const paragraphs = draft.paragraphs ?? [];
  const lead = String(paragraphs[0] ?? '').trim();
  const issues = [];
  if (lead.length < 110 || lead.length > 700) {
    issues.push('Giriş paragrafı haber değerini açık anlatacak uzunlukta, ancak gereksiz ayrıntısız yeniden kurulmalı.');
  }
  if (/^(?:Bu (?:dönem|süreç|etkinlik|gelişme)|Söz konusu (?:etkinlik|çalışma)|Öte yandan|Ayrıca|Bunun yanı sıra)\\b/iu.test(lead)) {
    issues.push('Giriş bağlamı bilinmeyen bir işaret zamiri veya geçiş kalıbıyla başlıyor; esas gelişmeyi doğrudan anlat.');
  }
  if (paragraphs.length >= 4 && paragraphs.slice(0, 2).every(p => /^.{0,55}(?:,|\\.)/u.test(p) && !/[.!?]/u.test(p.slice(0, 65)))) {
    // Avoid treating a purely locational lead as the complete news angle.
    issues.push('İlk iki paragrafı tekil yer ve faaliyet dökümü yerine haberin ortak teması etrafında yeniden kur.');
  }
  return issues;
}

function instagramCategoryEmoji(category) {
  return {
    'kultur-sanat': '🎨',
    'sinema': '🎬',
    'moda-tasarim': '✨',
    'sehir-yasam': '🏙️',
    'editorden': '✍️'
  }[category] ?? '🔎';
}

function normalizeInstagramText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fallbackInstagramCaption(article, draft) {
  const emoji = instagramCategoryEmoji(article.category);
  const detailEmoji = {
    'kultur-sanat': ['🖼️', '🏛️', '🔎'],
    'sinema': ['🎞️', '🎥', '🔎'],
    'moda-tasarim': ['👗', '🧵', '🔎'],
    'sehir-yasam': ['🌿', '🏙️', '🔎'],
    'editorden': ['📝', '💬', '🔎']
  }[article.category] ?? ['📌', '🔎', '✨'];
  const details = draft.paragraphs
    .slice(0, 3)
    .map((paragraph, index) => {
      const firstSentence = String(paragraph).split(/(?<=[.!?…])\s+/u)[0].trim();
      return firstSentence ? `${detailEmoji[index] ?? '🔹'} ${firstSentence}` : '';
    })
    .filter(Boolean);
  const tags = [...new Set(['SanatÇin', ...(draft.tags ?? [])])]
    .map((tag) => String(tag).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
    .slice(0, 6)
    .map((tag) => `#${tag}`)
    .join(' ');

  return normalizeInstagramText([
    `${emoji} ${draft.title}`,
    '',
    `📍 ${draft.excerpt}`,
    '',
    ...details,
    '',
    '👉 Haberin tamamı SanatÇin’de.',
    '',
    tags
  ].join('\n'));
}

async function buildInstagramCaption(article, factSheet, draft, { signal, completeJson = requestJson } = {}) {
  try {
    const result = await completeJson({
      model: config.openaiEditorModel,
      signal,
      input: [
        {
          role: 'system',
          content: [
            'SanatÇin için Instagram gönderi metni yazan deneyimli bir sosyal medya editörüsün.',
            'Yalnız verilen doğrulanmış haber ve olgu fişini kullan; yeni bilgi, yorum, abartı veya çıkarım ekleme.',
            'Metin Türkiye Türkçesinde doğal, sıcak ama haber ciddiyetini koruyan bir tonda olsun.',
            'Hedef uzunluk 500-900 karakterdir; gerektiğinde 1.100 karaktere kadar çıkabilirsin.',
            'İlk satır güçlü ve anlaşılır bir başlık/hook olsun ve uygun tek bir emojiyle başlasın.',
            'Ardından bir kısa açıklama paragrafı yaz.',
            'Haberde gerçekten bulunan 3-5 önemli ayrıntıyı, her satırın başında bağlama uygun bir emoji olacak şekilde ayrı satırlarda ver.',
            'Sonra haberi bağlayan tek kısa cümle yaz ve ayrı satırda tam olarak “👉 Haberin tamamı SanatÇin’de.” ifadesini kullan.',
            'En sonda 4-7 özgün hashtag ver. #SanatÇin zorunludur. Aynı etiketi tekrarlama; ilgisiz popüler etiket ekleme.',
            'Toplam 5-8 emoji hedefle. Emoji yığını, markdown, yıldızla kalın yazı, URL veya uydurma alıntı kullanma.',
            'Yalnız geçerli JSON ver.'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            `Kategori: ${article.category}`,
            `Başlık: ${draft.title}`,
            `Spot: ${draft.excerpt}`,
            `Haber metni:\n${draft.paragraphs.join('\n\n')}`,
            `Olgu fişi:\n${JSON.stringify(factSheet)}`,
            `Mevcut etiketler: ${JSON.stringify(draft.tags ?? [])}`,
            'JSON şeması: {"text":"satır sonları korunmuş Instagram metni"}'
          ].join('\n\n')
        }
      ]
    });
    const text = normalizeInstagramText(result.text);
    const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    if (!text || text.length < 350 || text.length > 1400 || !/Haberin tamamı SanatÇin’de\./u.test(text) || !/#SanatÇin/u.test(text) || emojiCount < 3) {
      throw new Error('Instagram metni biçim kapısından geçmedi.');
    }
    return text;
  } catch (error) {
    log('warn', 'Instagram metni AI ile hazırlanamadı; güvenli uzun yerel şablon kullanılacak', {
      source: article.source.id,
      error: String(error?.message ?? error).slice(0, 280)
    });
    return fallbackInstagramCaption(article, draft);
  }
}

export async function translateArticle(article, { signal, completeJson = requestJson, validateDraft } = {}) {
  const startedAt = Date.now();
  log('info', 'Türkçe haber hazırlığı başladı', { source: article.source.id, url: article.url });

  const factSheet = await extractFactSheet(article, signal, completeJson);
  if (!factSheet.publishable || !factSheet.angle || !factSheet.newsValue || factSheet.facts.length < 4) {
    throw new Error('Kaynak metin güncel ve olgusal bir haber yazmak için yeterli değil.');
  }
  log('info', 'Olgu fişi hazırlandı', {
    source: article.source.id,
    facts: factSheet.facts.length,
    elapsedSeconds: elapsedSeconds(startedAt)
  });

  let final = await writeTurkishNews(article, factSheet, { signal, completeJson });
  if (!final.accepted) {
    throw new Error(`Editoryal doğrulama başarısız: ${final.issues.join(' ') || 'yetersiz kaynak veya giderilemeyen olgu çelişkisi'}`);
  }
  assertUsableEditorialOutput(final.draft);
  log('info', 'Türkçe haber sıfırdan yazıldı', {
    source: article.source.id,
    title: final.draft.title,
    elapsedSeconds: elapsedSeconds(startedAt)
  });

  // Reject before repair/polish/headline calls; keep the final guard too.
  if (validateDraft) await validateDraft(final.draft);

  let mechanicalIssues = editorialIssues(final.draft, factSheet);
  if (mechanicalIssues.length) {
    log('warn', 'Son taslakta mekanik sorun bulundu; tek düzeltme uygulanacak', {
      source: article.source.id,
      issues: mechanicalIssues
    });
    final = await writeTurkishNews(article, factSheet, {
      draft: final.draft,
      feedback: mechanicalIssues,
      signal,
      completeJson
    });
    mechanicalIssues = editorialIssues(final.draft, factSheet);
  }

  if (!final.accepted) {
    throw new Error(`Editoryal doğrulama başarısız: ${final.issues.join(' ') || 'gerekçe belirtilmedi'}`);
  }

  // Son Türkçe editör geçişi yayın hattının ana doğallık adayıdır.
  // Akıcı sürümde güvenlik sorunu görülürse eski metne hemen dönmek yerine
  // aynı akıcı sürüm üzerinde olgu/biçim onarımı yapılır.
  const prePolish = final;
  const prePolishIssues = editorialIssues(prePolish.draft, factSheet);
  const prePolishFluency = editorialFluencyProfile(prePolish.draft);
  try {
    const polished = await polishTurkishNews(article, factSheet, prePolish.draft, { signal, completeJson });
    if (polished.accepted) {
      assertUsableEditorialOutput(polished.draft);
      let candidateDraft = polished.draft;

      // Gövde ve spot daha iyi ise yalnız zayıflayan başlık yüzünden tüm yeniden yazımı kaybetme.
      if (headlineQualityRegression(prePolish.draft.title, candidateDraft.title)) {
        candidateDraft = { ...candidateDraft, title: prePolish.draft.title };
        log('info', 'Türkçe son okumada gövde korundu; gerileyen başlık önceki sürümden alındı', {
          source: article.source.id,
          restoredTitle: prePolish.draft.title
        });
      }

      let candidateIssues = editorialIssues(candidateDraft, factSheet);
      let factRegression = numericFactRegression(prePolish.draft, candidateDraft);
      let namingRegression = nativeNameRegression(prePolish.draft, candidateDraft, factSheet.nativeNames);
      const addedIssues = candidateIssues.filter((issue) => !prePolishIssues.includes(issue));
      const repairFeedback = [
        factRegression ? 'Akıcı sürümde ilk taslaktaki doğrulanmış sayı veya tarih bilgilerinden biri kaybolmuş. Eski metnin cümle yapısına dönmeden eksik doğrulanmış bilgiyi akıcı sürüme geri ekle.' : '',
        namingRegression ? 'Akıcı sürümde doğrulanmış özgün ad veya adlandırma bilgisi kaybolmuş. Akıcı Türkçeyi koruyarak doğru adı geri getir.' : '',
        ...addedIssues,
        'Bu onarımda akıcı sürümün Türkçe cümle yapısını ve haber ritmini koru; eski taslağın çeviri kokan söz dizimine dönme. Yalnız doğrulanmış olguları ve gerekli biçim kurallarını onar.'
      ].filter(Boolean);

      if (factRegression || namingRegression || addedIssues.length) {
        log('info', 'Akıcı Türkçe sürüm güvenlik/biçim onarımına alındı', {
          source: article.source.id,
          factRegression,
          namingRegression,
          addedIssues
        });
        try {
          const repaired = await writeTurkishNews(article, factSheet, {
            draft: candidateDraft,
            feedback: repairFeedback,
            signal,
            completeJson
          });
          if (repaired.accepted) {
            assertUsableEditorialOutput(repaired.draft);
            candidateDraft = repaired.draft;
            candidateIssues = editorialIssues(candidateDraft, factSheet);
            factRegression = numericFactRegression(prePolish.draft, candidateDraft);
            namingRegression = nativeNameRegression(prePolish.draft, candidateDraft, factSheet.nativeNames);
          }
        } catch (repairError) {
          log('warn', 'Akıcı Türkçe sürüm onarımı tamamlanamadı', {
            source: article.source.id,
            error: String(repairError?.message ?? repairError).slice(0, 400)
          });
        }
      }

      const changed = editorialDraftChanged(prePolish.draft, candidateDraft);
      const candidateFluency = editorialFluencyProfile(candidateDraft);
      const hardSafe = !factRegression && !namingRegression;
      let naturalnessDecision = {
        preferred: changed ? 'A' : 'B',
        reason: changed ? 'hakem çalıştırılmadı' : 'metin değişmedi'
      };

      if (hardSafe && changed) {
        try {
          naturalnessDecision = await chooseMoreNaturalDraft(
            article,
            factSheet,
            prePolish.draft,
            candidateDraft,
            { signal, completeJson }
          );
        } catch (judgeError) {
          naturalnessDecision = {
            preferred: 'A',
            reason: `Akıcılık hakemi tamamlanamadı: ${String(judgeError?.message ?? judgeError).slice(0, 180)}`
          };
        }
      }

      // Hakem yalnız olgu/kapsam gerekçesiyle A'yı seçerse B'yi çöpe atmak yerine
      // B üzerinde bir kez daha hedefli onarım yap ve yeniden değerlendir.
      if (hardSafe && changed && naturalnessDecision.preferred === 'A') {
        try {
          const judgeRepair = await writeTurkishNews(article, factSheet, {
            draft: candidateDraft,
            feedback: [
              `Akıcılık hakemi şu nedenle eski sürümü tercih etti: ${naturalnessDecision.reason}`,
              'Eski sürümün yabancı dilden çevrilmiş hissi veren cümle yapısına dönme. Mevcut akıcı sürümü koru; hakemin işaret ettiği doğrulanmış olgu, kapsam veya ana fikir eksikliğini olgu fişinden tamamla. Yeni bilgi ekleme.'
            ],
            signal,
            completeJson
          });
          if (judgeRepair.accepted) {
            assertUsableEditorialOutput(judgeRepair.draft);
            const repairedFactRegression = numericFactRegression(prePolish.draft, judgeRepair.draft);
            const repairedNamingRegression = nativeNameRegression(prePolish.draft, judgeRepair.draft, factSheet.nativeNames);
            if (!repairedFactRegression && !repairedNamingRegression) {
              const repairedDecision = await chooseMoreNaturalDraft(
                article,
                factSheet,
                prePolish.draft,
                judgeRepair.draft,
                { signal, completeJson }
              );
              if (repairedDecision.preferred === 'B') {
                candidateDraft = judgeRepair.draft;
                candidateIssues = editorialIssues(candidateDraft, factSheet);
                naturalnessDecision = repairedDecision;
              }
            }
          }
        } catch (repairError) {
          log('warn', 'Akıcılık hakemi sonrası hedefli onarım tamamlanamadı', {
            source: article.source.id,
            error: String(repairError?.message ?? repairError).slice(0, 400)
          });
        }
      }

      const acceptPolish = hardSafe && (!changed || naturalnessDecision.preferred === 'B');
      if (acceptPolish) {
        final = { ...polished, draft: candidateDraft };
        mechanicalIssues = candidateIssues;
        log('info', 'Türkçe son okuma tamamlandı', {
          source: article.source.id,
          title: final.draft.title,
          beforeFluency: prePolishFluency,
          afterFluency: editorialFluencyProfile(final.draft),
          naturalnessDecision,
          elapsedSeconds: elapsedSeconds(startedAt)
        });
      } else {
        log('warn', 'Türkçe son okuma güvenlik veya editör hakemi nedeniyle önceki taslağa döndü', {
          source: article.source.id,
          beforeIssues: prePolishIssues,
          afterIssues: candidateIssues,
          beforeTitle: prePolish.draft.title,
          afterTitle: candidateDraft.title,
          namingRegression,
          factRegression,
          beforeFluency: prePolishFluency,
          afterFluency: candidateFluency,
          naturalnessDecision
        });
      }
    }
  } catch (error) {
    log('warn', 'Türkçe son okuma tamamlanamadı; doğrulanmış önceki taslakla devam edilecek', {
      source: article.source.id,
      error: String(error?.message ?? error).slice(0, 500)
    });
  }

  if (mechanicalIssues.length) {
    let blockingIssues = mechanicalIssues.filter((issue) => /Çince karakterler|doğrulanmış yerel ad|kaynak-site artığı|yinelenen cümle/iu.test(issue));
    if (blockingIssues.length) {
      log('warn', 'Yayın engelleyici dil/adlandırma sorunu için özel onarım turu başlatıldı', {
        source: article.source.id,
        issues: blockingIssues
      });
      try {
        const repaired = await writeTurkishNews(article, factSheet, {
          draft: final.draft,
          feedback: [
            ...blockingIssues,
            'Bu özel onarım turunda yeni bilgi ekleme. Açıklanmamış ham Pinyin veya romanize kurum/yer zincirini doğal Türkçe karşılıkla düzelt; doğrulanmış özgün eser adlarını ise Türkçe karşılık + (“中文”, Pinyin) kuralına göre koru.'
          ],
          signal,
          completeJson
        });
        if (repaired.accepted) {
          assertUsableEditorialOutput(repaired.draft);
          final = repaired;
          mechanicalIssues = editorialIssues(final.draft, factSheet);
          blockingIssues = mechanicalIssues.filter((issue) => /Çince karakterler|doğrulanmış yerel ad|kaynak-site artığı|yinelenen cümle/iu.test(issue));
          log(blockingIssues.length ? 'warn' : 'info', 'Özel dil/adlandırma onarım turu tamamlandı', {
            source: article.source.id,
            remainingBlockingIssues: blockingIssues
          });
        }
      } catch (repairError) {
        log('warn', 'Özel dil/adlandırma onarımı tamamlanamadı', {
          source: article.source.id,
          error: String(repairError?.message ?? repairError).slice(0, 400)
        });
      }
      if (blockingIssues.length) {
        throw new Error(`Yayın engellendi: ${blockingIssues.join(' ')}`);
      }
    }
    if (mechanicalIssues.length) {
      log('warn', 'Son metinde kalan ikincil dil/biçim notları yayını engellemeyecek', {
        source: article.source.id,
        issues: mechanicalIssues
      });
    }
  }

  try {
    const headline = await refineHeadline(article, factSheet, final.draft, { signal, completeJson });
    if (headline.changed) {
      let decision = { preferred: 'A', reason: 'Bağımsız başlık hakemi çalıştırılamadı; mevcut başlık korundu.' };
      try {
        decision = await chooseMoreNaturalDraft(article, factSheet, final.draft, headline.draft, { signal, completeJson });
      } catch (headlineJudgeError) {
        log('warn', 'Başlık önerisi bağımsız hakem tarafından değerlendirilemedi; mevcut başlık korunacak', {
          source: article.source.id,
          error: String(headlineJudgeError?.message ?? headlineJudgeError).slice(0, 300)
        });
      }
      if (decision.preferred === 'B') {
        final = { ...final, draft: headline.draft };
        log('info', 'Başlık mikro-editör turunda güçlendirildi', {
          source: article.source.id,
          title: final.draft.title,
          reason: headline.reason,
          judgeReason: decision.reason
        });
      } else {
        log('info', 'Başlık mikro-editör önerisi hakem tarafından reddedildi; mevcut başlık korundu', {
          source: article.source.id,
          currentTitle: final.draft.title,
          proposedTitle: headline.draft.title,
          reason: decision.reason
        });
      }
    }
  } catch (headlineError) {
    log('warn', 'Başlık mikro-editörü tamamlanamadı; doğrulanmış mevcut başlık korunacak', {
      source: article.source.id,
      error: String(headlineError?.message ?? headlineError).slice(0, 350)
    });
  }

  // Final publication gate: one focused rewrite, then fail closed.
  // A failed candidate is left unpublished by the caller; the daily discovery pipeline continues.
  let structureIssues = editorialStructureIssues(final.draft);
  let fluencyBeforeGate = editorialFluencyProfile(final.draft);
  if (structureIssues.length || fluencyBeforeGate.score < 86) {
    const baseline = final.draft;
    try {
      const revision = await writeTurkishNews(article, factSheet, {
        draft: baseline,
        feedback: [
          ...structureIssues,
          ...(fluencyBeforeGate.score < 86 ? ['Metnin Türkiye Türkçesi doğallığını artır, soyut klişeleri ve kopuk paragraf sıralamasını düzelt.'] : []),
          'Haberin en önemli gelişmesini ilk iki cümlede ver; paragraf planını bağımsız Türkçe haber metni olarak yeniden kur.',
          'Kaynak fişi dışından bilgi ekleme, hiçbir sayıyı veya özgün adı değiştirme.'
        ],
        signal,
        completeJson
      });
      if (revision.accepted) {
        assertUsableEditorialOutput(revision.draft);
        if (!numericFactRegression(baseline, revision.draft)
            && !nativeNameRegression(baseline, revision.draft, factSheet.nativeNames)
            && !editorialIssues(revision.draft, factSheet).some(issue => /Çince karakterler|doğrulanmış yerel ad|kaynak-site artığı|yinelenen cümle/iu.test(issue))) {
          final = revision;
        }
      }
    } catch (error) {
      log('warn', 'Son yapı düzeltmesi başarısız', {
        source: article.source.id,
        error: String(error?.message ?? error).slice(0, 350)
      });
    }
    structureIssues = editorialStructureIssues(final.draft);
    fluencyBeforeGate = editorialFluencyProfile(final.draft);
  }
  if (structureIssues.length || fluencyBeforeGate.score < 82) {
    throw new Error('Editoryal yayın kapısı: giriş, haber bütünlüğü veya Türkçe doğallığı yetersiz. ' + structureIssues.join(' '));
  }

  assertUsableEditorialOutput(final.draft);
  const instagramText = await buildInstagramCaption(article, factSheet, final.draft, { signal, completeJson });
  log('info', 'Türkçe haber yayıma hazır', {
    source: article.source.id,
    title: final.draft.title,
    fluency: editorialFluencyProfile(final.draft),
    instagramChars: instagramText.length,
    elapsedSeconds: elapsedSeconds(startedAt)
  });
  // v18: haberin doğrulanmış son Türkçe sürümünden Instagram için ayrı,
  // uzun ve emojili bir sosyal medya metni hazırlanır; haber üretimi sosyal metin
  // hatası yüzünden kesilmez ve yerel şablona güvenli geri dönüş yapılır.
  return {
    ...final.draft,
    factSheet,
    instagramText,
    editorialMode: 'fact-ledger-turkish-newsroom-v18-instagram-editorial'
  };
}
