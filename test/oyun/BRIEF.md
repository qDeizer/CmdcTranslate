# 2048 mini oyunu (test/oyun)

Tek, kendi kendine çalışan `index.html` dosyası oluştur. Dış bağlantı, npm
bağımlılığı, font indirme veya build adımı olmasın. DOM + CSS grid kullan
(Canvas şart değil). Oyun kodunu sen yaz; host yalnız sonuçları test edecek.

## Oynanış

- 4 × 4 kare oyun alanı. Taşlar: 2, 4, 8 ... 2048.
- Başlangıçta 2 taş, her başarılı hamleden sonra boş hücrede 1 yeni taş (%90 = 2, %10 = 4).
- Ok tuşları veya WASD ile kaydır; kayan taşlar duvara yaslanır, eşit komşular birleşir.
- Her satır/sütunda birleşme hamle başına tek kez olur (4+4+4+4 → 8+8, 16 değil).
- Hareketsiz hamlede (hiçbir taş kıpırdamadı/birleşmedi) yeni taş doğmaz, skor artmaz.
- Skor = birleşen değerlerin toplamı. En iyi skor localStorage'da.
- 2048 taşına ulaşınca kazanılır. Hamle kalmayınca (boş hücre yok + komşu eşit yok) oyun biter.
- Yeni Oyun / Yeniden Başlat düğmesi; Türkçe kısa metinler.
- Hazır / oynanıyor / kazandı / bitti durumları okunur bir DOM durum metninde görünsün.
- Tuşlar sayfayı kaydırmasın. Dokunmatik kaydırma (swipe) desteği olsun.
- En iyi skoru localStorage'a yaz; localStorage engelliyse oyun çalışmaya devam etsin.

## Görünüm

Astra'nın koyu lacivert ve cyan/mint renklerini koru: #07101c arka plan,
#0d1828 yüzey, #52d3ff eylem, #55d6a8 başarı, #ff6b6b bitiş.
Ana içerik oyun tahtası olsun; pazarlama başlığı, dashboard veya dekoratif kart
kalabalığı ekleme. Küçük üst skor satırı, büyük kare tahta, alt kontroller yeterli.
Sistem fontu ve skorlar için monospace. 390 px mobilde yatay taşma olmasın.
Kontrollerin label/focus/hover/disabled durumları ve oyun talimatları olsun.
Oyun başlamadan tahta ve düğmeler görünsün.

## Kontrol

Saf oyun mantığını inline bir `<script id="engine">` bölümünde `createGame`
fonksiyonuyla tut; UI başka inline script'te bunu gerçekten kullansın.
`verify.mjs` Node standart kütüphanesiyle gerçek engine script'ini okuyup VM'de
çalıştırsın. Uygulamayı taklit eden test kopyası yazma.
Anlamlı kontroller: sola/sağa/yukarı/aşağı hareket, tek-sefer birleşme,
hareketsiz hamlede taş doğmaması, skor, boş hücrede taş, oyun bitimi,
kazanma, restart. Kontrollerin hepsini `node verify.mjs` ile çalıştır.
Dosya veya kullanıcı verisi silme. Yalnız bu dizindeki BRIEF.md, index.html,
verify.mjs ile çalış; üst dizinleri okuma veya değiştirme.
