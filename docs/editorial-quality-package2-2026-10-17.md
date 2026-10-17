# Paket 2 — kültür-sanat editoryal kalite denetimi

17 Ekim 2026. Temel karşılaştırma: üretimdeki Paket 1 sürümü `6df7ff2de7e235127a2cdc7403a9d9a9c91d1e08` ile bu dalın **aynı tarihsel metne uyguladığı belirlenimci kontroller**. El redaksiyonları ayrıca gösterilir; yeni sistemin ürettiği haber olarak sayılmaz.

## Kapsam ve yöntem

- WordPress'in 12–17 Ekim tarihli 30 ayrı haberinin **ilk yayın revizyonu** ve o revizyonun spotu kullanıldı. Kategoriler: sinema 5, moda/tasarım 6, sahne sanatları 7, geleneksel kültür 7, görsel sanatlar 5. İlk revizyon ve yedi haberin sonraki insan redaksiyonu farklı kayıtlar olarak tutuldu. Tam metin ve spotlar `worker/test/fixtures/` dizininde; haber ve revizyon kimlikleri `editorial-quality-audit-2026-10-17.json` dosyasında.
- Her ilk yayına eski kodun `newsroomFindings`, `headlineEditorialWarnings` ve `editorialFluencyProfile` kontrolleri ve bu dalın eşdeğer kontrolleri ayrı ayrı uygulandı. Denetim `cd worker && node dev/editorial-quality-audit.mjs ../docs/editorial-quality-audit-2026-10-17.json` komutuyla tekrar üretilebilir. Sözcük paydası ilk yayımlardaki Türkçe gövdelerin Unicode harf dizileridir: toplam 7.168 sözcük.
- “Mekanik ifade oranı” iki biçimde verildi: en az bir `repair` bulgusu içeren haber/30 ve `repair` bulgusu × 1.000/7.168 sözcük. “Başlık müdahalesi” en az bir başlık uyarısı veya `title`/`title_spot` onarım bulgusu olan haber/30. Spot/giriş tekrarı, en az 80 karakterlik normalize edilmiş spotun girişte aynen bulunması; başlık/spot sözcük örtüşmesi, başlığın dört ve üzeri harfli içerik sözcüklerinin spotta bulunan oranı ≥ 0,7. Bu iki sayım anlamsal tutarlılığı kanıtlamaz.
- Akıcılık puanı mevcut `editorialFluencyProfile` sezgisel puanının 30 haber ortalamasıdır; insan puanı değildir. Dil bilgisi/anlam hatalarının tümü ve kaynak sadakati bağımsız kaynak karşılaştırması yapılmadan sayısallaştırılamaz. 30 ilk yayının 25'inde kaynak URL'si revizyon HTML'sinden çıkarılabildi; beşinde yoktu. Bu yüzden olgusal güvenlik için doğrulanmış başarı yüzdesi verilmedi.

## Aynı 30 metinde eski ve yeni kontrol sonucu

| Ölçü | Paket 1 kontrolü | Paket 2 kontrolü | Yorum |
|---|---:|---:|---|
| Mekanik ifade işaretlenen haber | 0/30 | 4/30 | Yakalama arttı; metinler değiştirilmedi. |
| Mekanik `repair` bulgusu | 0; 0/1.000 sözcük | 6; 0,84/1.000 sözcük | 1330, 1333, 1341 ve 1358. |
| Başlık editör müdahalesi işareti | 0/30 | 3/30 | 1333, 1341 ve 1358; tüm sorunları yakalama iddiası yok. |
| Spotun girişte aynen tekrarı | 0/30 | 0/30 | Bu eşik altında yeni bulgu yok. |
| Başlık/spot örtüşmesi ≥ 0,7 | 0/30 | 0/30 | Sözcük örtüşmesi tek başına uyum ölçüsü değildir. |
| Sezgisel Türkçe akıcılık ortalaması | 96,5/100 | 94,1/100 | Aynı metinde yeni sorun cezaları; üretilmiş metin kalitesi karşılaştırması değildir. |
| Dil bilgisi, anlam ve kaynak sadakati | Ölçülmedi | Ölçülmedi | Kaynak metin ve insan doğrulaması gerekir. |

Yedi insan redaksiyonunun altısında başlık, yedisinde gövde değişmiştir. İkisinde eski/yeni sayısal diziler farklı olduğu için bir kontrol bayrağı oluştu; bu **olgusal hata tespiti değildir**. Eski başlığın aynı kaldığı Çifte Dokuz örneği, doğru soru biçiminin korunmasına iyi bir referanstır. Beş karşılaştırma aşağıdadır.

## Kod ve editoryal karar

`worker/src/arts-editor.js` alanlara özgü kaynak sadakati, yerleşik Türkçe terimler, haber değeri, paragraf sırası ve başlık/spot tamamlayıcılığı yönergelerini mevcut haber yazımı ve son okuma istemine taşır. Kaynağın açıklamadığı bir Çin kültür terimi için rastgele karşılık veya festival tarihi üretmeyi yasaklar. Aynı modül bağlama bağlı, açıklanabilir dil bulguları üretir; ifadeleri körlemesine yeniden yazmaz.

`worker/src/editorial-review.js` ve `worker/src/draft-decision.js` bu bulguları olgu fişiyle beraber taslak seçimine geçirir. `worker/src/headline-editor.js`, üç adaylı sistemi koruyup yüksek puanlı ama muğlak başlıkları sıralamadan önce ayıklar. `worker/src/translate.js` mevcut yazım/son okuma/başlık aşamalarının istemini güçlendirir; kapanış kapısında sorunlu cümleye odaklı mevcut onarım turunu kullanır. Somut onarım başarısızsa haber yayın kapısından geçmez. Normal akışa yeni model çağrısı veya yeni model eklenmedi; bir sorun yakalanınca mevcut koşullu onarım turunun çalışma sıklığı artabilir, gerçek maliyeti çalışma günlükleriyle izlenmelidir.

Sınır: Düzenleyici, kaynak keşfi, scraping, veritabanı, sosyal medya, görsel ve zamanlama kodları değiştirilmedi. Bazı deyimler yalnızca belirli bağlamda güvenle işaretlenebilir; düzenleyici bulgu yokluğu kusursuz Türkçe anlamına gelmez. Olgu fişinin kendisi yanlışsa bu katman gerçeği tek başına doğrulayamaz.

## Çalıştırma ve eksik karşılaştırma

`npm run check` ve `npm test`: 238 başarılı, 0 başarısız. Yeni regresyonlar 30 ilk sürümün kimliklerini, alan dağılımını, yedi manuel sürümün ayrımını, somut kültür-sanat bulgularını, yanlış pozitif bağlamları, yüksek puanlı ama muğlak başlığın elenmesini ve bir moda cümlesinin olguları korunarak hedefli onarımını denetler.

**Aynı kaynak haberlerden eski ve yeni modelle yeniden yazım yapılmadı.** Bu çalışma ortamında model kimlik bilgileri yok; Railway değişken değerleri bağlı araçta gizleniyor. Dolayısıyla başlık, giriş ve paragrafta aşağıdaki “sonraki” sütunu **insan redaksiyonudur**, yeni kodun çıktısı değildir. Gerçek model öncesi/sonrası kalite oranı ve kaynak sadakati oranı bu verilerden çıkarılamaz. Üretimde örnekleme ile aynı kaynak metnin iki sürümünü ayrı kaydedip kör editör değerlendirmesi ve kaynak cümlesi denetimi yapılarak ikinci bir sonuç raporu oluşturulmalıdır. Yeni çağrılar mevcut iş hattındaki çağrıları iki kez çalıştıracağı için 30 haberlik çift yeniden yazımın API maliyeti, kullanılacak modelin gerçek token kayıtları görülmeden hesaplanamaz.

## Beş gerçek haberde ilk yayın ve insan redaksiyonu

Bu örnekler yeni kodun çıktıları olarak etiketlenmez. Spotlar ve tam metinler karşılaştırma JSON'unda da saklanmıştır.

### Çin operasında sahne teknikleri — haber 1330, ilk revizyon 1331

| Alan | İlk yayımlanan sürüm | Sonraki insan redaksiyonu |
|---|---|---|
| Başlık | Çin operasında zombi düşüşü ve hayalet adımları | Çin operasının ürpertici yüzü: Hayalet adımları ve zombi düşüşü |
| Giriş | Geleneksel Çin operasında bir oyuncu bedenini tamamen kilitleyip dümdüz geriye düşebiliyor; bir başkası ise geniş kostümünün altında attığı küçük adımlarla sahnede süzülüyormuş izlenimi yaratıyor. RADII, 16 Ekim 2026’da yayımlanan yazısında bu korku estetiğini kuran dört karakter ve performans unsurunu inceledi. | Geleneksel Çin operasında oyuncular bazen bedenlerini dimdik tutarak arkaya düşüyor, bazen de uzun kostümlerinin altında gizledikleri küçük adımlarla sahnede havada süzülüyormuş izlenimi yaratıyor. Kültür ve sanat yayını RADII’nin ele aldığı bu sahne teknikleri, Çin tiyatrosunun mitolojik ve ürpertici anlatı geleneğini yansıtıyor. |
| Örnek ikinci paragraf | Kâğıt Adam, ölüler adına kâğıt sunular yakılmasıyla bağlantılı eski cenaze uygulamalarından esinlenen bir karakter olarak tanımlanıyor. Oyuncular bu figürü belirgin beyaz yüz makyajı, kuklayı andıran sert hareketler ve ani seğirmelerle canlandırıyor. Karakterin arka planında, öte dünya için kâğıttan nesneler hazırlayıp yakma geleneği bulunuyor. | Bu figürlerden biri olan “Kâğıt Adam”, ölen kişilere öte dünyada eşlik etmesi amacıyla kâğıttan nesnelerin yakıldığı gelenekten esinleniyor. Beyaz yüz makyajı, kuklayı andıran keskin hareketler ve ani seğirmeler, karaktere tekinsiz bir görünüm kazandırıyor. |


### Çifte Dokuz geleneği — haber 1338, ilk revizyon 1339

| Alan | İlk yayımlanan sürüm | Sonraki insan redaksiyonu |
|---|---|---|
| Başlık | Çifte Dokuz Festivali’nde yüksek yerlere neden çıkılıyor? | Çifte Dokuz Festivali’nde yüksek yerlere neden çıkılıyor? |
| Giriş | Çifte Dokuz Festivali’nde yüksek yerlere çıkma geleneği sürüyor. Gelenek, uğursuzlukları uzaklaştırma ve bereket dileme düşüncesiyle ilişkilendiriliyor; bugün ise yürüyüş yapmak ve sonbahar manzaralarını izlemek için de bir fırsat olarak görülüyor. | Çin’de 18 Ekim’de kutlanacak Çifte Dokuz (Chongyang) Festivali’nin en eski geleneklerinden biri dağlara ve yüksek tepelere çıkmak. Ay takviminin dokuzuncu ayının dokuzuncu gününe rastlayan bayramda bu gelenek, geçmişte kötülüklerden korunma ve esenlik dileme inancıyla ilişkilendiriliyordu. Bugünse sonbaharda doğayla buluşmanın da bir yolu olarak yaşatılıyor. |
| Örnek ikinci paragraf | Huashan Dağı dik zirveleriyle, Huangshan Dağı bulut deniziyle, Taishan Dağı ise gün doğumu manzarasıyla anılıyor. Lushan Dağı sonbahar ormanlarıyla öne çıkarken Qingcheng Dağı sakin güzelliğiyle dikkat çekiyor. | Çin’in farklı bölgelerindeki dağlar bu geleneğe ayrı manzaralar sunuyor: Huashan sarp zirveleriyle, Huangshan bulut deniziyle, Taishan ise gün doğumuyla tanınıyor. Lushan’ın sonbahar ormanları ve Qingcheng’in sakin doğası da yürüyüş rotaları arasında gösteriliyor. |


### Şanghay Moda Haftası ve osmanthus — haber 1341, ilk revizyon 1342

| Alan | İlk yayımlanan sürüm | Sonraki insan redaksiyonu |
|---|---|---|
| Başlık | Suchness defilesinde osmanthus kokusu keselerle yayıldı | Şanghay Moda Haftası’nda kıyafetlere osmanthus kokusu eşlik etti |
| Giriş | Çinli tasarım markası Tuyue, Şanghay Moda Haftası’nda 2027 ilkbahar-yaz koleksiyonu Suchness’i tanıttı. Tuyue’nin koleksiyon sunumuna göre, giysi ve ışığın yanı sıra özel üretim bir koku da ilk kez podyum anlatısının parçası oldu. | Şanghay Moda Haftası’nda 2027 ilkbahar-yaz koleksiyonunu tanıtan Çinli moda markası Tuyue, gösterinin bir parçası olarak osmanthus çiçeğinin kokusunu kullandı. “Suchness” adlı defilede, modeller hareket ettikçe küçük keselerden yayılan koku podyumun atmosferini tamamladı. |
| Örnek ikinci paragraf | Bir tütsü markasıyla hazırlanan doğal osmanthus karışımı, modeller hareket ettikçe koku yayan narin keselerde kullanıldı. Markanın ilk özel üretim kokusu olan bu karışım için Tuyue’nin kurucusu Yang Yingying, “Kokuyu fark ettiğinizde zaten onun içindesiniz” dedi. | Koku, markanın bir tütsü üreticisiyle hazırladığı doğal çiçek karışımından elde edildi. Tuyue’nin kurucusu Yang Yingying, böylece izleyicileri koleksiyonun çok duyulu dünyasına katmak istediklerini belirterek “Kokuyu fark ettiğinizde zaten onun içindesiniz” dedi. |


### Anne Imhof sergisi — haber 1347, ilk revizyon 1348

| Alan | İlk yayımlanan sürüm | Sonraki insan redaksiyonu |
|---|---|---|
| Başlık | Anne Imhof’tan Hong Kong’da dört perdelik bale: “House of Swans” | Anne Imhof, Hong Kong’da bale ile çağdaş sanatı buluşturuyor |
| Giriş | Anne Imhof’un Hong Kong’daki Tai Kwun Contemporary’de düzenlenen “House of Swans” sergisinin merkezinde, American Ballet Theatre ve Hong Kong Ballet dansçılarının gerçekleştirdiği dört perdelik bir öykü balesi yer alıyor. Heykel, resim ve büyük ölçekli enstalasyonların yayıldığı sergideki performans, Amalia adlı genç kadının kurulu düzenin dışına çıkarak kendi kararlarını belirleme gücünü aramasını anlatıyor. | Alman sanatçı Anne Imhof, Hong Kong’daki Tai Kwun Contemporary’de düzenlenen “House of Swans” sergisinde bale, resim, heykel ve yerleştirme sanatını buluşturuyor. Serginin merkezinde, American Ballet Theatre ve Hong Kong Ballet dansçılarıyla hazırladığı dört perdelik performans yer alıyor. Yapım, Amalia adlı genç bir kadının kendisine biçilen düzene karşı çıkarak kendi yolunu bulma çabasını anlatıyor. |
| Örnek ikinci paragraf | Imhof, balenin biçimsel disiplininin kendisine bir beste formülü sunduğunu ve bu kısıtlamaların ifade alanını genişlettiğini söylüyor. Sanatçı, klasik bale ile çağdaş dansı bir araya getiren yapının, aşkın yanı sıra güç ve özneleşme üzerine kurulu trajik bir hikâye taşıdığını belirtiyor. | Klasik balenin kurallarını çağdaş dansla bir araya getiren Imhof, bu karşıtlığı eserinin temelinde görüyor. Sanatçıya göre balenin disiplinli yapısı, ifade özgürlüğünü sınırlamak yerine yeni olanaklar açıyor. Performans, aşk ve güç ilişkilerinin yanı sıra bireyin kendi yaşamı üzerinde söz sahibi olma arayışını da ele alıyor. |


### Asya parfüm markaları — haber 1358, ilk revizyon 1359

| Alan | İlk yayımlanan sürüm | Sonraki insan redaksiyonu |
|---|---|---|
| Başlık | Asya markaları gurme kokuları tatlı ekseninin dışına taşıdı | Asyalı parfüm markaları yeni kokuların peşinde: Çay, pirinç ve baharat |
| Giriş | Paris’te 23-25 Eylül 2026’da düzenlenen Asia Perfume Show 2026, Çin’den 20, Asya’nın diğer bölgelerinden 25 parfüm markasını bir araya getirdi. Tayland, Endonezya, Filipinler, Vietnam ve Hindistan’dan katılan markalar; mango, pirinç, çay ve durian gibi malzemelerle gurme kokuları tatlı ekseninin dışına taşıdı. | Paris’te 23-25 Eylül 2026’da düzenlenen Asia Perfume Show, Çin’den 20, Asya’nın diğer ülkelerinden 25 parfüm markasını buluşturdu. Tayland, Endonezya, Filipinler, Vietnam ve Hindistan’dan katılan üreticiler; çay, pirinç, mango ve durian gibi malzemelerle alışılmış tatlı kokuların ötesine geçen parfümler tanıttı. |
| Örnek ikinci paragraf | Etkinlikteki yorumlar, koku yayılımı, kalıcılık ve belirgin koku izi gibi yerleşik ölçütlerin yanı sıra umami, ölçülü tatlılık ve geçicilik gibi nitelikleri de öne çıkardı. Fermente edildiğinde hayvansı ve ud benzeri bir karakter kazanan Thai Assam çayı kullanılan malzemeler arasındaydı. Mango ise yeşil ve ekşi tonlarıyla, acı biber, tuz ya da içkiyle eşleştirilerek işlendi. | Fuarda yalnızca kokuların kalıcılığı ve yoğunluğu değil, yarattıkları farklı duyusal etkiler de öne çıktı. Bazı markalar tatlılığı geri planda tutarken yiyeceklerden tanıdığımız umami çağrışımlarına ve daha hafif koku izlerine yöneldi. Fermente Thai Assam çayı, ud ağacını andıran ve hayvansı notalarıyla kullanıldı; mango ise acı biber, tuz ya da içki çağrışımlarıyla birleştirildi. |

