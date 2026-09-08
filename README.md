# SanatÇin

SanatÇin, Çin'deki kültür-sanat gündemini Türkçe yayımlayan otomatik bir yayın sistemidir.

Bu depo iki parçadan oluşur:

- `wordpress/theme/sanatcin`: Taslak görsele göre hazırlanmış özel WordPress teması.
- `wordpress/plugin/sanatcin-automation`: Kaynak bilgilerini saklayan ve otomasyon için REST uçları sağlayan WordPress eklentisi.
- `worker`: Railway'de her gün bir kez çalışan haber tarama, puanlama, tam metin çeviri ve yayın işleyicisi.

## Yayın kuralı

Dört kategori kullanılır:

1. Kültür & Sanat
2. Sinema
3. Moda & Tasarım
4. Şehir & Yaşam

Her kategori için en az bir, en fazla iki haber seçilir. Matematiksel günlük üst sınır sekiz haberdir. İşleyici önce son 72 saati, yeterli aday yoksa son yedi günü değerlendirir. Aynı kaynak URL'si ikinci kez yayımlanmaz.

## Kurulum

### WordPress

1. `wordpress/theme/sanatcin` klasörünü `wp-content/themes/` altına yükleyin ve temayı etkinleştirin.
2. `wordpress/plugin/sanatcin-automation` klasörünü `wp-content/plugins/` altına yükleyin ve eklentiyi etkinleştirin.
3. WordPress'te otomasyon kullanıcısı oluşturup bir uygulama parolası üretin.
4. Kalıcı bağlantıları `Yazı ismi` biçimine alın.

Eklenti dört kategoriyi otomatik oluşturur ve kaynak URL'si/puanı gibi alanları REST API'ye açar.

### Railway worker

`worker/.env.example` dosyasındaki değişkenleri Railway servis değişkenleri olarak tanımlayın. Servis kök dizini `/worker`, yapılandırma dosyası `/worker/railway.toml` olmalıdır.

İşleyici tek sefer çalışır ve çıkar. Railway cron ifadesi `0 2 * * *` olup her gün 02.00 UTC'de çalışır.

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

