# Astra1 · çalışan CLI sürümü doğrulaması

Güncel ek: [model/effort, trace ve cache doğrulaması](routing-release.md).
Bu dosyanın aşağısı ilk çalışan CLI sürümünün tarihsel kanıtıdır.

Tarih: 15 Eylül 2026. Runtime: Node 24.19.0, Windows x64.
Native referans: Command Code CLI 1.54.0.
Upstream: https://api.commandcode.ai/alpha/generate.
Model: meta/muse-spark-1.3-contributor.

**Sonuç:** Yerel runtime ve teslim edilen Claude/Codex CLI profilleri çalışıyor.
Geniş RELEASE_READY etiketi verilmedi: uygulama içi GUI, gerçek CLI uzun iptal
ve taze native CLI capture kapıları aşağıda açık gösteriliyor.

## Gerçek test sonuçları

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| Kısa offline testler | 42 test; sıfır skip | npm test; native/adapters/server/compatibility |
| F35 gerçek süre | PASS; 310.074 saniye | npm run test:long; gerçek 310 s upstream sessizliği, heartbeat, response.completed |
| Dört eşzamanlı canlı API isteği | PASS | [api-smoke.json](api-smoke.json) |
| İki protokol JSON + SSE metin | PASS; ASTRA_OK; geçerli terminal/usage | [api-smoke.json](api-smoke.json) |
| İki protokol kullanıcı görseli | PASS; kırmızı fixture → RED | [api-smoke.json](api-smoke.json) |
| Claude Code 2.1.272 | PASS; hata → dosya okuma → ASTRA_TOOL_OK, 3 native inference turu | [claude-error-then-read.json](claude-error-then-read.json) |
| Codex CLI 0.154.0-alpha.6.2 | PASS; hata → dosya okuma → ASTRA_TOOL_OK, 3 native inference turu | [codex-error-then-read.json](codex-error-then-read.json) |
| Claude araç görseli | PASS; Read → image tool_result → RED | [claude-tool-image.json](claude-tool-image.json) |
| Codex araç görseli | PASS; view_image → input_image/high → RED | [codex-tool-image.json](codex-tool-image.json) |
| High effort native reasoning | PASS; 86 karakter reasoning delta, gerçek imza yok | [native-probe.json](native-probe.json) |
| Foundation bütünlüğü | PASS; 7 belge, 12 sentetik vaka, 18 kaynak baseline | npm run check:foundation |
| Son runtime + npm başlatıcıları | PASS; port 8742 üzerinden iki istemcide ASTRA_LAUNCH_OK | npm run claude ve npm run codex, 11:24 UTC |

CLI testleri yalnız doğrulama için çalıştırılmış gerçek istemci süreçleridir.
Kod yazma işi başka agent'a devredilmedi. Gateway'in başarılı istekleri,
istemciye dönen son metin ve sonraki turdaki tool sonucu beraber kontrol edildi.
Sadece konsolda token görülmesi başarı sayılmadı. Raporlarda key/prompt/raw
tool sonucu veya görsel byte'ı yok; yapı, bool sonuçları ve config hash'i var.

## Canlı denemelerin düzelttiği varsayımlar

1. Boş native config HTTP 400 alıyor. Dokuz zorunlu ortam alanı başlatıcıda
   gerçek yerel bilgilerden dolduruldu.
2. Node fetch, 300 saniye gövde sessizliğinde bağlantıyı kesiyordu. Upstream
   node:http(s) ile değiştirildi; kendi header/idle/tail timer'ları kullanılıyor.
   İlk F35 başarısız, düzeltme sonrası gerçek süreli koşu başarılı.
3. Muse high effort ile reasoning metni üretiyor. Önceki “görülmedi” bilgisi
   yetersizdi. Metin ayrı reasoning/thinking olarak aktarılıyor; imza üretilmiyor.
4. Claude global settings provider env değerlerini override ediyordu.
   İlk başarılı görünen fakat Astra1'e hiç gelmeyen deneme kabul sayılmadı.
   İzole CLAUDE_CONFIG_DIR ve komut kapsamlı ayar dosyası kullanıldı.
5. Codex izole profilde Windows sandbox ayarı olmadığından read-only komutu
   reddetti. Unelevated Windows sandbox ayarlandı; read-only testi korundu.
6. Claude metadata/cache/system uzantıları ve Codex client_metadata/include
   alanları açıkça tanımlandı. Görsel tool-result promotion ve detail=high
   byte aktarımı iki gerçek istemciyle doğrulandı.

Bir Claude read testi göreli yol ile başarısız oldu; test mutlak Windows dosya
yollarıyla tekrarlandı ve gerçek tool sonucu + son metin birlikte doğrulandı.
Bu kayıt bir modelin her görevi deterministik çözmesi garantisi değildir.

## Kabul kapıları

| Kapı | Durum |
|---|---|
| L01 endpoint + text | İki CLI, PASS |
| L02 üç inference turunda tool döngüsü | İki CLI, PASS |
| L03 tool hata sonucu | İki CLI, PASS |
| L04 dört konuşma | API seviyesinde iki protokol birlikte PASS; client subagent NOT_RUN |
| L05 iptal/uzun inference | HTTP transport testi PASS; gerçek CLI uçtan uca uzun/iptal NOT_RUN |
| L06 görsel | API user image ve iki CLI tool image PASS; GUI screenshot akışı NOT_RUN |
| L07 Desktop / VS Code | NOT_RUN |
| L08 native CLI karşılaştırması | Pinned statik kaynak + sentetik golden PASS; yeni CLI egress capture NOT_RUN |
| L09 istemci payload'ları | Teslim edilen profillerde ana tool/görsel akışı PASS; aşağıdaki özellikler açıkça destek dışı |
| L10 model capability | Muse high + reasoning/history PASS; pause canlı NOT_RUN ve kapalı |

## Bilinen sınırlar

- Anthropic thinking imzasız gateway uzantısıdır. Claude Code 2.1.272 kabul
  etti; resmi Anthropic signed thinking bütünlüğü ile eşdeğer değildir.
- JSON-schema output desteklenmez. Claude'un isteğe bağlı konuşma başlığı
  oluşturma isteği bu nedenle 422 alabiliyor; ana inference akışı devam ediyor.
- Codex profili freeform apply_patch kullanmaz; function/shell araçlarıyla
  çalışır. Hosted web search ve Apps başlatıcıda kapalıdır. Namespace function
  mapper'ı offline doğrulandı; bütün harici Apps servisleri test edilmedi.
- Compact, previous_response_id, hosted araçlar, custom grammar, stream dışı
  native fallback ve upstream otomatik POST retry yok.
- count_tokens tahminidir. Görseller native provider'ın vision davranışına
  tabidir; OpenAI high detail token bütçesi taklit edilmez.

İlk mimari teslimin baseline.json dosyası değiştirilmedi. Oradaki NOT_RUN
alanları tarihsel durumu gösterir; güncel sonuç bu dosyadır.
