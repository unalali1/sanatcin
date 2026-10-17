# SanatÇin Paket 1 — editoryal taslak seçimi (17 Ekim 2026)

## Sınır ve kanıt

Üretimdeki Railway dağıtımı `935c6d59` commit `253620bafb9b74ac331880c5b223edd16164d359` üzerinde çalıştı. Bu commit olgu birimi, kronoloji ve başlık yönergelerini güncelledi; taslak seçimi kodunu değiştirmedi. Dolayısıyla 17 Ekim'deki geri dönüşleri doğrudan bu commit'in yeni bir seçici algoritmasına atfetmek doğru değil. Etki, aynı seçim koduna verilen farklı model çıktıları üzerinden dolaylıdır; canlı model karşılaştırması yapılmadı.

Railway üretim günlükleri 17 Ekim 02:02–02:10 UTC aralığından, ilk yayın metinleri WordPress'in yedi haber için yayın anındaki ilk revizyonundan (1331, 1334, 1339, 1342, 1345, 1348, 1359), elle düzeltilmiş referanslar güncel 1330, 1333, 1338, 1341, 1344, 1347, 1358 kayıtlarından alındı. Ayrıca 12–13 Ekim'den 13 ayrı ilk revizyonla toplam 20 farklı metin test kümesine kondu. Sonradan düzeltilmiş yedi metin, ilk yayın performansına dahil edilmedi.

## Kök neden ve karar zinciri

`translateArticle` ilk haber taslağını yazar, mekanik sorun varsa onarır, akıcı son okumayı üretir, sayı/ad/biçim farkını denetler, gerektiğinde tam metin onarımı yapar, hakeme gönderir, başlığı ayrıca üç adayla değerlendirir ve son yayın kapısını uygular.

1. Son okuma güvenlik farkı saptanınca tam metni tekrar yazdırıyor; düzelmezse önceki taslağa dönüyordu. RADII opera haberinde doğrulanmamış Çince karakter farkı gerçek bir biçim güvenliği gerekçesiydi; fakat eski taslaktaki klişe uyarısı devam ederek yayımlandı. Nike haberindeki adlandırma farkı da denetlenmeliydi. Kim Jones haberinde `ilk` kapsamını düşüren olgusal fark için geri dönüş yerindeydi.
2. Hakem tek bir `A|B` kararı ve serbest gerekçe veriyordu; olgusal çatışmayı üslup tercihinden yapılandırılmış olarak ayırmıyordu. Yalnız üslup nedeniyle A seçilirse B'ye yönelik bir tam metin onarımı daha yapılıyor, başarısız olduğunda eski taslak korunuyordu. Ölçülebilir akıcılık üstünlüğü karara bağlanmıyordu.
3. Birinci onarımdan sonra güvenlik bayrağı hesaplanıyor; ikinci hakem onarımı aday metni değiştirse de önceki bayrak kullanılabiliyordu. Son yapı ve özel dil onarımlarında da seçilen sürümün bütün geçiş koşulları aynı biçimde kaydedilmiyordu.
4. Başlık mikro-editörünün reddi tek başına hata değildir: Çifte Dokuz başlığında öneri daha az doğal; Anne Imhof önerisi yer ve eser adını çıkarıyor; Kim Jones önerisi ana gelişmeyi terzilik ayrıntısına kaydırıyordu. Majidi haberinde Oscar yeterliliğini koruma gerekçesi anlaşılır olsa da ilk yayımlanan başlık film adını ve asıl ödülü geri plana atıyordu; sonradan elle düzeltildi. Güvenlik kapısının bilinmeyen özel adla başlayan Kim Jones önerisini elemesi, olgusal değil açıklık denetimidir.

## Değişiklik

`worker/src/draft-decision.js` güvenlik farklarını (sayı/tarih, doğrulanmış ad, Çince karakter, açık dil kusuru) ikincil üslup notlarından ayırıyor. Hakem artık ancak alanı ve olgu fişinden kanıtı olan çatışmayı `factualConflict` olarak işaretleyebiliyor. Yalnız kişisel üslup tercihiyle A seçildiğinde B açıkça daha iyi dil puanı veya bağımsız hakem puanı taşıyorsa B korunuyor. Giderilemeyen güvenlik farkı veya doğrulanmış hakem çatışması haberi editör incelemesine yönlendiriyor; önceki sürüm otomatik yayımlanmıyor. Son aday yeniden denetleniyor. Kalan ikincil sorun için bir hedefli onarım yapılıyor. Taslak, başlık ve son yapı kararları mevcut yapılandırılmış Railway günlüğünde haber URL'si, gerekçe ve kalan sorunlarla kaydediliyor. Veri tabanı şeması ve diğer iş akışları değişmedi.

## Karşılaştırma ve sınırlamalar

Yedi ilk yayın/elle düzeltme eşleşmesinin yedisinde de gövde değişmiş; altısında başlık değişmiş, Çifte Dokuz başlığı korunmuştur. Heuristik dil puanları sırayla ilk yayın → elle düzeltme: opera 92→94, Majidi 100→100, Çifte Dokuz 97→100, osmanthus 100→100, Hamlet 100→92, Anne Imhof 88→88, parfüm 95→94. Bunlar **gerçek editör kalitesi veya olgu sadakati puanı değildir**; özellikle Hamlet ve parfümde elle düzeltmenin daha düşük puan alması yöntemin sınırını gösterir. Sayı koruma denetimi opera ve Hamlet eşleşmelerinde uyarı veriyor; elle redaksiyonda bazı sayılar bilinçli olarak çıkarılmış olabileceğinden bunlar kanıtlanmış olgusal hata sayılmadı.

20 ayrı ilk revizyonda güvenli/üslup seçimi ve eklenen doğrulanmamış Çince karaktere karşı yayın engeli sınandı. İki revizyon zaten biçim güvenliği sorunu taşıdığı için güvenli başlangıç kabul edilmedi. Bu testler modelin yeni Türkçe metin üretiminin başarısını ölçmez. Canlı kaynak+model replay'i için API/model değerleri bu çalışma ortamında bulunmadığından olgusal doğruluk ve akıcılıkta nicel üretim iyileşmesi ileri sürülmüyor.

## Çıkış kararı

Kod ve testler ayrı bir inceleme dalında tutulmalı. Production dağıtımı yapılmadı. Dağıtım öncesi yedi kaynak haberle sınırlı canlı model replay'i, editörün olgu fişi ve düzeltme referansıyla kör değerlendirmesi ve günlüklerin taslak bazında incelenmesi önerilir. Geri dönüşün editör incelemesine dönüşmesi bazı günlerde yayımlanan haber sayısını azaltabilir; bu bilinçli güvenlik tercihinin canlı ölçümü gereklidir.
