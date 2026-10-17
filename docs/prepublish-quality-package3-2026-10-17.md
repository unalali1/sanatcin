# Paket 3 — yayın öncesi kalite güvencesi

17 Ekim 2026. Bu dal yalnız kod ve izole test aşamasıdır; production'a dağıtılmadı. Paket 1 ve Paket 2 üretimdeki davranışın tabanıdır.

## Teknik değişiklik

| Alan | Uygulama ve karar |
|---|---|
| A — zorunlu doğruluk | Son taslakta kaynak URL'si HTTP(S) olmalı. Başlık, spot veya gövdedeki rakamla yazılmış sayı kaynak metni/olgu fişinde bulunmuyorsa, doğrulanmış tam kişi adında tek harf kayması varsa veya Oscar başvuru hakkı adaylığa dönüştürülmüşse `QUALITY_FACT` ile yayın durur. Kod sayı veya adı tahminle düzeltmez. Kaynak bağlantısını WordPress'e taşıyan mevcut kod korunur. |
| B — Türkçe ve editoryal kalite | Paket 2'nin bağlamsal bulguları, mevcut yapısal kontroller ve akıcılık eşiği son metinde birlikte sınıflanır. `major` bulgular mevcut sınırlı hedefli onarımdan sonra sürerse haber durur; `minor` bulgular logda görünür, tek başına engel değildir. Önce A, sonra B değerlendirilir. |
| Taslak geri dönüşü | Paket 1'in hakem ve olgu onarımı korunur. Başarısız onarım eski taslağı otomatik başarılı ilan etmez; son kapı kalan sorunu yeniden denetler. Normal akışa yeni model aşaması eklenmedi. |
| Görseller | Mevcut indirme ve ikili görsel değerlendirmesinde aynı bayt SHA-256'sı veya aynı kaynak dosyanın boyut varyantı yinelenirse seçimden çıkarılır; farklı sahne fotoğrafları korunur. Mevcut görsel değerlendirme istemi portre ile performans karesini ve altyazı iddiasını ayırmayı ister. Gövdeye eklenecek HTML'de yinelenen fotoğraf veya kaynak bölümünden sonra kalan görsel varsa ek görseller yazılmaz. Daha az paragraf olması hâlinde görsel kaynak bölümünün önüne yerleştirilir. |
| Günlük rapor | Var olan JSON logundaki `SanatÇin editör raporu` olayına `editorialQuality` alanı eklendi: işlenen aday, kapıdan geçen, yeniden yazılan başlık, giderilen mekanik bulgu, doğruluk nedeniyle duran, editöre yönlendirilen, ayıklanan görsel ve taslak kararı/gerekçesi. Yeni servis veya tablo yok. |

Doğruluk kapısının kanıt sınırı açık: Olgu fişinin kendisi yanlışsa, rakamlar sözcükle yazılmışsa veya iki farklı cümle aynı rakamları kullanıp farklı olayı anlatıyorsa salt belirlenimci kontrol bunu güvenilir biçimde çözemeyebilir. Eser, festival ve kurum adlarının anlamına ilişkin tüm sapmaları semantik olarak doğruladığını iddia etmiyoruz. Mevcut olgu çıkarımı ve son editör yönergeleri bu kapsamın geri kalanını ele alır; yüksek riskli kuşku editöre bırakılır. Görselde farklı sıkıştırmayla ve farklı URL/adla yayımlanmış aynı fotoğrafı SHA ve URL tek başına kesin yakalayamaz; mevcut görsel değerlendirmesinin benzerlik ve tamamlayıcılık kararına dayanır.

## Önce/sonra ölçümü

30 ayrı haberin 12–17 Ekim'deki ilk yayın metinleri üzerinde yalnız **B aşamasının çevrimdışı gölge denetimi** yapıldı. El redaksiyonları katılmadı. Paket 2'de 4/30 metinde onarım bulgusu vardı; Paket 3'ün birleşik B denetimi 6/30 işaretledi. Ek iki metin (1130, 1134) doğrulanmış Çince ad fişleri arşivde bulunmadığı için **belirsizdir**, doğrulanmış yeni hata sayılmamalıdır. Bu oranlar yeni haber üretiminin kalitesini ölçmez. Ayrıntı ve kimlikler `prepublish-quality-audit-2026-10-17.json` dosyasındadır.

**A aşaması için tarihsel başarı yüzdesi hesaplanmadı.** İlk WordPress revizyonlarında o günkü özgün kaynak gövdesi ve olgu fişi birlikte tutulmadığından kaynak sadakatini bu arşivden sayısallaştırmak dürüst olmaz. İzole sentetik regresyonlar uydurulan sayı, kişi adı, Oscar adaylığı ve geçersiz URL'yi durdurdu. Akıcı fakat kaynak dışı *sayısal olmayan* yorum hâlâ risk olabilir. Beş gerçek haberin başlık/giriş/paragraf karşılaştırması Paket 2 raporunda insan redaksiyonu olarak etiketlidir; yeni model çıktısı değildir.

## Test ve maliyet

`cd worker && npm run check && npm test` ile Paket 1–2 ve yeni testler birlikte çalıştırılır. Yeni senaryolar: akıcı ama yanlış sayılı başlık; mekanik ama olgusal başlık; kaynak dışı sayılı akıcı gövde; hakemin gerekçesiz üslup reddi; aynı fotoğrafın farklı dosya adı/ölçüsü; ciddi hatanın son kapıda durması; olgu çıkarımı API hatası; küçük üslup farkı; kaynak bölümünden sonraki görsel. WordPress'e yayın yapan canlı uçtan uca test çalıştırılmadı.

Yeni A/B denetimi **0 ilave LLM çağrısı** yapar; normal haber yolunda ek API maliyeti yoktur. Mevcut ikincil görsel değerlendirme istemine bir kısa yönerge eklendi. Tekrar çıkan fotoğrafın yerine başka aday arandığında mevcut `SECONDARY_IMAGE_REVIEW_LIMIT` (üst sınır 10) içinde ek bir mevcut görsel değerlendirme çağrısı olabilir. Gerçek tutar, kullanılan model ve token kayıtlarına bağlıdır; elde fiyat/token kaydı olmadan dolar tahmini üretilmedi. Mekanik sorun saptandığında mevcut koşullu metin onarımı daha sık tetiklenebilir; sınırı mevcut iş akışı belirler.

## Günlük rapor örneği

Aşağıdaki olay **temsili bir şema örneğidir**, 17 Ekim üretim ölçümü değildir:

```json
{
  "message": "SanatÇin editör raporu",
  "attempted": 3,
  "published": 1,
  "editorialQuality": {
    "candidatesProcessed": 3,
    "articlesPassed": 1,
    "headlinesRewritten": 1,
    "mechanicalExpressionsCorrected": 2,
    "sourceAccuracyStopped": 1,
    "editorReferrals": 1,
    "duplicateImagesRemoved": 1,
    "draftDecisions": [{ "articleUrl": "https://example.org/arts/film", "selected": "polished_or_repaired", "reason": "style_override", "remainingIssues": [] }]
  }
}
```

## Geri alma ve dağıtım riski

Ana dala alınmadan dal/PR kapatılarak geri dönülebilir. Sonrasında bir sorun görülürse tek Paket 3 merge commit'i `git revert` ile geri alınır; mevcut WordPress şeması ve servis ayarı değişmediği için veri göçü gerekmez. Gövdeye eklenen görsellerden önceki yayımlar geriye dönük düzenlenmez.

Canlıya geçişin ana riski yanlış olumlu olgu fişi veya yazımla farklı gösterilmiş sayı yüzünden haberin durmasıdır. Çince ad fişi eksikliği nedeniyle tarihsel örneklerde iki belirsiz uyarı görüldü; gerçek günlük olgu fişiyle gözlenmelidir. İlk dağıtımın ardından yalnız loglardan `QUALITY_FACT`, `QUALITY_LANGUAGE`, editöre yönlendirme, yayın adedi ve görsel ayıklama sayıları izlenmeli; yayın yapan gerçek uçtan uca test çalıştırılmamalıdır. Production'a geçiş için kullanıcı onayı beklenir.
