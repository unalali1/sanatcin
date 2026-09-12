# SanatÇin

SanatÇin, Çin'deki kültür-sanat gündemini Türkçe yayımlayan otomatik bir yayın sistemidir.

Bu depo iki parçadan oluşur:

- `wordpress/theme/sanatcin`: Taslak görsele göre hazırlanmış özel WordPress teması.
- `wordpress/plugin/sanatcin-automation`: Kaynak bilgilerini saklayan ve otomasyon için REST uçları sağlayan WordPress eklentisi.
- `worker`: Railway'de her gün bir kez çalışan haber tarama, puanlama, editoryal doğrulama ve yayın işleyicisi.

## Haber kaynakları

Worker 0.7, `2026-09-10-en-01` İngilizce kaynak havuzunu kullanır. Havuzda 6 native RSS rotası (CGTN, Sixth Tone, RADII Art, RADII Fashion, Dao Insights ve ArtAsiaPacific) ile China Daily, Xinhua, Jing Daily, SmartShanghai, City News Service, The World of Chinese ve Chinaculture.org için kaynak-özel HTML/hybrid adaptörleri bulunur. Ocula, Cloudflare insan doğrulaması nedeniyle yapılandırmada kayıtlıdır ancak kapalıdır. Önceki Çince ve karma kaynak havuzu tamamen kaldırılmıştır.

RSS ve HTML adayları canonical URL, başlık ve yayın tarihiyle tekilleştirilir. Kaynağa özgü konu/coğrafya filtreleri alakasız adayları erken eler; ödeme duvarı, üyelik, CAPTCHA ve insan doğrulaması aşılmaz. Chinaculture RSS akışı yeterli sayıda güncel ve tarihli öğe vermediğinde worker kamuya açık HTML sayfasına düşer.

## Yayın kuralı

Dört kategori kullanılır:

1. Kültür & Sanat
2. Sinema
3. Moda & Tasarım
4. Şehir & Yaşam

Her kategori için en fazla iki haber seçilir. Matematiksel günlük üst sınır sekiz haberdir; kalite kapısını geçen aday yoksa ilgili kategoride yayın yapılmaz. Bir kategoride en fazla beş aday denenir ve tüm çalışma 30 dakikalık güvenlik sınırıyla korunur. İşleyici son yedi günü değerlendirir, yayın tarihi doğrulanamayan adayları atlar ve aynı kaynak URL'sini ya da yüksek ölçüde benzer başlığı ikinci kez yayımlamaz. Finans, ekonomi, siyaset, spor, protokol ve kurumsal PR içerikleri kapsam dışıdır. AI sıralaması dengeli biçimde seçilmiş en fazla 40 aday üzerinde, 20'şer adaylık en fazla iki eşzamanlı partiyle yapılır. Zaman aşımına uğrayan parti daha küçük iki parçaya bölünür; bir partinin hatası diğer başarılı sonuçları silmez. Kategori kuyrukları tek bir yayıncı tarafından doldurulmaz; kaynaklar dönüşümlü sıralanır. Haberler kategori kategori seri işlenmek yerine dengeli turlarda ve en fazla iki eşzamanlı adayla hazırlanır.

Kaynak metin bire bir çevrilmez. 0.7.0 yayın zincirinde ekonomik model önce yalnız doğrulanabilir olguları, kişi ve kurum adlarını, tarihleri, sayıları ve alıntıları çıkarır; bu aşama Türkçe taslak üretmez. Güçlü Türkçe editör modeli özgün kaynak ile olgu fişini birlikte okuyup haberi Türkiye Türkçesinde sıfırdan yazar. Başlık/spot uzunluğu, Pinyin zincirleri, editoryal süreç notları ve cümle tekrarları yerel olarak denetlenir; sorun varsa editör modeli aynı metne yalnız bir hedefli düzeltme uygular. Düzeltilebilir dil ve biçim sorunları adayı elemez. Yalnız yetersiz kaynak, giderilemeyen önemli olgu çelişkisi veya kaynakta bulunmayan bilgi yayını engeller.

Worker önce kaynak haberdeki uygun fotoğraf, illüstrasyon veya etkinlik afişini dener; açık yeniden kullanım izni bulunması zorunlu değildir. Her kaynak görselinin URL'si ve yayın adı kaydedilir. Kaynak görseli indirilemez, yetersiz veya haberle ilgisizse OpenAI ile konuya özel temsili bir editoryal illüstrasyon üretilir. AI görsellerinde günlük adet sınırı yoktur ve her biri “AI ile üretilmiş temsili editoryal illüstrasyon.” ibaresiyle yayımlanır.

Ana sayfa içerik sayısına göre uyarlanır: son yedi günün en yüksek editoryal puanlı haberi ana haber olur; iki yan kart ve kalan içerik sayısına göre daralan yayın ızgarası kullanılır. `Editörden` menüsü manuel içerik için korunur. Otomatik haberler “SanatÇin Haber Merkezi” imzası ve doğru Organization şemasıyla gösterilir. Hakkımızda, Yayın İlkeleri ve İletişim sayfaları altbilgiden bağlanır. Tema dış font servisi ve sayfa kurucu gerektirmez.

Her çalışma benzersiz bir `runId`, sabit hata kodları, kaynak/kategori istatistikleri ve `success`, `partial` veya `failed` özet durumu üretir. AI sıralaması tamamen kullanılamazsa seçim kriterleri sıkılaştırılmadan deterministik mevcut puanlarla devam edilir. Benzer konular kuyrukta yalnızca geriye alınır; adaylar bu nedenle elenmez. GitHub Actions ve Railway Docker yapısı sözdizimi ile testleri dağıtımdan önce zorunlu çalıştırır.

## Kurulum

### WordPress

1. `wordpress/theme/sanatcin` klasörünü `wp-content/themes/` altına yükleyin ve temayı etkinleştirin.
2. `wordpress/plugin/sanatcin-automation` klasörünü `wp-content/plugins/` altına yükleyin ve eklentiyi etkinleştirin.
3. WordPress'te otomasyon kullanıcısı oluşturup bir uygulama parolası üretin.
4. Kalıcı bağlantıları `Yazı ismi` biçimine alın.

Eklenti dört haber kategorisini ve `Editörden` kategorisini otomatik oluşturur; kaynak URL'si, puanı ve görsel kökeni gibi alanları REST API'ye açar.

### Railway worker

`worker/.env.example` dosyasındaki değişkenleri Railway servis değişkenleri olarak tanımlayın. `OPENAI_SELECTION_MODEL` aday sıralamasını ve görsel uygunluk denetimini, `OPENAI_FACT_MODEL` olgu çıkarımını, `OPENAI_EDITOR_MODEL` ise nihai Türkçe haber yazımı ile tek seferlik dil düzeltmesini yönetir. Depo kökündeki `Dockerfile` ve `railway.toml`, Railway'in monorepo içindeki worker'ı doğrudan kurmasını sağlar.

İşleyici tek sefer çalışır ve çıkar. Railway cron ifadesi `0 2 * * *` olup her gün 02.00 UTC'de çalışır. Canlı ortamda `PUBLISH_STATUS=publish`, `DRY_RUN=false` ve `REQUIRE_PUBLISHED_DATE=true` kullanılır.

```bash
cd worker
npm install
npm test
npm run start
```

## Güvenlik

- API anahtarları veya WordPress parolaları depoya eklenmez.
- WordPress uygulama parolası yalnız Railway secret olarak saklanır.
- CAPTCHA, oturum açma veya ödeme duvarı aşılmaz.
- Her yazının sonunda yayın adı ve doğrudan kaynak bağlantısı bulunur.
