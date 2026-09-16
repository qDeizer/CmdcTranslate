# Snake mini oyunu

Tek, kendi kendine çalışan `index.html` dosyası oluştur. Dış bağlantı, npm
bağımlılığı, font indirme veya build adımı olmasın. JavaScript Canvas kullan.
Oyun kodunu Claude Code araçlarıyla sen yaz; host yalnız sonuçları test edecek.

## Oynanış

- 20 × 20 hücreli kare oyun alanı. Yılan, yem, skor ve en iyi skor.
- Başlat / yeniden başlat, duraklat / devam et düğmeleri; Türkçe kısa metinler.
- Ok tuşları veya WASD yönlendirme, Space duraklatma. Mobil yön düğmeleri.
- Ters yöne dönüşü ve aynı tick içinde iki tuşla ters dönüş yapılmasını engelle.
- Yem sadece boş hücrede doğsun; yem yiyince yılan büyüsün ve skor artsın.
- Duvar ve gövde çarpışmasında oyun bitsin. Hareketle boşalacak kuyruğa adım
  atmak, büyüme yoksa yasal olsun. Alan dolarsa oyun kazanılsın.
- Başlangıç / çalışıyor / duraklatıldı / oyun bitti / kazandı durumları okunur
  bir DOM durum metninde görünsün. Yeniden başlat eski timer'ı bırakmasın.
- Sayfa arka plana geçince otomatik duraklat. Tuşlar sayfayı kaydırmasın.
- En iyi skoru localStorage'a yaz; localStorage engelliyse oyun çalışmaya devam etsin.

## Görünüm

Astra'nın koyu lacivert ve cyan/mint renklerini koru: #07101c arka plan,
#0d1828 yüzey, #52d3ff yılan/eylem, #55d6a8 başarı, #ff6b6b çarpışma/yem.
Ana içerik oyun tahtası olsun; pazarlama başlığı, dashboard veya dekoratif kart
kalabalığı ekleme. Küçük üst skor satırı, büyük kare tahta, alt kontroller yeterli.
Sistem fontu ve skorlar için monospace. 390 px mobilde yatay taşma olmasın.
Kontrollerin label/focus/hover/disabled durumları, Canvas için erişilebilir ad
ve oyun talimatları olsun. Oyun başlamadan tahta ve düğmeler görünsün.

## Kontrol

Saf oyun mantığını inline bir `<script id="engine">` bölümünde `createGame`
fonksiyonuyla tut; UI başka inline script'te bunu gerçekten kullansın.
`verify.mjs` Node standart kütüphanesiyle gerçek engine script'ini okuyup VM'de
çalıştırsın. Uygulamayı taklit eden test kopyası yazma.
Anlamlı kontroller: hareket, ters dönüş, hızlı iki giriş, büyüme/skor,
boş hücrede yem, duvar/gövde çarpışması, kuyruğa adım, alan dolunca kazanma,
pause/resume ve restart. Kontrollerin hepsini `node verify.mjs` ile çalıştır.
Dosya veya kullanıcı verisi silme. Yalnız bu dizindeki BRIEF.md, index.html,
verify.mjs ile çalış; üst dizinleri okuma veya değiştirme.
