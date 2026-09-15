import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './logger.js';
import { translationIssues } from './quality.js';

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
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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
  return {
    publishable: sheet.publishable === true,
    sourceType: cleanString(sheet.sourceType),
    newsValue: cleanString(sheet.newsValue),
    angle: cleanString(sheet.angle),
    facts: list(sheet.facts, 30),
    people: list(sheet.people),
    organisations: list(sheet.organisations),
    places: list(sheet.places),
    numbers: list(sheet.numbers),
    quotes: (Array.isArray(sheet.quotes) ? sheet.quotes : [])
      .map((quote) => ({ speaker: cleanString(quote?.speaker), text: cleanString(quote?.text) }))
      .filter((quote) => quote.text)
      .slice(0, 8),
    context: list(sheet.context, 15)
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
          'Alıntıları konuşanı ve ihtiyat düzeyiyle birlikte kaydet. Kaynakta olmayan yorum, neden-sonuç, duygu, sıfat veya arka plan ekleme.',
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
          'JSON şeması: {"factSheet":{"publishable":true,"sourceType":"article|interview|review|announcement|gallery","newsValue":"somut haber değeri","angle":"somut gelişme","facts":["doğrulanmış olgu"],"people":["tam kişi adı"],"organisations":["kurum"],"places":["yer"],"numbers":["sayı veya tarih"],"quotes":[{"speaker":"konuşan","text":"kaynak dilindeki kısa alıntı"}],"context":["kaynakta bulunan bağlam"]}}'
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
          repairing
            ? 'Verilen Türkçe metindeki denetim notlarını gider; metni kaynak ve olgu fişine bağlı kalarak yeniden düzenle.'
            : 'Kaynak metni cümle cümle çevirmeden, özgün kaynak ile olgu fişini okuyup Türkçe haberi sıfırdan yaz.',
          'Olgu fişi doğruluk sınırıdır, paragraf planı değildir. Haber örgüsünü Türkçe gazetecilikteki önem sırasına göre kur.',
          'İlk paragraf kim-ne-nerede-ne zaman sorularından kaynakta yanıtı bulunanları doğal biçimde vermeli. Sonraki paragraflar önem, ayrıntı ve bağlam sırasıyla ilerlemeli.',
          'Kısa, açık ve çoğunlukla etkin cümleler kullan. Kaynak dilin sözdizimini, zincirleme tamlamalarını, tanıtım tonunu ve kelime kelime çeviri kokusunu taşıma.',
          'İngilizcedeki isimleştirmeleri Türkçeye aynen aktarma. “karakterlerin gelişimi”, “mesleklerinin ilk yılları”, “iş birliğinin ilerletilmesi” gibi yapıları gerektiğinde fiilli ve doğal Türkçe cümlelere dönüştür.',
          'Kaynak metnin cümle ve paragraf sırasını körü körüne izleme. Türkçe bir editör aynı olguları hangi sırayla ve hangi fiillerle yazardıysa o şekilde yeniden kur.',
          'Paragrafları birbirinden kopuk özet maddeleri gibi kurma. Her paragraf bir öncekinin bıraktığı bilgiye doğal biçimde bağlansın; yapay geçiş kalıpları ve aynı ritimde yinelenen cümlelerden kaçın.',
          'Bir kişi veya kurumun biyografisindeki her ayrıntıyı taşımak zorunda değilsin. Haberin ana gelişmesi için gerekli olmayan eğitim, görev ve kurum listelerini kısalt; metni özgeçmiş dökümüne dönüştürme.',
          '“Dikkat çekiyor”, “öne çıkıyor”, “gözler önüne seriyor”, “önemli bir adım” ve “büyük ilgi gördü” gibi hazır ifadeleri ancak kaynakta somut dayanağı varsa kullan.',
          'Kurum açıklamalarındaki övgü ve iddiaları haberin kendi hükmü gibi yazma; söyleyeni açıkça belirt. Kaynaktaki neden-sonuç ilişkisini güçlendirme veya yeni bir önem atfetme.',
          'Türkiye Türkçesinde yerleşik karşılığı olan şehir ve kavramları Türkçeleştir; Pekin ve Şanghay yazımlarını kullan. Yerleşik karşılığı olmayan eser ve etkinlik adlarını uydurma biçimde çevirmeden özgün adıyla koru ve gerektiğinde gövdede kısa Türkçe açıklama ekle.',
          'Özel adları eksiksiz koru; Lu ya da Liu gibi kısaltmalar yapma. Sayıları, tarihleri, eser/etkinlik adlarını ve alıntı anlamlarını değiştirme.',
          '“Ambassador”, “envoy”, “representative” gibi unvanları bağlamına göre çevir; marka elçisini veya moda haftası temsilcisini diplomatik büyükelçi gibi gösterme.',
          'Ay ve gün içeren geçmiş/gelecek olaylarda yıl belirsizliği doğuracaksa kaynakta bulunan yılı Türkçe metne ekle. Haberin yayımlandığı tarihe göre “kasım ayında” gibi ifadelerin yanlış zaman algısı yaratmasına izin verme.',
          'Kaynakta geçen her ayrıntıyı kullanmak zorunda değilsin; anlamı bozmayan özetleme, sadeleştirme ve seçme olgu hatası değildir.',
          'Başlığı somutlaştır; spot, başlık ve giriş tekrarlarını gider. Zorunlu olmayan İngilizce sözcükleri, yapay tamlamaları, ham Pinyin zincirlerini ve propaganda dilini temizle.',
          'Başlık Türkiye’deki okuyucunun dış bağlam bilmeden tek okumada anlayacağı kadar açıklayıcı olmalı. Türkiye’de geniş ölçüde bilinmeyen bir etkinlik, program, kurum veya marka adını tek başına başlığın merkezine koyma; önce bunun ne olduğunu Türkçe olarak anlat.',
          'Başlıkta mümkünse haberin en ayırt edici somut unsurunu öne çıkar: önemli ödül, sıra dışı mekân, güçlü sayı, ilk olma, tanınmış isim veya özgün kültürel gelişme. Clickbait yapma ve kaynakta olmayan üstünlük ekleme.',
          '“Çin bağlantılı”, “sahnede”, “buluştu”, “görücüye çıktı” gibi muğlak/kalıp ifadeler yerine kaynak izin veriyorsa daha kesin özne ve fiil kullan.',
          'Başlık doğal ve somut bir Türkçe cümle olsun; kaynak başlığı kopyalanmasın. 32-82 karakter kullan, mümkünse 45-75 karakterde kal.',
          'Spot başlığı tekrarlamayan, haberin önemini açıklayan tek cümle olsun; 105-180 karakter kullan, mümkünse 115-165 karakterde kal.',
          'Haber değerine göre 3-7 kısa paragraf üret. Küçük bir atama veya sergi haberini gereksiz ayrıntıyla uzatma; güçlü trend ve dosya haberinde gerekli bağlamı koru. Gövde en az 600 karakter olmalı ve Çince karakter içermemeli.',
          'Kaynakta olmayan bilgi, alıntı, yorum veya kesinlik ekleme. Doğrulanamayan bir boşluğu tahminle doldurma.',
          'Düzeltilebilir dil, uzunluk veya biçim sorunu gördüğünde reddetme; metni düzelt ve accepted=true ver.',
          'Yalnız kaynak haber yazmaya gerçekten yetmiyorsa, önemli bir olgu çelişkisi giderilemiyorsa veya güvenilir metin kaynak dışı bilgi eklemeden kurulamıyorsa accepted=false ver.',
          'Yanıtlamadan önce başlığı sessizce şu üç soruyla kontrol et: Türk okur başlığı anlıyor mu, haberin ayırt edici unsurunu görüyor mu, başlık kaynak dilden çevrilmiş gibi mi duruyor? Sorun varsa başlığı yeniden yaz.',
          'Yalnız geçerli JSON ver.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          `Kaynak başlığı: ${article.title}`,
          `Önerilen kategori: ${article.category}`,
          `Kaynak metin:\n${sourceExcerpt(article.text, 16_000)}`,
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

async function polishTurkishNews(article, factSheet, draft, { signal, completeJson = requestJson } = {}) {
  const result = await completeJson({
    model: config.openaiEditorModel,
    signal,
    input: [
      {
        role: 'system',
        content: [
          'Sen kaynak dilden çeviri yapan biri değil, Türkçe bir haber merkezinin son okuma ve başlık editörüsün.',
          'Görevin verilen taslağı yeniden çevirmek değil; metindeki çeviri kokusunu, yabancı sözdizimini, gereksiz isimleştirmeleri, mekanik cümle ritmini ve muğlak başlığı temizlemektir.',
          'Metin, ilk kez Türkçe yazılmış bir kültür-sanat haberi gibi okunmalı. Fiilleri doğal kullan; uzun tamlamaları böl; özne-yüklem ilişkisini Türkçe haber diline göre yeniden kur.',
          'Başlık, spot ve giriş aynı bilgiyi tekrar etmesin. Paragraflar arasında doğal akış kur. Gereksiz açıklama, yorum, sıfat ve tanıtım dili ekleme.',
          'Başlığı ayrıca bağımsız bir editör gibi yeniden değerlendir. Türkiye’de bilinmeyen etkinlik veya kurum adını açıklamasız biçimde başlığın merkezinde bırakma. Gerekirse özel adı gövdeye indir ve başlıkta etkinliğin ne olduğunu açık Türkçeyle söyle.',
          'Başlıkta somut haber değerini mümkün olduğunca görünür kıl; sayı, ödül, sıra dışı mekân, ilk olma veya tanınmış isim varsa ve gerçekten ana gelişmeyse kullan. Clickbait ve abartı yapma.',
          'Muğlak “Çin bağlantılı”, “öne çıkıyor”, “sahnede” gibi ifadeleri ancak gerçekten en doğru ifade buysa koru; aksi halde daha kesin özne-fiil ilişkisi kur.',
          'Çeviri yanlış anlaşılmasına açık meslek/unvanları bağlama göre düzelt. Marka elçisi ile diplomatik büyükelçiyi, küratör ile yönetici/temsilciyi birbirine karıştırma.',
          'Tarih ve zaman bağlamını denetle. Kaynakta yıl varsa ve “kasım ayında” gibi ifade okuyucuyu yanlış yıla götürebilecekse yılı açıkça yaz.',
          'Olgu fişindeki gerçekleri, özel adları, tarihleri, sayıları, eser adlarını ve alıntı anlamlarını kesinlikle değiştirme. Kaynakta olmayan hiçbir bilgi ekleme.',
          'Bir ifade zaten doğal Türkçeyse sırf değişiklik yapmak için değiştirme. Ama İngilizce veya Çince cümle iskeletini taşıyan ifadeleri yeniden kur.',
          'Haber değerine göre 3-7 kısa paragraf, doğal bir başlık ve tek cümlelik spot üret. Küçük haberi sırf uzunluk hedefi için şişirme.',
          'Yanıtlamadan önce başlığı sessizce tek okumada anlaşılırlık, somutluk ve Türkçe doğallık açısından kontrol et; gerekiyorsa yeniden yaz.',
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

  let mechanicalIssues = translationIssues(final.draft);
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
    mechanicalIssues = translationIssues(final.draft);
  }

  if (!final.accepted) {
    throw new Error(`Editoryal doğrulama başarısız: ${final.issues.join(' ') || 'gerekçe belirtilmedi'}`);
  }

  // Son Türkçe editör geçişi kaliteyi artırır; ancak bu isteğin başarısız olması
  // çalışan sistemi durdurmaz. Daha önce doğrulanmış taslak güvenli fallback'tir.
  const prePolish = final;
  const prePolishIssues = translationIssues(prePolish.draft);
  try {
    const polished = await polishTurkishNews(article, factSheet, prePolish.draft, { signal, completeJson });
    if (polished.accepted) {
      assertUsableEditorialOutput(polished.draft);
      const polishedIssues = translationIssues(polished.draft);
      if (polishedIssues.length <= prePolishIssues.length) {
        final = polished;
        mechanicalIssues = polishedIssues;
        log('info', 'Türkçe son okuma tamamlandı', {
          source: article.source.id,
          title: final.draft.title,
          elapsedSeconds: elapsedSeconds(startedAt)
        });
      } else {
        log('warn', 'Türkçe son okuma mekanik kaliteyi düşürdü; önceki taslak korundu', {
          source: article.source.id,
          beforeIssues: prePolishIssues,
          afterIssues: polishedIssues
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
    log('warn', 'Son metinde kalan dil/biçim notları yayını engellemeyecek', {
      source: article.source.id,
      issues: mechanicalIssues
    });
  }
  assertUsableEditorialOutput(final.draft);
  log('info', 'Türkçe haber yayıma hazır', {
    source: article.source.id,
    title: final.draft.title,
    elapsedSeconds: elapsedSeconds(startedAt)
  });
  return { ...final.draft, factSheet, editorialMode: 'fact-ledger-turkish-newsroom-v7-clarity-copydesk' };
}