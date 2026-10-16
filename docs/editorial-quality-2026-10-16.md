# Editoryal dil geliştirmesi — 16 Ekim 2026

**Durum: kullanıcı 16 Ekim 2026 tarihinde GitHub gönderimine ve canlıya geçişe açık onay verdi.** Gerçek üretim modeliyle 10 haberlik yeniden üretim testi erişim nedeniyle henüz çalıştırılmadı; bu sınır kullanıcıya onay öncesinde bildirildi. Temel sürüm `d9aec13a0a82de581c00a2e1efa73d89fd426c97`.

12–16 Ekim tarih filtresiyle 28 WordPress yayını salt okunur incelendi. Kaynakları ayrıca açılan 10 örnek: 1287, 1284, 1276, 1269, 1252, 1249, 1243, 1240, 1232, 1172. WordPress tarihleri site verisidir; UTC varsayımı yapılmadı.

## Değişiklik ve sınır

- `worker/src/translate.js`: olgu çıkarımında sayı-birim/olay-zaman eşleştirmesi; başlıkta örnek listesini toplam sanmama; son okumada güçlü metni koruma. Mevcut üç başlık, modeller, API istek yapıları ve karar akışı korunur.
- `worker/src/editorial-review.js`: yalnız `NEWSROOM_REVIEW_GUIDANCE` metnine üç talimat eklenir; kural listesi, eşikler ve fonksiyonlar aynı kalır.
- `worker/dev/editorial-observation.mjs`: bağımsız, isteğe bağlı 30/25/25/10/10 ağırlıklı ölçüm. Kaynak veya geçerli ölçüt eksikse toplam `null`; zaman aşımı/hata yayın kararına dönüştürülmez. Model puanı doğrulama kanıtı sayılmaz.
- `worker/dev/editorial-replay.mjs`: mevcut model kimliklerini açıkça gerektiren yerel karşılaştırma aracı. Üretim giriş noktası veya WordPress modülü çağırmaz; hiçbir yayın yapmaz. 1–10 kaynak üzerinde mevcut çeviri hattını çalıştırır. Mevcut hattın sosyal metin üretim çağrısı çalışabilir ama hiçbir sosyal paylaşım yapılmaz. Her başarıyla üretilen haber için iki ayrı gözlem çağrısı ekler; bunlar yalnız test maliyetidir.
- `worker/test/editorial-observation.test.js`: ölçüt, sınır, zaman aşımı, hata ve içerik yalıtımı testleri.

Gözlem bileşeni üretim akışına **bağlanmadı**. Bu bilinçli ayrım yayın kapasitesini ve maliyeti korur. Canlı gözlem entegrasyonu bu PR kapsamı dışında ayrıca değerlendirilmelidir. Mevcut 600 karakter gövde / 32–82 karakter başlık sınırları ve eski yayın kapıları da korunur; kısa haberleri gereksiz uzatma riski raporlandı ama kapsam gereği değiştirilmedi.

## Kaynak denetiminden somut bulgular

| ID | Bulgu | Kaynak |
|---|---|---|
| 1287 | 30’dan fazla hikâye, 30’dan fazla kişi diye aktarılmış. Üçüncü sezonun başlatılması, yayına girmesi değildir. | https://m.thepaper.cn/newsDetail_forward_34256477 |
| 1172 | Kaynak marka adı SHARDAA Studios; yayın Sharda Sharda diyor. Han dönemine ait buluntu, Han öncesi üretim diye sunulmuş. | https://radii.co/article/classic-chinese-carpet-making-in-modern-brands |
| 1240 | Kaynak üç filmi örnek veriyor; toplam programı üç filmle sınırlamıyor. Retrospektife alındı / film yayımlandı dili zayıf. | https://global.chinadaily.com.cn/a/202610/14/WS6acf3285e4b06d4aa0562c6a.html |
| 1252 | 518 tel yalnız tacın ön bölümüne ait. 18 Ekim sergi bitişi mevcut spotta var; girişte de görünür kılınabilir. | https://news.cgtn.com/news/2026-10-13/Ming-era-gold-crown-showcases-exquisite-craftsmanship-1Rd3Mb6QOHK/p.html |
| 1284 | Yerel ilk olma ve yaklaşık yaş korunmalı; mevcut başlık güçlü. | https://en.chinaculture.org/a/202610/15/WS6ad006e3e4b06d4aa0562d78.html |

## Doğrulama durumu

- 205 yerel test geçti (198 mevcut + 7 yeni); `npm run check` ve yeni araçların sözdizimi kontrolü geçti.
- 10 gerçek yayın için editör tarafından referans revizyonlar hazırlandı. Bunlar üretim modelinin yeni promptlarla oluşturduğu çıktılar **değildir**.
- Kaynaklarda görülen ad/sayı/kapsam hataları, mevcut dil sezgiseli 100/100 verse bile bulunabiliyor. Sezgisel skor ile kaynak sadakati ayrı raporlanmalıdır.
- Railway OAuth değişken değerlerini gizliyor. Yerelde üretim API anahtarı/model değerleri yok; araç tahminî bir modele geçmeyi reddediyor. Gerçek modelle 10 haberlik yeniden üretim, çağrı sayısı, gecikme ve üretim kapasitesi etkisi **doğrulanmadı**.
- Güncellenmiş promptlar semantik olarak farklı çıktı üretebilir. Değişmeyen akış ve geçen birim testleri, canlı yayın kapasitesinin değişmeyeceğinin kanıtı değildir.

## Güvenli sonraki adım

1. Mevcut üretim modeli ve kimlik doğrulamasının zaten erişilebilir olduğu, yayın yetkisi taşımayan yerel/test ortamında 10 kaynaklık JSON girdisini hazırlayın. Kaynak, önceki Türkçe metin, URL ve kategori saklanmalı.
2. `cd worker` ardından `node dev/editorial-replay.mjs /absolute/input.json /absolute/new-output.json` çalıştırın. `OPENAI_API_KEY`, `OPENAI_FACT_MODEL`, `OPENAI_EDITOR_MODEL` mevcut değerleriyle sağlanmalıdır; değerleri rapora veya Git’e yazmayın. Model çıktıları da gerçek kaynaklarla ayrıca editör tarafından kontrol edilmelidir.
3. Başlık/spot/gövde, bilgi kaybı/ekleme, retler, çağrı sayısı ve süreyi değerlendirin. Kaynak doğruluğunda gerileme varsa onay istemeden düzeltin.
4. Kullanıcıya somut sonuçları sunup canlıya geçiş onayını alın. Bu aşamadan önce `main`e merge veya Railway deployment yapılmamalı.
5. Onay sonrası ilk koşuyu izleyin. Aynı Railway projesinde beş hizmet bulunduğundan her birinin kaynak dalını ve merge etkisini dağıtımdan önce tekrar kontrol edin. Takvim veya hizmet yapılandırması değiştirmeyin. Geri alma, yalnız bu geliştirme commit’inin revert edilmesidir; sonraki çalışmaların üzerine eski sürüm yazılmamalı.
