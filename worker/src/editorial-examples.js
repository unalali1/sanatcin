// Verified against SanatÇin WordPress post revisions on 13 October 2026.
// The examples teach editorial treatment, not transferable facts about new stories.
export const APPROVED_EDITORIAL_EXAMPLES = Object.freeze([
  {
    postId: 1184,
    category: 'kultur-sanat',
    before: 'Yungang Mağaraları’nda kaya içi yoğuşmaya erken uyarı sistemi',
    after: 'Yungang Mağaraları’nda tarihî heykeller yapay zekâyla korunuyor',
    principle: 'Teknik sistemi değil, tarihî eserlerin korunmasını haberin merkezine yerleştir.',
    approvedSpot: '9 ve 10 numaralı mağaralarda kurulan sensör ağı, taşın içinde oluşan yoğuşmayı yüzeye çıkmadan önce tespit etmeye yardımcı oluyor.',
    approvedLead: 'Çin’in Şanşi eyaletindeki UNESCO Dünya Mirası Listesi’nde yer alan Yungang Mağaraları’nda, kayanın içinde oluşan ve dışarıdan fark edilmeyen yoğuşmayı izlemek için yeni bir sistem devreye alındı. Sensörlerle birlikte kullanılan yapay zekâ destekli teknoloji, tarihî yapılara zarar vermeden yoğuşmanın oluştuğu derinliği belirlemeyi amaçlıyor.'
  },
  {
    postId: 1177,
    category: 'kultur-sanat',
    before: 'Sihirli Flüt, Pekin metrosundan fantastik dünyaya uzandı',
    after: 'Mozart’ın ‘Sihirli Flüt’ünde ejderhanın yerini metro treni aldı',
    principle: 'Genel ve soyut bir yeniden yorumlama yerine doğrulanmış, somut sahne ayrıntısını öne çıkar.',
    approvedSpot: 'Pekin’de sahnelenen operada ejderha bir trene, Papageno ise yemek kuryesine dönüştü; Mozart’ın masalsı dünyası kent yaşamıyla buluştu.'
  },
  {
    postId: 1172,
    category: 'moda-tasarim',
    before: 'Çağdaş markalar Tibet halısı geleneğini yeniden gündeme taşıyor',
    after: 'Tibet halıları çağdaş tasarımlarla yeniden hayat buluyor',
    principle: 'Belirsiz “markalar gündeme taşıyor” kalıbından kaçın; kültürel zanaatı somut özne yap.',
    approvedSpot: 'Khawachen ve Sharda Sharda, Tibet halısı geleneğini modern tasarımlar ve sosyal medya aracılığıyla yeni kuşaklara tanıtıyor.',
    approvedLead: 'Çin’in farklı bölgelerindeki geleneksel halı dokumacılığı, çağdaş tasarım markaları sayesinde yeni bir ilgi görüyor. RADII’nin haberine göre Khawachen ve Sharda Sharda, özellikle Tibet halılarının üretim yöntemlerini ve motiflerini yeni kuşaklara tanıtıyor.'
  },
  {
    postId: 1165,
    category: 'sinema',
    before: 'Şanghay belgeselinde Lu Xun ve Ding Ling anlatıcı olarak kurgulanıyor',
    after: 'Şanghay’ın 10 tarihî mekânı animasyonla canlanıyor',
    principle: 'Okurun tanımayabileceği kişi isimleri yerine belgeselin özgün biçimini ve ana konusunu açıkla.',
    approvedSpot: 'Yeni mikro belgesel dizisi, Şanghay’ın devrim tarihini 10 mekânın öyküsü ve farklı animasyon teknikleriyle genç izleyicilere anlatacak.',
    approvedLead: 'Şanghay’ın devrim tarihinde iz bırakan 10 mekânı konu alan ‘Anlatı’ adlı kısa belgesel dizisinin ikinci sezonu, 13 Ekim 2026’da başlayacak. On bölümlük yapım, tarihî olayları dönemin önemli isimlerinin bakış açısından canlandırarak genç izleyicilere anlatmayı hedefliyor.'
  },
  {
    postId: 1162,
    category: 'kultur-sanat',
    before: 'Fotoğrafçı Shi Guowei, festivallerden kalan izleri işliyor',
    after: 'Kutlamalardan geriye kalanlar: Shi Guowei’nin Shenzhen sergisi',
    principle: 'Belirsiz “izleri işliyor” anlatımını serginin temasına, sanatçıya ve mekâna bağla.',
    approvedSpot: 'Shenzhen’de açılan ‘Festa’ sergisinde sanatçı, siyah-beyaz fotoğraflarını elle renklendirerek kutlamaların geride bıraktığı izleri görünür kılıyor.',
    approvedLead: 'Fotoğraf sanatçısı Shi Guowei’nin kutlamalardan geriye kalan görüntülere odaklandığı ‘Festa’ sergisi, 1 Ekim 2026’da Fotografiska Shenzhen’de açıldı. 14 Mart 2027’ye kadar ziyaret edilebilecek sergide sanatçı, siyah-beyaz fotoğraflarını elle renklendirerek kutlamaların bıraktığı izleri araştırıyor.'
  }
]);

export const EDITORIAL_STYLE_STANDARD = [
  'Başlık haberin en özgün, doğrulanmış gelişmesini tek okumada anlatmalı; çeviri cümlesi veya etkinlik takvimi gibi durmamalı.',
  'Her cümlede özneyi ve fiili doğal Türkiye Türkçesiyle kur. Kaynak söz dizimini izleme; soyut isimleştirmeleri, promosyon dilini ve açıklanmamış jargonları temizle.',
  'Haberin ana gelişmesini ilk iki cümlede açıkla. Spot başlığın ve girişin aynısını yinelemesin; somut tamamlayıcı bilgi versin.',
  'Doğru kişi, yer, eser, sayı, tarih ve kaynak atfını koru. Gelecekteki etkinliği olmuş gibi veya açılmış sergiyi hâlâ planlanıyormuş gibi yazma.',
  'Kaynakta bulunmayan çıkarım, başarı, teknik veya dikkat çekici ayrıntı uydurma. İlgi çekicilik doğruluktan sonra gelir.'
].join(' ');

export function editorialExamplesFor(category, limit = 2) {
  const matching = APPROVED_EDITORIAL_EXAMPLES.filter(item => item.category === category);
  // Distinct fallbacks keep sparse categories useful without pretending their facts apply.
  const fallback = APPROVED_EDITORIAL_EXAMPLES.filter(item => item.category !== category);
  return [...matching, ...fallback].slice(0, Math.max(0, limit)).map(
    ({ before, after, principle }) => ({ before, after, principle })
  );
}
