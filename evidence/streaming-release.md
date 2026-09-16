# Streaming düzeltmesi · 16 Eylül 2026

## Değişiklik

- Client function `tool-input-start` ve her `tool-input-delta` artık hemen
  Anthropic/Responses SSE'ye çevrilir. Önceki sürüm tüm argümanları terminal
  `tool-call` olayına kadar bekletiyordu.
- Tamamlanma hâlâ terminal JSON ile deep-equal doğrulamasından sonra bildirilir.
  Paralel çağrılar call ID ile ayrılır; yarım/mismatch/ownership değişen çağrı
  başarılı veya çalıştırılabilir tamamlanmış çağrı olarak yayımlanmaz.
- Tool byte sınırı artık her parçada tüm birikmiş metni tekrar ölçmez; gelen
  parçanın byte sayısı toplama eklenir. Yeni bağımlılık yok.
- Metin/reasoning deltaları aynen aktarılır; native finish + metadata + EOF
  doğrulaması, backpressure, iptal ve sabit conversation trace korunur.
- Claude 2.1.273 etkileşimli terminalinde `unsupported_parameter (output_config)`
  yeniden üretildi. Başlatıcıdaki `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` ile
  yardımcı başlık isteği kaldırıldı: yeni oturumda iki başarılı tur, sıfır 422.
  Doğrudan JSON-schema talepleri destekleniyor gibi gösterilmez.
- Panel ilk içerik süresini ve hata alanını gösterir; araç/metin delta sayıları
  satır açıklamasındadır. Secret veya prompt loglanmaz.

## Ölçüm: upstream beklemesi ve köprü gecikmesi ayrı

`scripts/probe-streaming.mjs` aynı süreçte gerçek native byte olaylarını ve HTTP
SSE alıcısını zamanlar. Ham metin, argümanlar ve kimlikler kaydedilmez. Her delta
hash'i yalnız bellekte eşleştirilir; rapora sayı, eşitlik ve süre yazılır.

| Koşu | Çağrı | Native → HTTP alıcısı en yüksek gecikme | Sonuç |
|---|---:|---:|---|
| GLM eski sürüm | 4 | 13 ms | Başarılı; tool JSON zaten native tek parça |
| GLM yeni sürüm | 4 | 21 ms | Tüm parça sınırları/içerikleri eşit |
| Muse yeni sürüm | 4 | 1 ms | Tüm parça sınırları/içerikleri eşit |

Bu tekil koşular bir hız benchmark'ı veya yeni sürümün model üretimini
hızlandırdığı iddiası değildir. GLM ilk araç argümanı yaklaşık 16–24 saniyede,
Muse yaklaşık 10–11 saniyede geldi. Her iki model bu örneklerde tek native araç
deltası üretti. Çok parçalı tool'un erken iletimi, sonraki parçayı ancak istemci
öncekini aldıktan sonra gönderen gerçek HTTP regresyon testiyle kanıtlandı.
Köprü upstream'in henüz üretmediği tokenı göstermez, sahte kelime animasyonu yapmaz.

Her canlı iki-turlu konuşmada session/thread/trace eşit, span farklıdır. Sabit
prompt prefix'i bu kontrollü takip turlarında korunmuş; cache read sıfır olmayan
değerler gözlenmiştir. Gerçek CLI prefix'i kendi system/tool içeriği değiştiğinde
değişebilir; cache hit garantisi verilmez. Kullanıcının kayıtlı GLM seçimi korunur;
Muse karşılaştırması yalnız probe belleğinde yapıldı.

## Doğrulama

- `npm.cmd test`: 58/58; UTF-8, terminal/tail, kullanım, auth, oturum ve
  yeni iki parçalı/paralel tool HTTP regresyonları dahil.
- `npm.cmd run test:long`: 310 saniye native sessizlik, heartbeat, başarılı son.
- `npm.cmd run check:foundation` ve değişen JS dosyalarının syntax kontrolü.
- Gerçek etkileşimli Claude: başlık hatası önce üretildi, düzeltme sonrası iki
  tur başarıyla bitti; aynı trace doğrulandı.
- Gerçek Codex CLI 0.154.0-alpha.6.2: hatalı dosya okuma → başarılı okuma →
  beklenen son yanıt; üç başarılı native istek.
- Normal Claude batch tool testi: iki başarılı istek; ayrı inceleme kaydıdır.

Kanıtlar: [GLM eski](streaming-baseline.json), [GLM yeni](streaming-after.json),
[Muse yeni](streaming-after-muse.json), [etkileşimli Claude](claude-interactive-title.json),
[Codex araç döngüsü](codex-error-then-read.json), [Claude batch](claude-compat.json).
Kaynak karşılaştırmaları: [yerel router](research-local-streaming.md),
[GitHub referansları](research-upstream-streaming.md), [native audit](research-native-latency.md).

## Kullanım

`start.bat` köprüyü açar. Eski Claude oturumlarını kapatıp `npm.cmd run claude`
veya panelden yeniden başlatın; başlık düzeltmesi yeni istemci sürecine uygulanır.
Klasör ilk kez Git deposu oldu; eski çalışma ilk commit olarak korunmuştur.
Anahtar/config/istemci oturum dosyaları ve private test dizinleri Git dışında kalır.
