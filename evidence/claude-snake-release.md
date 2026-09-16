# Claude Code · Snake canlı testi

15 Eylül 2026. Oyun kodu ve oyun kontrol dosyası Claude Code CLI 2.1.272
tarafından gerçek araç çağrılarıyla oluşturuldu.

| Kontrol | Kanıt |
|---|---|
| Hesap | `GET /alpha/whoami` → `deizermonokixhtf` |
| Model | Gerçek outbound body: `meta/muse-spark-1.3-contributor` |
| Anahtar | Her outbound Authorization, doğrulanmış hesap anahtarıyla eşleşti; değer kaydedilmedi |
| Endpoint | `https://api.commandcode.ai/alpha/generate` |
| Native akış | Gerçek outbound `params.stream=true` ve NDJSON delta olayları |
| Claude akışı | `stream-json / include-partial-messages`; 26 metin deltası |
| Araç döngüsü | Read × 4, Bash × 5, Edit × 4; 13 araç sonucu |
| CLI sonu | Exit 0, is_error=false, SNAKE_DONE |
| Oyun mantığı | Bağımsız `node verify.mjs`: 52 kontrol geçti |
| Tarayıcı | Başlat, Space pause, devam, duvar çarpışması ve restart doğrulandı |
| Mobil | 390 × 844; yatay taşma yok, Canvas kare, yukarı düğmesiyle gerçek hareket |
| Konsol | JavaScript uyarı/hata sayısı: 0 |

Tamamlanan oyun koşusu: **15:21:15 – 15:26:01 Türkiye saati**, 14 upstream
istek. Demo için aynı Astra1 runtime'ı ayrı loopback süreçte ve yalnız
`demos/snake` çalışma diziniyle kullanıldı. Ana panel profili değiştirilmedi.

İlk koşu shell çağrılarını tekrarladığı ve oyun üretmediği için durduruldu;
`claude-snake-attempt1.json` başarısız kaydı korunuyor. Tamamlanan koşuda bir
setup çağrısı izin reddi aldı, bir oyun testi başarısız oldu; Claude bunları
işleyip düzeltmeden sonra testi başarıyla çalıştırdı.

Ham `claude-snake.json` içindeki aggregate=false eski gate'in özel Write aracı
ve sıfır izin reddi istemesinden kaynaklanır. Gerçek dosya yazımı Edit ile
yapıldı. `scripts/check-snake.mjs` hesap/model/akış, başarıyla biten CLI ve
üretim engine testini bağımsız olarak kontrol eder; hataları saklayan sonuç
`claude-snake-verified.json` içindedir.

Oyun: `demos/snake/index.html`. Dış bağımlılığı yoktur.
Canlı önizleme: `http://127.0.0.1:8743/index.html`.
