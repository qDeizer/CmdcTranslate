# Mimari kararı

## 1. Ürün ve eşitlik sınırı

Tek yerel HTTP servisi, iki istemci adaptörü, tek upstream. İlk referans model
`meta/muse-spark-1.3-contributor`; bu kimlik geçmiş capture'da görülmüştür,
bu hesapla 15 Eylül 2026 tarihinde canlı API ve iki CLI testinde doğrulanmıştır.

Claude tarafı Anthropic Messages, Codex tarafı Responses kullanır. Adaptörler
birbirine çağrı yapmaz. OpenAI Chat Completions bir ara format değildir.
Responses custom provider HTTP akışı ve WebSocket yeteneği ayrı konfigürasyonlardır;
ilk bağlantı HTTP/SSE olacak. [Resmi Codex ayarları](https://learn.chatgpt.com/docs/config-file/config-reference)

“CLI gibi” üç parçaya ayrılır:

| Boyut | Karar |
|---|---|
| Uygulama protokolü | Native başlık ailesi, zarf, alan optionality'si, NDJSON, tool adı ve terminal anlamı korunur |
| Çalışma içeriği | Claude/Codex'in system, history ve araçları kullanılır |
| Yerel agent işletimi | CLI'ın tool yürütücüsü, browser'ı, başlık üretimi ve telemetry'si bridge'e taşınmaz |

Bu bir paket/TLS parmak izi klonu değildir. Anahtar sırası, HTTP chunk sınırı,
rastgele response ID ve header harf büyüklüğü semantik eşitlik dışında kalır.
Enjeksiyonsuz çalışma, modelin aynı cevabı kelimesi kelimesine yeniden üretmesini
garanti etmez; model örneklemesi ve provider davranışı bridge dışındadır.

## 2. Uygulama dizini

Aşağıdaki yedi dosya çalışan runtime'dır. Başlatıcılar `scripts/`, yerel panel
ise `ui/` altındadır.

~~~text
src/
  server.mjs       route, auth, config, HTTP yaşam döngüsü, tek SSE writer
  anthropic.mjs    Messages decode, JSON/SSE encode, count_tokens
  responses.mjs    Responses decode, JSON/SSE encode, item ledger
  commandcode.mjs  native compiler, node:http(s), NDJSON, native reducer
  core.mjs         doğrulama, ortak error ve usage hesabı
  session.mjs      konuşma kimliği, TTL, kapasite ve aktif turn kilidi
  admin.mjs        yerel ayar API'si, secret yazımı ve statik panel
ui/
  index.html       yapılandırma ve entegrasyon durumu
  app.css          responsive görünüm ve bütün durum stilleri
  app.js           form, test isteği ve güvenli ekran güncellemesi
test/
  native.test.mjs
  adapters.test.mjs
  compatibility.test.mjs
  server.test.mjs
  long.test.mjs
~~~

Runtime: Node >=22 ESM; bu makinede kontrol Node 24.19.0 ile çalıştırıldı.
`node:http`, `node:https`, `TextDecoder`, `AbortController`, `node:crypto`,
`node:test` yeterli. TypeScript dosyası yalnız sözleşmedir; build zinciri şart değil.
Generic provider interface, plugin registry, event bus ve DI container yok.

Panel aynı loopback HTTP sunucusundan gelir. GET cevabı API anahtarını içermez;
POST işlemleri sayfa açılışında üretilen süreç içi token ve same-origin kontrolü
ister. Kaydetme sırasında çalışma dizini ve bütün profil yeniden doğrulanır,
ardından config/secret dosyaları atomik olarak değiştirilir. Aktif turn varken
ayar değişikliği 409 döner. Yeni istekler güncel profil ve credential'ı kullanır.

## 3. Ortak temsil

`Turn`, girdinin doğrulanmış anlamıdır. Başka sağlayıcının API gövdesi değildir.
System string/section ayrımını, sıralı mesaj bloklarını, araç tanımını, isteğe bağlı
parametrelerin bulunup bulunmadığını korur.

`BridgeEvent`, native event ID'sini ve segment numarasını taşır. Text ve reasoning
start/delta/end olayları atılmaz. Tool input parçaları callId ile birikir.
Provider aracı bir client tool'a çevrilmez. `finish` sadece turn gerçekten
doğrulandığında dışarı çıkar; native `finish` satırı doğrudan downstream'e verilmez.
Modüllerin imzaları contracts.d.ts içindedir.

~~~mermaid
sequenceDiagram
  participant C as Claude veya Codex
  participant S as server
  participant A as protokol adaptörü
  participant L as session
  participant N as commandcode
  participant U as Command Code
  C->>S: POST + yerel gateway tokenı
  S->>A: decode ve capability kontrolü
  A-->>S: Turn
  S->>L: acquire(konuşma + agent + workspace)
  L-->>S: sessionId ve threadId
  S->>N: generate(Turn, profil, identity, signal)
  N->>U: POST /alpha/generate
  U-->>N: NDJSON
  N-->>S: kimlikli semantik olaylar
  S->>A: encode
  A-->>C: JSON veya SSE
  C--xS: iptal/kopma
  S--xU: AbortController
  S->>L: finally release
~~~

## 4. HTTP yaşam döngüsü

~~~text
RECEIVE → VALIDATE → ACQUIRE → UPSTREAM_HEADERS → PRELUDE
                                              ↓
                                      COMMITTED / ACCUMULATE
                                              ↓
                                      VALIDATE_TERMINAL
                                              ↓
                                       DONE veya FAILED
Her çıkış → abort/cancel reader + timer cleanup + release
~~~

- Route, auth, body sınırı ve decode aynı hata sınırındadır. `count_tokens`
  dahil hiçbir async route bu sınırın dışında kalmaz.
- Prelude: upstream 2xx ve body doğrulanır. İlk güvenli içerik erken commit
  ettirebilir. İçerik gelmezse upstream header alındıktan 1000 ms sonra SSE
  başlatılır; 64 KiB/64 olay dolması da commit tetikler. Bunlar Astra1 başlangıç
  değerleridir, native sabit değildir.
- Erken error varsa HTTP hata; commit sonrası error varsa ilgili stream error.
  Sonsuza kadar “ilk görünür token” beklemek heartbeat'i de durdurur.
- Upstream header gelmeden 200/başarı başlatılmaz. Header timeout başlangıçta
  120 s; bu aralıkta downstream heartbeat garanti edilemez. Canlı ilk-byte
  ölçümüyle istemci ve gateway süreleri birlikte ayarlanır.
- Her 12 s'de protokole uygun heartbeat. Heartbeat upstream idle saatini
  sıfırlamaz; servis yaşıyor olması modelin ilerlediği anlamına gelmez.
- Tek writer içerik ve heartbeat'i sıralar. `write() === false` ise drain,
  close, error veya abort beklenir. Bekleyen heartbeat'ler biriktirilmez.
- Upstream byte-idle: başlangıç 600 s. Yerel backpressure nedeniyle okumayı
  durdurduğumuz süre upstream idle sayılmaz; downstream stall bütçesi 120 s.
  Toplam inference süresine 90 s gibi genel kesme uygulanmaz.
- Body alma 60 s / 16 MiB, NDJSON satırı 8 MiB, tek tool argümanı 8 MiB,
  turn toplam tutulabilir çıktı 32 MiB. Limit aşımı açık hata; kesip başarı yok.
- Node gelen request timeout'unun response üretme süresiyle karıştırılmaması
  gerekir. Sunucu socket/write sınırları uzun SSE testinde ayrıca ölçülür.

## 5. Oturum

Tek süreçte `Map` yeterlidir. Raw prompt ve bütün konuşma kalıcı depolanmaz.
İstemci her istekte gerekli geçmişi gönderir.

`bindingKey = HMAC(secret, JSON.stringify([principal, upstreamAccount,
workspaceId, protocol, conversationHint, agentHint]))`.
Model adı bir conversation anahtarı değildir. Provider hesabı/proje değişikliği
yeni binding oluşturur.

Hint sırası:

1. Açık `x-astra-conversation-id` ve isteğe bağlı `x-astra-agent-id`.
2. Anthropic: `x-claude-code-session-id` + `x-claude-code-agent-id`.
3. Codex: hedef sürüm capture'ında doğrulanan `thread-id` / agent header'ı.
4. Anthropic metadata.user_id içindeki JSON session_id veya eski _session_UUID
   eki: yalnız geçerli UUID ise kullanılır; kullanıcı/account kimliği kullanılmaz.
5. Hint yoksa request başına bağımsız identity; devamlılık garantisi verilmez.

`prompt_cache_key` ve API key **konuşma kimliği değildir**; aynı cache anahtarını
paylaşan farklı konuşmalar birleşmez. Header'lar doğrulanmış gateway principal
içinde namespace edilir. Hint uzunlukları en fazla 256 karakter.

`sessionId` ile `threadId` ayrı UUID'lerdir. İlkinde upstream session header'ı,
ikincisinde isteğe bağlı body alanı bulunur. Client response/item/call kimlikleri
bu alanlara yazılmaz. Workspace başlangıçta config dosyasındaki tek profildir;
farklı projeler ayrı süreç/port/profil kullanabilir.

Aynı binding'de ikinci aktif turn 409. Farklı dört binding paralel yürür.
Önemli sıra: **önce busy kontrolü**, sonra idle TTL. Aktif entry TTL doldu diye
yenisiyle değiştirilmez. Release yalnız kendi entry/lease'ini bırakır.
Idle TTL 1 saat, en fazla 1024 binding, en fazla 8 aktif turn; doluyken yeni iş
429 alır. Aktif kayıt tahliye edilmez. Sweep istek başında yeterlidir.

Konuşma hint'i varsa session/thread UUIDv8 kimlikleri aynı HMAC binding'den,
ayrı `session`/`thread` alanlarıyla türetilir. Idle TTL yalnız kilit/prefix kaydını
tahliye eder; kimlik TTL veya restart ile değişmez. Secret, hesap, workspace,
protokol veya konuşma/agent değişirse kimlik değişir. Hint yoksa her istek bağımsızdır.
Bu değişiklikten önceki rastgele kimlikler bir kez değişir. Tam geçmiş istemciden gelir.
Uzun dönem `previous_response_id` saklama bu sürümün sözleşmesinde yoktur.

Trace ile session aynı şey değildir: native CLI 1.54.0 iteration başına root
trace açar. Kullanıcının konuşma gruplaması için `traceMode=conversation`,
HMAC ile konuşmadan türeyen trace ID'yi `traceparent` içinde gönderir; span ID
her HTTP isteğinde rastgeledir. `request` modunda ikisi de yenilenir. Alan yoksa
tarihsel golden profilinde header eklenmez. Native telemetry exporter/link
ihracı yapılmaz. Command Code dashboard'u her konuşmanın üç isteğini aynı trace
ile ayrı ücret satırlarında gösterdi: evidence/routing-release.md.

## Model ve kontrol paneli

Profilin `models` alanı 1–32 alias içerir; her birinin upstream ID ve effortMap'i
bağımsızdır. Protokol decode sonrası ortak doğrulama istemci effort'unu eşler;
native compiler yalnız sonucu görür. `omit` alanı çıkarır, `reject` upstream
isteği göndermeden 422 verir. `clients` Claude/Codex başlangıç alias ve effort'unu
seçer. Kurulu native CLI'dan statik çıkarılmış katalog bilinen modellerin effort
seçeneklerini sınırlar; bilinmeyen modelin erişimi canlı test gerektirir.

Yerel admin yüzeyi loopback Host, CSRF ve Origin denetimi uygular. `/admin/account`
kayıtlı key'i whoami ile doğrular; `/admin/requests` son 100 ölçümü bellekte tutar;
`/admin/launch` yalnız sabit Claude/Codex başlatıcısını çağırır. Görünür Windows
terminalinde `.clients` profili kullanılır; anahtar komut satırına konmaz.
Claude resmi modelPicker alanı, Codex yerel katalog dosyası kullanır.

`npm start` kayıtlı UI anahtarına öncelik verir. Yeni kurulumda çevre/Command
Code oturumundan alınan anahtar bir kez kaydedilir. CLI açma ayar prefix'ini
yenilemez; servis başlatma ve UI kayıt açık yenileme noktalarıdır.

## 6. Kararlar ve kapanmamış kanıtlar

| Konu | İnşa kararı | Yayın koşulu |
|---|---|---|
| Native wire | CLI 1.54.0 hash'ine sabit | Native golden karşılaştırma |
| Tool streaming | İlan edilmiş client function için start/delta anında iletilir; terminal tool-call doğrulanınca tamamlanır | HTTP üzerinden iki parça, paralel tool ve mismatch testi |
| Thinking | Canlı native reasoning metni aynı içerikle aktarılır | High effort + CLI history round trip doğrulandı |
| Anthropic signature | İmzasız native thinking imzasız çıkar | Claude Code 2.1.272 kabul etti; imza zorunlu başka SDK'lar test edilmedi |
| pause_turn | Native continuation algoritması max 6 segment; başlangıçta kapalı | Kontrollü native/bridge çok-segment kaydı |
| Boş system | String/sections/absence korunur | Single-space ancak A/B kanıtıyla ayrı profil değişikliği |
| Tool-result image | Tool metninden sonraki native user bloğuna byte'ları korunarak taşınır | Offline iki protokol ve gerçek CLI araç görsel testi |
| Codex custom/freeform tool | 422; teslim edilen catalog apply_patch_tool_type=null kullanır | Belgeli function/shell profili gerçek Codex ile doğrulandı |
| Desktop | 3P endpoint seçimi olan hedef sürüm | Ayrı gerçek uygulama testi |

Tool argümanları hem parça parça iletilir hem sınırlı bir doğrulama tamponunda
tutulur. Preview çalıştırma onayı değildir: content_block_stop / arguments.done
ancak native tool-call ile tam JSON eşleştikten sonra gönderilir. Ownership
değişimi, mismatch ve yarım client çağrısı hata üretir. Provider araçları ve
typed tool_search ayrı tutulur; function preview olarak gönderilmez.

422 ile veri kaybını önlemek doğru hata davranışıdır; hedef istemcinin normal
işlerini engelliyorsa bu durum “final modül tamam” demek için yeterli değildir.
ACCEPTANCE.md bu ayrımı zorunlu kılar.
