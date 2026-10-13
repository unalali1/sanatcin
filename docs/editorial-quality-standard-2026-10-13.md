# SanatÇin editoryal kalite standardı — 13 Ekim 2026

## Hedef
İlk otomatik yayında akıcı Türkiye Türkçesiyle yazılmış haber, anlamlı spot ve yayımdan sonra başlık değiştirme gereği doğurmayan güçlü başlık. İlk ölçülebilir hedef: yayımlanan haberlerin en az %90'ının 24 saat içinde manuel başlık düzeltmesi gerektirmemesi. Bu bir **hedef**, henüz ölçülmüş sonuç değildir.

## Gerçek referanslar
`worker/src/editorial-examples.js` dosyasındaki 5 eski/yeni başlık, WordPress'teki 13 Ekim 2026 revisions kayıtlarından doğrulanmıştır. Spotlar ve kayıtlı giriş paragrafları gün sonunda onaylanan sürümlerdir. Bunlar yalnız **üslup ve karar örneği** olarak gösterilir; başka habere ait isim, olay ve tarihler yeni habere taşınmaz.

## Yayın ilkeleri
1. Haber fişi, kaynak metin ve doğrulanmış tarih/özel adlar doğruluk sınırıdır. Değişmeyen doğruluk kuralları sert koşuldur, diğer puanlardan telafi edilemez.
2. Başlıkta en az üç farklı yaklaşım üretilir (ana gelişme, ayırt edici somut unsur, bağlamsal/kültürel açı). “Üç farklı kelime sıralaması” üç yaklaşım değildir.
3. Başlık editörü ilk üretici değil, ayrı bir değerlendirme çağrısıdır. Ağırlıklar: doğruluk %30; haber değeri %25; doğallık %20; okur ilgisi %15; açıklık/kısalık %10. Model puanı yalnız editoryal sinyaldir, otomatik doğruluk garantisi değildir.
4. Kazanan başlık olgu fişine, kişi/yer/sayı korunmasına, başlık kalıp denetimine ve nihai seçimin gerçekten sunulan başlıklardan biri olmasına bağlıdır. Başlık editörü başarısızsa doğrulanmış mevcut başlık korunur; bariz sorun çözülemiyorsa aday yayına çıkmaz.
5. Spot, girişteki tüm cümleyi yinelemez. Gövde olayın önemini ilk iki cümlede anlatır; kültür-sanat bağlamında teknik ayrıntılar haberin önüne geçmez.
6. Son yapısal onarım, bağımsızca seçilmiş güçlü başlığı zayıflatamaz.
7. Gövde akıcılığına ilişkin mekanik puan semantik bir doğruluk ölçüsü değildir. Denetim notları editoryal bağlamda yorumlanır; yanlış pozitif üreten kalıplar körlemesine yasaklanmaz.

## Ölçüm ve yayın güvenliği
Yeni mekanizma deneme modunda canlı yayın yapmadan kaynak-olgu-haber akışında çalıştırılmalı. Referans vakalarda olgu değiştirme, başlık gerilemesi, editoryal düzeltme sıklığı, ilave AI çağrısı ve toplam süre kaydedilmeli. İki kod PR'si testlerden geçmeden `main` veya Railway production dağıtımına alınmamalı.
