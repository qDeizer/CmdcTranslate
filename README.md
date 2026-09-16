# Astra1 · Command Code native bridge

**Çalışan yerel servis.** Claude Code ve Codex CLI üzerinden metin, araç hatası →
düzeltme → sonuç ve araçtan gelen görsel döngüleri canlı olarak doğrulandı.

Claude'un Anthropic Messages ve Codex'in OpenAI Responses isteklerini
Command Code **/alpha/generate** endpointine, CLI 1.54.0'ın native zarfıyla taşır.
Tek servis, yedi runtime modülü, sıfır npm bağımlılığı.

## Başlat

Node 22 veya üstü gerekir. Bu makinede Node 24.19.0 ile test edildi.

Windows'ta `start.bat` dosyasına çift tıkla. Servis başlar ve hazır olduğunda
ayar paneli tarayıcıda açılır. Servis zaten açıksa mevcut panel açılır.
Servisi çalıştıran terminal penceresini açık tut.

~~~powershell
Set-Location C:\Users\Emre\Desktop\Taha\Astra1
npm.cmd start
~~~

Servis: **http://127.0.0.1:8742**

Bu adres aynı zamanda yerel **Astra Console** ayar ekranıdır. Buradan Command
Code API anahtarını, upstream modeli, Claude/Codex model adlarını, maksimum çıktı
tokenını, çalışma dizinini, proje slug'ını ve native izin modunu ayarlayabilirsiniz.
“Bağlantıyı test et” gerçek ve kısa bir inference isteği gönderir.

Başlatıcı `config.local.json` dosyasını ve gateway/session secret'larını
`.astra-secrets.json` içinde oluşturur. Panelde girilen Command Code anahtarı da
bu yerel, git tarafından yok sayılan secret dosyasına yazılır ve arayüze geri
gönderilmez. Anahtar sırası kaydedilmiş secret dosyası, `COMMANDCODE_API_KEY`,
son olarak mevcut `~/.commandcode/auth.json` oturumudur. İlk bulunan anahtar
kaydedilir; sonraki açılışlarda UI'daki hesap korunur. Anahtar konsola yazılmaz.
Command Code hesabı ve endpoint erişimi gerekir.

Durdurmak için servis terminalinde Ctrl+C kullan.

## Claude Code veya Codex ile kullan

Servis açıkken başka bir terminalde:

~~~powershell
Set-Location C:\Users\Emre\Desktop\Taha\Astra1
npm.cmd run claude
# veya
npm.cmd run codex
~~~

Tek istek örneği:

~~~powershell
npm.cmd run claude -- -p "Bu projeyi kısaca açıkla."
npm.cmd run codex -- exec --skip-git-repo-check "Bu projeyi kısaca açıkla."
~~~

Başlatıcılar `.clients/` altında ayrı istemci profilleri kullanır. Paneldeki
Claude/Codex alias'larını ve çalışma dizinini her açılışta okur. Yerel gateway
anahtarını sürece verir; mevcut global Claude/Codex ayarlarını değiştirmez.
İstemciler PATH üzerinde bulunmalıdır.

Panelde **Claude Code başlat** veya **Codex başlat** düğmesi de kullanılabilir.
Kaydedilmemiş form önce uygulanır; seçilen çalışma dizininde görünür terminal
açılır. Model ve başlangıç effort değişiklikleri yeni açılan istemciye uygulanır.
UI'daki her model satırı bir istemci adı → Command Code model ID eşlemesidir.
Claude `/model` menüsü ve Codex modeli seçme listesi bu adlardan oluşturulur.
Her modelin effort tablosunda `default` (alan yok), `none`, `minimal`, `low`,
`medium`, `high`, `xhigh`, `max` ayrı eşlenir; `Gönderme` alanı çıkarır,
`Reddet` 422 verir. Yeni kurulum Muse için low/medium/high/xhigh desteğini,
başlangıçta low ve max → xhigh eşlemesini kullanır. `config.example.json`
tarihsel golden test profilidir; başlatıcı yeni kuruluma bu güncel ayarları ekler.

Panel hesabı `/alpha/whoami` ile doğrular. İstek tablosu gerçek upstream modelini,
istenen/gönderilen effort'u, süreleri, cache sayaçlarını ve trace'i gösterir.
Son 100 kayıt bellektedir; restart ile silinir. API key ve prompt içermez.

“Command Code model ID” gerçek bir açılır listedir. Panel her yüklenişte kayıtlı
anahtarla Command Code `whoami` çağrısı yapar; başarılı olursa pinned Command Code
CLI 1.54.0 `/model` kataloğundaki 75 geçerli ID'yi gösterir. Command Code API'de
hesap bazlı bir `/models` endpointi yoktur (`/models` 404); bu nedenle listedeki
her modeli tek tek çalıştırıp ücret üretmez. Bir modelin hesap/plan erişimi ilk
gerçek inference sırasında veya “Bağlantıyı test et” ile kesinleşir.

Varsayılan çalışma alanı Astra1'dir. Başka proje için panelde mutlak yolu ve
proje slug'ını kaydet. Başlatıcı bu dizinde çalışır.
Birden fazla proje eşzamanlı kullanılacaksa ayrı config/süreç/port gerekir.

## API

| Yol | İşlev |
|---|---|
| GET / | Yerel Astra Console |
| GET /healthz | Süreç sağlığı |
| GET /v1/models | Model alias'ları |
| POST /v1/messages | Anthropic JSON veya SSE |
| POST /v1/messages/count_tokens | Yaklaşık token sayısı |
| POST /v1/responses | OpenAI Responses JSON veya SSE |

Anthropic: x-api-key veya Bearer. Responses: Bearer.
Credential, .astra-secrets.json içindeki gatewayToken'dır.
Claude base URL servis kökü; Codex base URL servis kökü + /v1.

Varsayılan alias'lar `astra-muse` ve `claude-astra-muse`; varsayılan upstream
`meta/muse-spark-1.3-contributor` modelidir. Panelden değiştirilebilir. Yanıt
model alanında istenen alias korunur.

~~~mermaid
flowchart LR
  A[Claude · Messages] --> C[Astra1]
  B[Codex · Responses] --> C
  C --> D[Command Code · alpha/generate]
  D --> E[NDJSON doğrulama]
  E --> F[JSON veya SSE]
  F --> A
  F --> B
~~~

Metin, araç argümanları, call ID, sonuç metni ve kullanım sayıları korunur.
Araçları istemci çalıştırır. Tool içindeki görseller native user bloğuna taşınır.
Reasoning ayrı içerik olarak iletilir. Başarı yalnız doğrulanmış finish ve akış
sonundan sonra bildirilir.

## Testler

~~~powershell
npm.cmd test
npm.cmd run test:long
npm.cmd run check:foundation
~~~

Canlı testler mevcut Command Code hesabını kullanır ve inference tüketir:

~~~powershell
npm.cmd run test:api
npm.cmd run test:claude
npm.cmd run test:codex
node scripts/smoke-clients.mjs claude image
node scripts/smoke-clients.mjs codex image
~~~

Kanıt: [evidence/release.md](evidence/release.md) ve
[evidence/ui-release.md](evidence/ui-release.md).
50 kısa test geçti; önceki 310 saniye sessizlik testi kanıtı korundu. İki CLI'da hatalı dosya okuma,
başarılı okuma ve son cevap; iki CLI'da araç görseli; altı canlı API vakası doğrulandı.

## Uyumluluk sınırları

- Test edilen istemciler: Claude Code 2.1.272 ve Codex CLI 0.154.0-alpha.6.2.
  Desktop/VS Code uygulama içi bağlantıları ayrıca test edilmedi.
- Native thinking imzasızdır. Claude Code bu akışı kabul etti; bridge
  Anthropic signature üretmez. İmza zorunlu başka istemciler için garanti verilmez.
- Codex başlatıcısı function/shell araç profili kullanır; freeform apply_patch,
  OpenAI hosted web search ve Apps kapalıdır. Namespace içindeki function araçları
  API adaptöründe desteklenir. Bağımsız custom/freeform, hosted araçlar,
  previous_response_id, compaction ve JSON-schema output açık 422 döner.
- Claude'un isteğe bağlı JSON-schema başlık üretme çağrısı 422 alabilir; ana
  konuşma devam eder. Token sayacı tahminidir. Pause continuation canlı kanıt
  bulunmadığından kapalıdır.

## Geliştirme

### Streaming, oturum ve cache kontrolü

[15 Eylül ölçümü](evidence/continuity-release.md): gerçek Claude CLI ile metin
parçaları bridge'den en fazla 1 ms sonra SSE'ye, 8 ms içinde CLI çıktısına ulaştı.
Metinden önce uzun bekleme upstream'de gözlendi. Tool argümanları terminal
tool-call doğrulanana kadar tamponlanır; dosya/tool JSON çıktısı tek parça görünebilir.
Önceki Snake harness'i metin parçalarını sayar, terminale anlık yazdırmaz.

Sunucu terminalindeki `metrics` her inference'ın süre/cache sayaçlarını ve
konuşma bağını gösterir. Eksik cache sayacı `null` olur. Aynı konuşmanın
session/thread kimliği artık servis restart'ında ve idle TTL sonrasında da korunur
(aynı secret/hesap/workspace ile). `conversation` trace modu aynı konuşmaya
aynı W3C trace ID, her isteğe ayrı span gönderir; `request` modu her istekte
yeni trace kullanır. Hint yoksa her istek bağımsızdır. Command Code panelinde
üç Claude ve üç Codex isteğinin kendi konuşmaları altında aynı trace ile ayrı
ücret satırları olarak göründüğü doğrulandı.

Güncel [model/trace/cache raporu](evidence/routing-release.md): Claude son metni
4,252 saniyede başladı, 89 parça 4,039 saniyeye yayıldı. Başlangıç effort'u low.
Bu tek koşu hız garantisi değildir. Son Codex isteğinde 3182 input'un 2801'i
cache'den okundu; cache miss sıfırlanmış değildir. Dashboard kayıtları kullanıcı
gözlemine göre 3–4 dakika gecikebilir; eski satırların cache ayrıntısı bulunmuyor.

`node scripts/probe-continuity.mjs after` kayıtlı deizermonokixhtf hesabı ve Muse
modeliyle ücretli, üç istek hedefleyen salt-okuma Claude testi çalıştırır.
Kanıt dosyası içerik/kimlik yerine süre, sayı ve eşitlik bilgisi tutar.

[ARCHITECTURE.md](ARCHITECTURE.md) · [CONTRACTS.md](CONTRACTS.md) ·
[contracts.d.ts](contracts.d.ts) · [IMPLEMENTATION.md](IMPLEMENTATION.md) ·
[ACCEPTANCE.md](ACCEPTANCE.md) · [SOURCES.md](SOURCES.md)

İlk mimari incelemenin [baseline kaydı](evidence/baseline.json) tarihsel olarak
korunur; içindeki NOT_RUN değerleri ilk teslim zamanına aittir.

