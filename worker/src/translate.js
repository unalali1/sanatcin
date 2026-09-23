import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './logger.js';
import {
  editorialDraftChanged,
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
  return String(value ?? '')
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
          'Türkçede yerleşik karşılığı bulunmayan Çince eser, dizi, film, program, sergi, sanat akımı veya kültürel kavram adlarında doğal Türkçe karşılığı metnin ana adı yap. Özgün Çince ad ve pinyin olgu fişindeki nativeNames alanında verified=true olarak bulunuyorsa ilk kullanımda kısa editoryal biçimi uygula: Doğal Türkçe Karşılık (“中文名称”, Pinyin). Türkçe karşılık kelime kelime olmak zorunda değildir; anlamı, çağrışımı ve varsa kelime oyununu mümkün olduğunca korumalıdır. İlk kullanımdan sonra yalnız doğal Türkçe karşılığı kullan. Kaynakta verilen İngilizce ad, ancak uluslararası yerleşik ad veya eseri bulmayı kolaylaştıran ayırt edici bilgi ise ilk kullanımda ayrıca tırnak içinde ver; İngilizce adı Türkçe metnin ana adı yapma. Özgün Çince ad kaynakta yoksa tahmin etme veya uydurma; bu durumda doğal Türkçe karşılığı esas al ve gerekirse kaynakta verilen İngilizce adı ilk kullanımda parantez içinde belirt.',
          'Kişi, kurum ve marka adlarını eksiksiz koru; Lu ya da Liu gibi kısaltmalar yapma. Sayıları, tarihleri ve alıntı anlamlarını değiştirme. Eser ve etkinlik adlarında anlamı, sayıları ve ayırt edici unsurları koru; açıklayıcı yabancı adları Türkçede doğal okunacak biçimde aktar.',
          '“Ambassador”, “envoy”, “representative” gibi unvanları bağlamına göre çevir; marka elçisini veya moda haftası temsilcisini diplomatik büyükelçi gibi gösterme.',
          'Ay ve gün içeren geçmiş/gelecek olaylarda yıl belirsizliği doğuracaksa kaynakta bulunan yılı Türkçe metne ekle. Haberin yayımlandığı tarihe göre “kasım ayında” gibi ifadelerin yanlış zaman algısı yaratmasına izin verme.',
          'Kaynakta geçen her ayrıntıyı kullanmak zorunda değilsin; anlamı bozmayan özetleme, sadeleştirme ve seçme olgu hatası değildir.',
          'Çin’deki Mid-Autumn Festival için Türkçede “Güz Ortası Bayramı” karşılığını kullan; “Orta Sonbahar Bayramı” veya “Orta Sonbahar Festivali” yazma.',
          'Başlığı somutlaştır; spot, başlık ve giriş tekrarlarını gider. Kaynak başlığını tercüme etme: haberi yalnız tarif eden başlık yerine, doğrulanmış olgular içinden hikâyenin ayırt edici yönünü görünür kılan doğal bir Türkçe başlık kur. Sayı, satıcı/katılımcı adedi veya kurum adı ancak gerçekten ana haber değeriyse başlığın merkezinde olsun. Zorunlu olmayan İngilizce sözcükleri, uzun yabancı etkinlik/sergi adlarını, yapay tamlamaları, açıklanmamış ham Pinyin zincirlerini ve propaganda dilini temizle. Doğrulanmış özgün Çince adın ardından parantez içinde verilen pinyin bu yasağın dışındadır. Okur İngilizce bilmeden metni anlayabilmeli.',
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
        model: config.openaiSelectionModel,
        signal: judgeSignal,
        input: [
          {
            role: 'system',
            content: [
              'Türkiye Türkçesiyle çalışan tarafsız bir haber dili hakemisin.',
              'İki metin aynı doğrulanmış olgulara dayanıyor. Yalnız dil doğallığı, açıklık, haber ritmi, somut fiil kullanımı ve çeviri kokusunun yokluğu bakımından karşılaştır.',
              'Bilgi ekleyen, sayı/ad değiştiren, daha muğlaklaşan veya sırf farklı görünmek için cümleleri bozan sürümü seçme.',
              'B sürümünü yalnız açıkça daha iyi ise seç; eşitlikte veya kuşkuda A sürümünü koru.',
              'Yalnız geçerli JSON ver.'
            ].join(' ')
          },
          {
            role: 'user',
            content: [
              `Haber açısı: ${factSheet.angle}`,
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
          'Verilen haber için zihninde en az üç farklı başlık açısı üret: somut haber gelişmesi, kültürel/hikâyesel ayırt edici unsur ve varsa güçlü görsel/mekânsal unsur. Doğruluk, somutluk, merak, Türkçe doğallık ve haber ritmi bakımından en iyisini seç; yalnız seçtiğin başlığı JSON içinde döndür.',
          'Başlık kaynakta olmayan bilgi, sıfat, önem atfı veya neden-sonuç eklememeli.',
          'Türkiye’de bilinmeyen kurum, etkinlik veya teknik terimi açıklamasız biçimde başlığın merkezine koyma.',
          'Daha somut bir fiil veya daha güçlü bir haber açısı mümkünse “sunuyor”, “genişliyor”, “öne çıkıyor”, “buluşuyor”, “yer alıyor”, “aynı sahneyi paylaştı” gibi jenerik kalıplara yaslanma. Kaynaktaki sayı veya katılımcı adedi hikâyenin özü değilse sırf kolay olduğu için başlığı rakam üzerine kurma.',
          'Sayı veya sıra dışı ayrıntı ana haber değeriyse kullan; yalnız rakam var diye başlığı mekanikleştirme.',
          'Başlık yaklaşık 35-95 karakter arasında, tek okumada anlaşılır ve doğal Türkiye Türkçesiyle olmalı.',
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
          'Metin, ilk kez Türkçe yazılmış bir kültür-sanat haberi gibi okunmalı. Fiilleri doğal kullan; uzun tamlamaları böl; özne-yüklem ilişkisini Türkçe haber diline göre yeniden kur. Anlamı doğru fakat Türkçesi mekanik bir cümleyi yüzeysel sözcük değişiklikleriyle bırakma; gerekirse baştan yaz.',
          'Başlık, spot ve giriş aynı bilgiyi tekrar etmesin. Paragraflar arasında doğal akış kur. Kültür-sanat haberinde kaynakta bulunan somut mekân, eser, gelenek, malzeme veya performans ayrıntısını uygun olduğunda öne çıkar; fakat kaynakta olmayan atmosfer, yorum, sıfat veya duygu ekleme.',
          'Başlığı ayrıca bağımsız bir editör gibi yeniden değerlendir. Türkiye’de bilinmeyen etkinlik veya kurum adını açıklamasız biçimde başlığın merkezinde bırakma. Gerekirse özel adı gövdeye indir ve başlıkta etkinliğin ne olduğunu açık Türkçeyle söyle.',
          'Başlıkta somut haber değerini mümkün olduğunca görünür kıl; sayı, ödül, sıra dışı mekân, ilk olma veya tanınmış isim varsa ve gerçekten ana gelişmeyse kullan. Clickbait ve abartı yapma.',
          'Muğlak “Çin bağlantılı”, “öne çıkıyor”, “sahnede” gibi ifadeleri ancak gerçekten en doğru ifade buysa koru; aksi halde daha kesin özne-fiil ilişkisi kur.',
          'Çeviri yanlış anlaşılmasına açık meslek/unvanları bağlama göre düzelt. Marka elçisi ile diplomatik büyükelçiyi, küratör ile yönetici/temsilciyi birbirine karıştırma.',
          'Tarih ve zaman bağlamını denetle. Kaynakta yıl varsa ve “kasım ayında” gibi ifade okuyucuyu yanlış yıla götürebilecekse yılı açıkça yaz.',
          'Olgu fişindeki gerçekleri, kişi/kurum/marka adlarını, tarihleri, sayıları ve alıntı anlamlarını kesinlikle değiştirme. Eser, sergi, etkinlik, belgesel ve program adlarının anlamını koru; açıklayıcı yabancı adları doğal Türkçeye aktar. Kaynakta olmayan hiçbir bilgi ekleme.',
          'Çince eser, dizi, film, program, sergi, sanat akımı veya kültürel kavram adı için ilk taslakta doğal Türkçe karşılık + doğrulanmış özgün Çince ad + pinyin biçimi kullanılmışsa bunu koru. Tercih edilen ilk kullanım kalıbı: Doğal Türkçe Karşılık (“中文名称”, Pinyin). Sonraki kullanımlarda yalnız Türkçe karşılığı bırak. İngilizce adı ancak uluslararası tanınırlık veya bulunabilirlik için gerçekten yararlıysa ilk kullanımda tırnak içinde koru; metni yeniden İngilizce ad merkezli hale getirme. Kaynakta olmayan Çince adı asla uydurma.',
          'Mid-Autumn Festival terminolojisini denetle: Türkçe metinde yalnız “Güz Ortası Bayramı” kullan.',
          'Bir ifade zaten doğal Türkçeyse sırf değişiklik yapmak için değiştirme. Ama İngilizce veya Çince cümle iskeletini taşıyan ifadeleri yeniden kur. Metinde gereksiz biçimde İngilizce bırakılmış açıklayıcı sergi, etkinlik, belgesel veya program adı varsa Türkçeleştir.',
          '“demonstrasyon bölgesi” gibi kelime kelime kurum/idarî terim çevirilerini doğal Türkçeyle yeniden kur. Açıklanmamış Pinyin veya yabancı teknik terimi ya Türkçeleştir ya da aynı cümlede kısa biçimde açıkla.',
          'Haber değerine göre 3-7 kısa paragraf, doğal bir başlık ve tek cümlelik spot üret. Küçük haberi sırf uzunluk hedefi için şişirme.',
          'Yanıtlamadan önce sessiz editör kontrolü yap: başlığı tek okumada anlaşılırlık, somutluk, Türkçe doğallık ve haber ritmi açısından denetle. Yer adı + isim listesi, çeviri kokusu veya takvim başlığı hissi veriyorsa daha güçlü bir haber açısıyla yeniden kur. Ardından her paragraf için “Bir Türk gazeteci bunu gerçekten böyle yazar mı?” ve “Cümlenin yabancı dilden çevrildiği hissediliyor mu?” testlerini uygula; evetse o cümleyi teslim etmeden önce yeniden kur.',
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

export async function translateArticle(article, { signal, completeJson = requestJson } = {}) {
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

  // Son Türkçe editör geçişi kaliteyi artırır; ancak bu isteğin başarısız olması
  // çalışan sistemi durdurmaz. Daha önce doğrulanmış taslak güvenli fallback'tir.
  const prePolish = final;
  const prePolishIssues = editorialIssues(prePolish.draft, factSheet);
  const prePolishFluency = editorialFluencyProfile(prePolish.draft);
  try {
    const polished = await polishTurkishNews(article, factSheet, prePolish.draft, { signal, completeJson });
    if (polished.accepted) {
      assertUsableEditorialOutput(polished.draft);
      const polishedIssues = editorialIssues(polished.draft, factSheet);
      const headlineRegression = headlineQualityRegression(prePolish.draft.title, polished.draft.title);
      const namingRegression = nativeNameRegression(prePolish.draft, polished.draft, factSheet.nativeNames);
      const polishedFluency = editorialFluencyProfile(polished.draft);
      const changed = editorialDraftChanged(prePolish.draft, polished.draft);
      const mechanicallySafe = polishedIssues.length <= prePolishIssues.length && !headlineRegression && !namingRegression;
      let naturalnessDecision = { preferred: changed ? 'A' : 'B', reason: changed ? 'hakem çalıştırılmadı' : 'metin değişmedi' };
      if (mechanicallySafe && changed && polishedFluency.score >= prePolishFluency.score - 3) {
        try {
          naturalnessDecision = await chooseMoreNaturalDraft(article, factSheet, prePolish.draft, polished.draft, { signal, completeJson });
        } catch (judgeError) {
          naturalnessDecision = { preferred: 'A', reason: `Akıcılık hakemi tamamlanamadı: ${String(judgeError?.message ?? judgeError).slice(0, 180)}` };
        }
      }
      const acceptPolish = mechanicallySafe && (!changed || naturalnessDecision.preferred === 'B');
      if (acceptPolish) {
        final = polished;
        mechanicalIssues = polishedIssues;
        log('info', 'Türkçe son okuma tamamlandı', {
          source: article.source.id,
          title: final.draft.title,
          beforeFluency: prePolishFluency,
          afterFluency: polishedFluency,
          naturalnessDecision,
          elapsedSeconds: elapsedSeconds(startedAt)
        });
      } else {
        log('warn', headlineRegression
          ? 'Türkçe son okuma başlık kalitesini düşürdü; önceki taslak korundu'
          : 'Türkçe son okuma mekanik kaliteyi düşürdü; önceki taslak korundu', {
          source: article.source.id,
          beforeIssues: prePolishIssues,
          afterIssues: polishedIssues,
          beforeTitle: prePolish.draft.title,
          afterTitle: polished.draft.title,
          headlineRegression,
          namingRegression,
          beforeFluency: prePolishFluency,
          afterFluency: polishedFluency,
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
    let blockingIssues = mechanicalIssues.filter((issue) => /Çince karakterler|Pinyin|doğrulanmış yerel ad|kaynak-site artığı|yinelenen cümle/iu.test(issue));
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
          blockingIssues = mechanicalIssues.filter((issue) => /Çince karakterler|Pinyin|doğrulanmış yerel ad|kaynak-site artığı|yinelenen cümle/iu.test(issue));
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
      final = { ...final, draft: headline.draft };
      log('info', 'Başlık mikro-editör turunda güçlendirildi', {
        source: article.source.id,
        title: final.draft.title,
        reason: headline.reason
      });
    }
  } catch (headlineError) {
    log('warn', 'Başlık mikro-editörü tamamlanamadı; doğrulanmış mevcut başlık korunacak', {
      source: article.source.id,
      error: String(headlineError?.message ?? headlineError).slice(0, 350)
    });
  }

  assertUsableEditorialOutput(final.draft);
  log('info', 'Türkçe haber yayıma hazır', {
    source: article.source.id,
    title: final.draft.title,
    fluency: editorialFluencyProfile(final.draft),
    elapsedSeconds: elapsedSeconds(startedAt)
  });
  // v14: kaynak yalnız haber hammaddesidir; yazım ve son okuma Türk okur için hikâye açısını, doğal sözdizimini ve başlığı yeniden kurar.
  // Bu prompt korumaları translate ve quality-efficiency regresyon testleriyle sabitlenir.
  return { ...final.draft, factSheet, editorialMode: 'fact-ledger-turkish-newsroom-v14-native-story-angle' };
}
