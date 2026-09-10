# SanatÇin

SanatÇin, Çin'deki kültür-sanat gündemini Türkçe yayımlayan otomatik bir yayın sistemidir.

Bu depo iki parçadan oluşur:

- `wordpress/theme/sanatcin`: Taslak görsele göre hazırlanmış özel WordPress teması.
- `wordpress/plugin/sanatcin-automation`: Kaynak bilgilerini saklayan ve otomasyon için REST uçları sağlayan WordPress eklentisi.
- `worker`: Railway'de her gün bir kez çalışan haber tarama, puanlama, editoryal doğrulama ve yayın işleyicisi.

## Yayın kuralı

Dört kategori kullanılır:

1. Kültür & Sanat
2. Sinema
3. Moda & Tasarım
4. Şehir & Yaşam

Her kategori için en fazla iki haber seçilir. Matematiksel günlük üst sınır sekiz haberdir; kalite kapısını geçen aday yoksa ilgili kategoride yayın yapılmaz. İşleyici son yedi günü değerlendirir, yayın tarihi doğrulanamayan adayları atlar ve aynı kaynak URL'sini ya da yüksek ölçüde benzer başlığı ikinci kez yayımlamaz. Finans, ekonomi, siyaset, spor, protokol ve kurumsal PR içerikleri kapsam dışıdır.

Kaynak metin bire bir çevrilmez. 0.3 yayın zinciri önce doğrulanabilir olguları çıkarır, bu olgu fişinden Türkçe haber yazar, ayrı bir redaksiyon aşamasında çeviri kokusunu giderir ve son olarak metni yeniden olgu fişiyle karşılaştırır. Başlık ve spot uzunlukları otomatik onarılır. Görselin çözünürlüğü, oranı, konu ilgisi ve daha önce kullanılıp kullanılmadığı ayrıca doğrulanır; uygun kaynak görsel bulunamazsa yanıltıcı veya tekrar eden bir fotoğraf kullanmak yerine haber görselsiz yayımlanır.

Ana sayfa içerik sayısına göre uyarlanır: tek haberde dengeli bir görsel-metin düzeni, iki-dört haberde ana haber ile yan kartlar, daha zengin arşivde ise dört sütunlu yayın ızgarası kullanılır. Tema dış font servisi ve sayfa kurucu gerektirmez.

## Kurulum

### WordPress

1. `wordpress/theme/sanatcin` klasörünü `wp-content/themes/` altına yükleyin ve temayı etkinleştirin.
2. `wordpress/plugin/sanatcin-automation` klasörünü `wp-content/plugins/` altına yükleyin ve eklentiyi etkinleştirin.
3. WordPress'te otomasyon kullanıcısı oluşturup bir uygulama parolası üretin.
4. Kalıcı bağlantıları `Yazı ismi` biçimine alın.

Eklenti dört kategoriyi otomatik oluşturur ve kaynak URL'si/puanı gibi alanları REST API'ye açar.

### Railway worker

`worker/.env.example` dosyasındaki değişkenleri Railway servis değişkenleri olarak tanımlayın. Depo kökündeki `Dockerfile` ve `railway.toml`, Railway'in monorepo içindeki worker'ı doğrudan kurmasını sağlar.

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
