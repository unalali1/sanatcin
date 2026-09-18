# SanatÇin — Çin Sanatları Dosyası

## Amaç

SanatÇin'de haftada bir kez geleneksel Çin sanatları hakkında kaynak temelli, uzun ömürlü ve arşiv değeri yüksek bir Türkçe dosya üretmek. Sistem günlük haber worker'ından bağımsızdır ve hiçbir dosyayı otomatik olarak yayımlamaz; WordPress'e taslak bırakır.

## Yayın ritmi

- Railway cron: `0 1 * * 5`
- Zaman: Cuma 01:00 UTC / Cuma 09:00 Pekin
- Hedef: haftada 1 taslak
- Aynı ISO haftasında ikinci kez çalışırsa yeni taslak üretmez.
- 52 benzersiz konu havuzu sırayla kullanılır.

## Editoryal akış

1. Haftanın kullanılmamış konusu seçilir.
2. OpenAI Responses web aramasıyla birinci araştırma turu yapılır.
3. En az 4 kaynak, en az 3 bağımsız alan adı ve en az 2 kurumsal/akademik kaynak zorunludur.
4. İkinci bağımsız web fact-check turu her olguyu `verified`, `caution` veya `drop` olarak sınıflandırır.
5. Yalnız kalan olgularla 1.200–1.800 kelimelik Türkçe uzun form yazılır.
6. Wikimedia Commons'ta lisansı uygun görseller aranır. CC0, Public Domain, CC BY ve CC BY-SA önceliklidir.
7. Görsel adayları konu ilgisi ve editoryal kalite açısından görsel modelle değerlendirilir.
8. Görseller WordPress medya kütüphanesine yüklenir; kaynak ve lisans bilgisi caption/description alanına yazılır.
9. Yazı `Kültür & Sanat` + `Çin Sanatları Dosyası` kategorileriyle `draft` statüsünde oluşturulur.
10. Editör WordPress'te fact-check, başlık, görsel ve kaynak kontrolünü yaptıktan sonra manuel yayımlar.

## İçerik standardı

- Hedef uzunluk: 1.200–1.800 Türkçe kelime.
- 6–10 anlamlı H2 ara başlık.
- Türkçede yerleşik karşılığı bulunmayan Çince eser, teknik, akım ve kültürel kavramlarda kısa ilk kullanım standardı: **Doğal Türkçe Karşılık (“中文名称”, Pinyin)**. Sonraki kullanımlarda yalnız Türkçe karşılık kullanılır.
- Çince karakter ve pinyin yalnız ikinci fact-check turunda birlikte doğrulanmış glossary kayıtlarından alınır; doğrulanamayan kayıt metne taşınmaz.
- Adlandırma önceliği: kişi adlarında kaynaktaki tam Latin yazımı; marka ve kurumlarda resmî ad + gerektiğinde Türkçe tür açıklaması; eser, etkinlik ve kavramlarda yerleşik Türkçe ad veya doğal Türkçe karşılık; coğrafi adlarda yerleşik Türkçe biçim.
- Başlık ve spotta Hanzi veya Pinyin kullanılmaz; özgün ad yalnız gövdede ilk kullanımda verilir.
- Tarih, hanedan, teknik, malzeme, coğrafya, kişi/usta ve UNESCO statüleri kaynakla doğrulanmadan kesin ifade edilmez.
- Pazarlama, turizm tanıtımı, propaganda, kaynaksız övgü ve çeviri kokan cümleler kullanılmaz.
- Kaynaklar yazının sonunda `Kaynaklar ve ileri okuma` bölümünde listelenir.
- Fildişi gibi hassas kültürel nesnelerde güncel koruma ve etik bağlam ayrıca verilir.

## Görsel standardı

- Hedef: 5 görsel; maksimum 6.
- İlk görsel featured image olur; gövdede tekrar edilmez.
- Kalan görseller 2., 5., 8., 11. ve 14. paragraflardan sonra dağıtılır.
- Aynı nesnenin yakın varyasyonları yerine eser/teknik/mekân/bağlam çeşitliliği tercih edilir.
- Lisans ve Commons kaynak bağlantısı her görselde korunur.
- Tarihsel sanat dosyalarında sentetik AI görseli varsayılan kaynak değildir.

## Newsletter entegrasyonu

Yayımlanmış `cin-sanatlari-dosyasi` içerikleri normal `newsletterScore` hesaplamasından sonra +10 soft bonus alır. Bonus içeriği zorunlu seçmez ve hero olmasını garanti etmez; haftanın başka bir içeriği daha güçlü ise o içerik önde kalabilir.

## WordPress

- Parent kategori: `kultur-sanat`
- Alt kategori: `cin-sanatlari-dosyasi`
- Alt kategori adı: `Çin Sanatları Dosyası`
- Otomatik taslak slug: `cin-sanatlari-dosyasi-<konu-slug>`

## Railway ortam değişkenleri

Zorunlu:

- `OPENAI_API_KEY`
- `WP_BASE_URL`
- `WP_USERNAME`
- `WP_APP_PASSWORD`

Önerilen:

- `DOSSIER_MODE=draft`
- `DOSSIER_RESEARCH_MODEL=gpt-5.6-luna`
- `DOSSIER_EDITOR_MODEL=gpt-5.6-terra`
- `DOSSIER_VISION_MODEL=gpt-5.6-luna`
- `DOSSIER_IMAGE_TARGET=5`
- `DOSSIER_MAX_RUN_MINUTES=25`
- `NEWSLETTER_DOSSIER_BONUS=10`

## Editör kontrol listesi

Taslak yayımlanmadan önce:

- Başlıktaki ana iddia kaynaklarla destekleniyor mu?
- Hanedan/tarih/yer/usta adları ikinci fact-check ile uyumlu mu?
- Çince karakter ve pinyin doğru mu?
- Kaynak listesinde en az iki güçlü kurumsal/akademik kaynak var mı?
- Görseller gerçekten aynı sanat geleneğine mi ait?
- Commons lisans ve attribution bilgisi korunmuş mu?
- Metin Türkçe okur için açıklayıcı mı, yoksa yalnız Çin'deki mevcut bilgiyi çeviriyor mu?
- Sonuç bölümü konuyu günümüze bağlayıp dosyayı tamamlıyor mu?

## Güvenli başarısızlık

Araştırma için web araması kullanılamazsa, kaynak sayısı/çeşitliliği yetersizse, ikinci fact-check sonrası yeterli olgu kalmazsa veya yazı kalite sınırını geçmezse sistem taslak oluşturmaz. Bu durumda günlük haber ve newsletter servisleri etkilenmez.
