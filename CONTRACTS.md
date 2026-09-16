# Normatif protokol sözleşmesi · astra1-v1

Bu dosya çalışan runtime'ın sözleşmesidir. Güncel canlı bulgular
evidence/release.md içinde, ilk incelemenin kaynakları SOURCES.md içindedir.

## 1. HTTP yüzeyi ve sınır doğrulaması

| Method | Path | Kimlik | Sonuç |
|---|---|---|---|
| GET | / | Gerekmez | Loopback Astra Console HTML |
| GET | /admin/config | Gerekmez | Secret içermeyen panel görünümü + süreç içi CSRF tokenı |
| POST | /admin/config | Admin token + same-origin | Doğrulanmış config/secret güncellemesi |
| POST | /admin/test | Admin token + same-origin | Kısa gerçek Responses bağlantı testi |
| GET | /admin/account | Admin token + same-origin | whoami hesabı ve anahtar izi; key içermez |
| GET | /admin/models | Admin token + same-origin | Canlı whoami doğrulaması + pinned native CLI model kataloğu |
| GET | /admin/requests | Admin token + same-origin | Son 100 ölçüm, bellekte |
| POST | /admin/launch | Admin token + same-origin | Sabit claude/codex başlatıcısı, görünür terminal |
| GET | /healthz | Gerekmez | Yalnız süreç sağlığı, ör. status ve contractVersion |
| GET | /v1/models | Gateway | Yapılandırılmış model alias'ları |
| POST | /v1/messages | Gateway | Anthropic JSON veya SSE |
| POST | /v1/v1/messages | Gateway | Bilinen base URL alias'ı |
| POST | /v1/messages/count_tokens | Gateway | Açıkça yaklaşık token sayısı |
| POST | /v1/v1/messages/count_tokens | Gateway | Yukarıdaki sayacın alias'ı |
| POST | /v1/responses | Gateway | Responses JSON veya SSE |

Query string route eşleşmesini etkilemez. Keyfi /v1 tekrarlarını regex ile yutma.
Tanımlı path'te yanlış method 405, bilinmeyen path 404. /backend-api/codex/responses,
Chat Completions, WebSocket upgrade, compact/retrieve/background için sahte başarı
üretme; bu tabanda sunulmaz.

Auth: Anthropic x-api-key veya Authorization Bearer; Responses Bearer.
İki credential başlığı birden varsa ikisinin de gateway tokenıyla uyuşması
gerekir. Gelen token upstream key olamaz. Constant-time karşılaştırma; configte
gateway tokenı ve upstream credential ayrı environment değişkenleridir.
Loopback varsayılan ve bu sürümün sınırıdır; wildcard CORS yoktur.

Admin GET yanıtı upstream/gateway/session credential değerlerini hiçbir zaman
döndürmez. API anahtarı alanı yalnız yeni değer yazmak içindir. Admin POST,
sayfanın GET cevabındaki rastgele tokenı `x-astra-admin` başlığında ister ve
browser Origin değeri varsa kendi host'uyla eşleşmesini zorunlu tutar. Config
değişikliği sırasında aktif turn varsa 409; geçersiz workspace/model/alias 422.

POST JSON body object olmalı; yanlış content type 415, geçersiz UTF-8/JSON 400,
boyut aşımı 413. Gelen header/body/schema/input sınırlarında type kontrolü yap.
Payload'dan environment adı, upstream URL, proje profili veya auth header'ı
türetme. Yalnız config URL kullanılır. Redirect takibi kapalıdır.
Remote image URL/file ID kendi kendine indirilmez.

Model alias tablosunda olmayan isim 422; sessiz varsayılan modele düşme.
Yanıtta model alanı istemcinin kabul edilen alias'ıdır. Gerçek upstream model
eşlemesi kullanıcı konfigürasyonunda görülebilir.

temperatureRange profile'da yoksa model-özel aralık henüz doğrulanmamıştır:
canlı model kabulüne kadar temperature talepleri 422 olur. Sentetik compiler
fixture'ları temperature=0 alanının kaybolmamasını ayrıca kontrol eder; bunlar
canlı capability onayı değildir. Fixture profile override'ları alan bazında
birleştirilir; örnek profilin diğer alanları korunur.

## 2. Alan politikası

Her adapter desteklediği alanları açıkça listelemeli. Anlamı bilinmeyen non-default
alan 422 ve güvenli param yolu üretir. Harici SDK'nın zararsız varsayılan alanları
aşağıdaki gibi tanımlanır; gelişigüzel “unknown keys ignore” yapılmaz.

### Anthropic

| Girdi | İşlem |
|---|---|
| model, messages, max_tokens | Zorunlu; doğru tür, pozitif tam sayı token sınırı |
| stream | Yoksa false; varsa boolean |
| system string | String biçimi korunur |
| system text sections | Sıra ve cache sınırı korunur |
| user text / base64 image | Native text / data URL + mimeType |
| assistant text / tool_use | Sıra, id, name, input değerleri korunur |
| thinking geçmişi | Destekli model profilinde reasoning text; signature upstream'e taşınmaz |
| tool_result | call ID üzerinden ad; text parçaları newline ile birleştirilir |
| tool_result.is_error=true | Reddedilmez; metin aynen; bayrağın native karşılığı yok |
| metadata.user_id | Prompt olmaz; açık session_id UUID varsa konuşma hint'i; kullanıcı kimliği conversation key değildir |
| temperature | Sonlu sayı; yalnız model profilinin doğrulanmış aralığında |
| tool_choice auto / yok | Native varsayılanı |
| auto.disable_parallel_tool_use=false | Native varsayılanı |
| thinking.disabled / yok | output_config.effort yoksa model effortMap.default uygulanır; tablo yoksa alan eklenmez |
| output_config.effort | Model effortMap tablosundan native reasoning_effort'a eşlenir; thinking alanından bağımsızdır |
| adaptive + output_config.effort | Açık profile eşleme; her isteği high yapma |
| enabled + budget_tokens | Ancak kanıtlı budget→effort tablosuyla; aksi 422 |
| tool_choice any/tool/none, parallel kapatma | Native karşılık kanıtlanana kadar 422 |
| stop_sequences, top_p, top_k, JSON schema output | Açık eşleme yoksa 422 |
| cache_control ttl veya başka cache türü | ephemeral dışı TTL'yi düşürme; destek yoksa 422 |
| message text / tool_result / tool declaration ephemeral cache hint | Doğrulanır; native CLI gibi içerik korunur, message/tool cache yerleşimini upstream yönetir |
| server tool, document, redacted_thinking | Ayrı doğrulanmış profil yoksa 422 |

Anthropic-version, anthropic-beta request context'te tutulur. Native endpoint'e
Anthropic'e gidiyormuş gibi bütün başlıkları kopyalama. Desteklenen beta ailesi,
gerekli payload davranışı ve hedef istemci sürümü canlı acceptance kaydında
birlikte sabitlenir; bilinmeyen beta semantiği sessiz açılmaz.
CLI başlatıcı thinking parametresini göndertmez; modelin kendi reasoning üretimi
devam eder. High effort ve reasoning history canlı olarak doğrulandı.

Claude Code 2.1.272'nin gönderdiği system rollü text Messages öğesi açık bir
uyumluluk uzantısıdır; system sections'a taşınır. Developer rolü burada desteklenmez.

### Responses

| Girdi | İşlem |
|---|---|
| model, input | Alias + string veya sıralı input item listesi |
| instructions | String / yok; null kabul edilecekse açık biçimde “yok” sayılır |
| message input_text/output_text | Native text; role ve item sınırları korunur |
| function_call | call_id ilişki anahtarı; arguments JSON object olmalı |
| function_call_output | Aynı call_id; string veya destekli text listesi |
| input_image data URL | MIME/base64 doğrulaması; byte'lar korunur |
| tools.type=function | name, description, parameters; strict:true kanıt yoksa 422 |
| tools.type=namespace | Function alt araçları; namespace ve tool adı ayrı tutulur; çakışmayan native ad + ters eşleme |
| tools.type=tool_search, execution=client | Ayrı kind; ilan edilen şema ve çıktı tools listesi korunur |
| tool_search_call/output | Typed item round trip; sıradan function'a düşürülmez |
| max_output_tokens | Native max_tokens; sessiz 8192 tavanı yok |
| stream, temperature | Anthropic ile aynı tür/capability disiplini |
| tool_choice auto, parallel_tool_calls true | Varsayılan native davranış |
| store:false veya yok | Yerel stateless profil; response.store=false |
| store:true | 422; kalıcı depolama vaadi verilmez |
| previous_response_id/conversation null veya yok | State talebi yok |
| previous_response_id/conversation değerli | 422; history'nin yerine ID gönderilemez |
| prompt_cache_key | Cache hint olarak tanınır; conversation identity değildir; wire karşılığı yoksa upstream'e eklenmez |
| metadata | Sınırlı string map; yanıt metadata'sında aynı, promptta yok |
| client_metadata | Codex transport metadata nesnesi; prompta veya upstream'e aktarılmaz |
| message.phase | commentary/final_answer sınıflandırması kabul; metin korunur |
| reasoning.effort/summary | Model/istemci profilinde açık destek varsa |
| reasoning input.summary text | Üretilen reasoning item'ın geri okuma karşılığı mutlaka vardır |
| encrypted_content / compaction item | İçeriği çözülemiyorsa 422; silip devam etme |
| text.format.type=text | Varsayılan metin biçimi |
| text.verbosity veya JSON schema | Doğrulanmamış non-default değer 422 |
| include:[]; background:false; truncation:disabled | Etkisiz varsayılanlar kabul edilir |
| include:["reasoning.encrypted_content"] | İsteğe bağlı alan talebi kabul; bu upstream'de şifreli veri yok, üretilmez |
| background:true / truncation:auto | Bu profilde 422 |
| custom/freeform, hosted web/file/computer/shell | Ayrı eşleme ve round-trip kanıtı yoksa 422 |

Function output dizisini JSON.stringify ile konuşma metnine dönüştürme.
Text parçalarını metin olarak, medyayı medya olarak ele al veya açık reddet.
Null ile yokluk eşitliği yalnız tabloda açıkça izin verilen alanlara uygulanır.

Codex'in seçili sürümü zorunlu custom tool, compact veya encrypted item
gönderirse bu davranışı yok saymak çözüm değildir. Ya belgeli istemci ayarıyla
tam geçmiş + destekli tool profili seçilir ve kanıtlanır ya mapper uygulanır.
Her iki durumda da hedef Codex kabul testi geçmeden final etiketi yoktur.

Typed tool_search_output, Turn içinde tool-search-result olarak status,
execution ve tools nesnelerini saklar. Native text-only tool output'a bu
nesnenin JSON gösteriminin konması yalnız bu tanımlı tool_search protokol
eşlemesidir; genel function output için keyfi JSON.stringify kuralı değildir.
İstemcinin sonraki turda ilan ettiği yüklenmiş tool tanımları da eksiksiz
doğrulanır. Kind, name ve çağrı ID'si ayrı tutulur.

Responses instructions önce, input içindeki system/developer mesajları kendi
sıralarıyla sonra native system sections'a alınır; developer talimatı kullanıcı
mesajına düşürülmez. Bu dönüşüm source API'nin dinamik rol önceliklerini tamamen
taklit ettiği iddiası değildir. Talimatların konuşma içinde yer değiştirmesinin
önemli olduğu profil ayrıca test edilir. Sadece instructions string varsa
string native dalı korunur; section ekleniyorsa açık section dalına geçilir.

## 3. Native compiler

Endpoint: POST https://api.commandcode.ai/alpha/generate.
HTTP header adları case-insensitive; değerler native profile göre:

~~~text
Content-Type: application/json
User-Agent: cli
x-command-code-version: 1.54.0
x-cli-environment: production
x-project-slug: <güvenilir profil>
x-taste-learning: true|false
x-session-id: <native session identity>
Authorization: Bearer <COMMANDCODE_API_KEY>
~~~

OAuth, ZDR ve provider flag'leri yalnız gerçek auth/provider profili gerektiriyorsa
ayrı allowlist ile eklenir. Trace/header gözlemlerini sahte cihaz kimliğine çevirme.

Zarfın sabit alanları:

~~~json
{
  "config": {
    "workingDir": "C:/synthetic-workspace",
    "date": "2026-09-15",
    "environment": "synthetic-test",
    "structure": [],
    "isGitRepo": false,
    "currentBranch": "",
    "mainBranch": "",
    "gitStatus": "",
    "recentCommits": []
  },
  "memory": null,
  "taste": null,
  "skills": null,
  "permissionMode": "standard",
  "params": {
    "model": "meta/muse-spark-1.3-contributor",
    "messages": [],
    "tools": [],
    "max_tokens": 64000,
    "stream": true
  }
}
~~~

Örnek boş messages canlı gönderilecek istek değildir. Golden dosya gerçek test
girdisine karşı beklenen zarfı gösterir. Rules:

- config güvenilir yerel nesne; keyfi client config birleştirme yok.
  Canlı endpoint yukarıdaki dokuz alanı zorunlu tutuyor; boş config HTTP 400.
  Başlatıcı çalışma dizini, gün ve ortam/git durumunu yerelden doldurur.
- threadId ancak profil istiyorsa ve geçerli UUID ise eklenir; yoksa tamamen
  atılır. sessionId ve threadId aynı kavram değildir.
- permissionMode: bypass→auto-accept, auto-accept/plan korunur, diğer→standard.
  Client'in tool onay politikasını kendi kendine auto-accept'e yükseltme.
- mode/promptCache yalnız tanımlıysa, falsy değerler dahil şemaya göre korunur.
- max_tokens yoksa native varsayılan 64000; bu gözlenen CLI varsayılanıdır,
  modelin kanıtlanmış maksimumu değildir. Config cap varsa aşan istek 422.
- params.stream non-stream client için bile true. JSON response aynı reducer'dan
  biriktirilir. Ayrı upstream non-stream yolu yok.
- temperature=0 korunur; reasoning_effort yalnız doğrulanmış capability talebinde.
- System yok/string/sections ayrımı tutulur. CLI systemSections dalında son
  olmayan section'a bir newline ekler, cache işaretinden ephemeral üretir.
  String dalında string'i değiştirme. Yokluk JSON.stringify ile atılır.
- System promptuna routing notu, fallback araçları veya gizli boşluk ekleme.

### Mesaj ve araç invariants

1. Assistant blok sırası korunur. CLI serializer reasoning/text/tool'a göre
   yeniden sıralamaz. Model özel sıra isterse kontrollü validasyon gerekir.
2. Native CLI user mesajındaki tool-result'ları bir tool role mesajına,
   text/image parçalarını sonra user role mesajına ayırır. Bu native grouping
   açıkça tanımlı dönüşümdür. Orijinal user parça sırası Turn'de saklanır.
3. tool-call: toolCallId, toolName, input. tool-result: toolCallId, aynı
   toolName, output:{type:"text",value}. Tool adını result içeriğinden tahmin etme.
4. Bütün history boyunca duplicate call/result ID, yetim result ve tamamlanmamış
   client tool geçmişi 422. İçeriği budama veya hayali sonucu ekleme.
5. tool_search→search_tools request-local tabloyla hem araç ilanına hem geçmiş
   çağrılarına uygulanır. Definition zaten search_tools ise ikinci kez dönüşmez.
   İki client aracının aynı wire adına dönüşmesi 422.
6. Ters eşleme isim sezgisine göre değil, request'in kayıtlı kind/clientName
   tablosuna göre. Sıradan adı search_tools olan bir function tool, typed
   tool_search_call diye çıkarılmaz. Eski __bridge_tool_search adı wire'a sızmaz.
7. Provider-owned araç client'a executable function/tool_use olarak verilmez.
   Native ledger'da takip edilir. Bilinen provider telemetry sonucu terminal
   muhasebesi için kullanılabilir; anlamlı hosted çıktı için ayrı mapper gerekir.
8. Native araç kullanıcı tarafından ilan edilmemiş ve provider-owned değilse
   upstream protocol error. CLI'ın büyük araç listesini bridge kendisi eklemez.
9. Base64 image native user bloğuna gider. Tool-result içindeki metin native
   tool-result olur, görsel byte'ları takip eden user bloğuna taşınır.
   İki protokolde ilişki ve byte eşitliği test edilmiştir. Responses auto/high
   detail kabul edilir; bridge yeniden boyutlandırmaz. Native provider'ın
   görüntü işleme bütçesi OpenAI detail token bütçesiyle aynı sayılmaz.
10. is_error işaretinin kaybı yalnız sayısal diagnostic flag olur; hata metni
    değiştirilmez, HTTP hata yapılmaz. Flag'in kendisi korunabiliyormuş gibi
    tam bit eşitliği iddia edilmez.

## 4. Native NDJSON ve terminal

Parser byte stream okur; incremental fatal UTF-8 decoder + newline buffer.
CRLF, boş satır ve son newline'sız tam JSON satırı kabul edilir. Bozuk UTF-8,
bozuk JSON, satır boyutu aşımı hata. Upstream SSE data: satırı bu profilde hatadır.
Content-type yalnız tanı ipucudur; gözlenen gövde lehçesi NDJSON'dur.

generate, 2xx headers/body doğrulandıktan hemen sonra upstream-ready(segment)
kontrol olayını üretir. server prelude saatini bu olayla başlatır; encoder'a
iletmez. Böylece hiç native text gelmese de bounded prelude ve heartbeat
çalışabilir. Header timeout generate'in fetch katmanının sorumluluğudur.

| Native olay | Reducer davranışı |
|---|---|
| start/start-step | Yaşam döngüsü, güvenli metadata; görünür çıktı değil |
| text-start/delta/end | (segment,id) ile block; text içeriği değişmez |
| reasoning-start/delta/end | Ayrı block; modele/istemciye göre render politikası |
| tool-input-start/delta/end | İlan edilmiş client function için tool-start/tool-delta anında; (segment,callId) doğrulama tamponu; end çağrıyı tamamlamaz |
| tool-call | Terminal input/args object ile birikmiş JSON'u deep-equal doğrula |
| tool-result/tool-error | Ownership-aware provider ledger; client'a tekrar çalıştırma yok |
| finish-step | Segment kullanım aday bilgisi; final toplamla toplama yok |
| finish | Terminal adayı; ledger/finishReason/usage doğrulaması yapılır |
| provider-metadata | Finish sonrası izinli; yalnız tanınan usage alanları okunur |
| abort/error | Başarısız terminal; başarılı finish çıkmaz |
| bilinmeyen type | Profilin explicit metadata allowlist'inde değilse 502 |

Profil ID'siz eski text-delta biçimi gerektiriyorsa yalnız kaydı olan dalda
synthetic block ID atanır. Bütün native start/end olaylarını atıp tek currentText
kullanma. Kapanan ID'ye delta, mükerrer finish ve orphan tool end protocol error.

Function preview başlarken client adı ve namespace geri eşlenir, her özgün delta
aynen iletilir. Provider-executed araç preview olarak çıkmaz; preview başladıktan
sonra ownership değişirse hata döner. Tool argümanı terminal input geldiğinde ancak geçerli JSON object ise
`tool-call` BridgeEvent olur. Birikmiş rawArguments özgün metin olarak tutulur;
terminal object ile JSON anahtar sırasından bağımsız eşitliği aranır. Mismatch
durumunda {} veya terminal input ile sessiz onarım yok. Terminal-only tool call
geçerliyse JSON.stringify ile tek argument string üretilebilir.

Native finish'te açık araç/text/reasoning ledger'ı doğrulanır. Normal stop/tool
finish'te tamamlanmamış argüman başarıya çevrilmez. Client function preview'ı
yarım kaldıysa length dahil incomplete_tool_arguments hatası döner; tool kapanışı
ve başarılı terminal yayımlanmaz. Diğer length durumları incomplete/max_tokens döner.
Finish sonrasındaki provider-metadata ve EOF okunmadan downstream terminal
success üretilmez. Tail 5 s içinde EOF vermiyorsa terminal_drain_timeout.
Bu süre tasarım varsayılanıdır; gerçek profile göre ölçülür.

EOF + finish yok → truncated_stream. Finish ardından error veya bozuk satır →
error. Geçerli finish+tail+EOF → tam bir kez finish BridgeEvent. Tamamlanmış
cevabın ardından response.failed gönderme. Final emit sonrası soket kapanması
yeni protokol sonucu değildir.

### Finish eşlemesi

| Native raw reason | Anthropic | Responses |
|---|---|---|
| stop/end_turn | end_turn | completed |
| tool-calls/tool_calls/tool_use | tool_use | completed; function items |
| length/max_tokens | max_tokens | incomplete, reason=max_output_tokens |
| pause_turn | Aşağıdaki continuation veya explicit error | Aynı |
| content-filter/refusal/unknown | Doğrulanmış ayrı mapper yoksa error | Aynı |
| abort/error/EOF sans finish | error | failed |

Başarılı tool finish, en az bir geçerli client call gerektirir; aksi durumda
provider-only devam veya protocol error ayrımı yapılır. Başarılı stop boş
reasoning-only cevabı maskelemez: ilk tabanda empty_visible_output hatası.

### pause_turn

Bu incelemede static CLI aynı body/header/session ile en fazla altı segment
gönderiyor; previous partial assistant'ı messages'a eklemiyor. Bu native protokol
devamıdır, genel retry değildir. Kontrol edilmiş canlı fixture olmadan başlangıç
configinde disabled: pause_turn görülürse pause_continuation_unverified hatası.
Enabled olduğunda segment usage'ları ayrı toplanır; ilk beş pause terminali
istemciye gönderilmez; altıncı da pause ise continuation_limit. Call/block ledger
anahtarları segmentle namespace edilir, aynı client call ID tekrar yayımlanmaz.

## 5. Egress: ortak kurallar

Stream ve non-stream aynı reducer/encoder state'inden sonuç alır. Adapter network
yazmaz; event nesnesi verir. server tek writer'dan serialize eder.
Ping ayrı transport olayıdır. Payload'da newline JSON escape edilir;
SSE her olay için event: TYPE + data: JSON + boş satır biçimindedir.

### Anthropic

`message_start → block_start → delta* → block_stop → message_delta → message_stop`.
Birden fazla blok ve uygun ping araya girebilir. Index monoton ve aynı blok için
sabittir. Tool başlangıç input:{}, ardından rawArguments içeren input_json_delta,
sonra stop. Her tool_use.id native callId ile aynı; client adı ters tabloyla gelir.

Message_start usage henüz bilinmiyorsa placeholder 0 geçici olarak kullanılabilir.
Final message_delta ve JSON usage doğrulanmış toplamı taşır.
Reasoning, thinking_delta olur; metni değiştirilmez. Canlı Muse high probe
reasoning metni gösterdi. Native imza sağlamadığından signature alanı ve
signature_delta üretilmez. Claude Code 2.1.272 bu imzasız blokları kabul edip
sonraki turda geri gönderdi. Bu bir gateway uzantısıdır; Anthropic'in imzalı
thinking bütünlüğüne eşdeğer değildir. İmza zorunlu başka SDK'lar kanıtlanmadı.

Bu olay sırası ve signature alanının bütünlük rolü
[Anthropic streaming belgesinde](https://platform.claude.com/docs/en/build-with-claude/streaming)
tanımlanır. Astra1'in buffer ve error kararları kendi gateway sözleşmesidir.

### Responses

created → in_progress; item başına added → parça/argüman deltaları → done;
sonra tam bir completed/incomplete/failed.

- Her **data event**, error dahil, aynı sayaçtan sequence_number alır: başlangıç
  0, her olayda +1. Bu Astra1 tercihi; 1'den başlamak zorunlu iddiası yok.
  SSE comment heartbeat sayacı artırmaz.
- `Map<segment:blockId, ItemState>`: yeni item açılması eskisini kapatmaz.
  source end ya da doğrulanmış terminal kapanışı belirler.
- response.id, item.id ve call_id farklı alanlar. Output index item ilk
  görüldüğünde atanır; closure sırasına göre tekrar numaralanmaz.
  Client function için ilk görülme tool-start anıdır; index terminal kapanış
  sırasından bağımsızdır. Terminal-only tool ve typed search ilk tool-call'da açılır.
- Text: output_item.added, content_part.added, output_text.delta*,
  output_text.done, content_part.done, output_item.done.
- Function: output_item.added, function_call_arguments.delta/done,
  output_item.done. arguments JSON string; call_id native kimlik.
- Typed client tool_search: kendi tool_search_call/output biçimi; function
  argument event'i gibi davranması gerektiği varsayılmaz.
- Reasoning summary desteği açıksa reasoning item + summary part/text eventleri;
  aynı item'ın sonraki input'a geri alınması decode tarafından desteklenir.
- Final response.output ekranda üretilen items ile aynı ID/index/içeriği taşır;
  snapshot'lar structuredClone olmalı, önceki queued event sonradan değişmemeli.
- Terminal response JSON'u: id, object:"response", created_at, model, status,
  output, error, incomplete_details, usage, store:false, metadata. İlan edilen
  adapter profilinin diğer zorunlu alanları resmi şema/istemci fixture'ıyla sabitlenir.
- [DONE] Chat Completions sentineli ekleme.

Event alanları için
[resmi Responses streaming sözleşmesi](https://developers.openai.com/api/reference/resources/responses/streaming-events)
esas alınır; yukarıdaki sıralama ve buffering Astra1 uygulama kurallarıdır.

## 6. Usage: aynı sayı iki farklı gösterim

Bir segmentin authoritative kaynağı finish.totalUsage. finish-step.usage aynı
toplama eklenmez. Son provider-metadata cache detayı varsa kontrollü tamamlar;
toplam input/output'u keyfi değiştiremez. Kontrol: sonlu, >=0 tam sayı;
cacheRead+cacheWrite <= input; reasoning <= output.

~~~text
Native inputTokens=100, cacheReadTokens=60, cacheWriteTokens=10
Native outputTokens=20, reasoningTokens=5

Anthropic: input_tokens=30, cache_read_input_tokens=60,
           cache_creation_input_tokens=10, output_tokens=20
Responses: input_tokens=100, cached_tokens=60,
           output_tokens=20, reasoning_tokens=5, total_tokens=120
~~~

Responses input toplamından cache çıkarılmaz. Reasoning output'a tekrar eklenmez.
Native inputTokenDetails.noCacheTokens varsa türetilen değerle tutarlılığı
kontrol edilir; uyumsuzluğu clamp ile gizleme. 1h cache creation alanı varsa
toplam cacheWrite içinde altkümedir, tekrar eklenmez.
Eksik native toplamı sıfır kullanım diye sunma: ilk strict native profil final
input/output usage'ı gerektirir, eksikse missing_usage hatası. Erken failure'da
usage null/unknown; maliyet tahmini başarı verisi yerine geçirilmez.

## 7. Hatalar

| Durum | HTTP (commit öncesi) | code |
|---|---:|---|
| Yerel auth | 401 | invalid_gateway_credential |
| Body tür/şekil | 400/413/415 | invalid_request/request_too_large/unsupported_media_type |
| Desteklenmeyen anlam | 422 | unsupported_parameter |
| Aynı aktif konuşma | 409 | conversation_busy |
| Yerel kapasite / upstream 429 | 429 | capacity_exceeded/upstream_rate_limit |
| Eksik başlangıç configi | Servis başlamaz | invalid_config |
| Upstream 401/403 | 502 | upstream_auth |
| Plan/kredi tükenmesi | 502 | upstream_entitlement |
| Upstream timeout | 504 | upstream_timeout |
| Bozuk/eksik native akış | 502 | native_protocol_error / özel güvenli code |

Anthropic HTTP error gövdesi type:"error", error:{type,message}; Responses gövdesi
error:{message,type,param,code}. Sabit güvenli mesaj kullan; raw upstream response,
exception stack, token, prompt veya key'i istemciye dökme.

Commit sonrası Anthropic event:error; Responses response.failed + tam mevcut
response snapshot ve sequence_number. Sonra kapanış. Length tamamlanma hatası
yerine incomplete sayılır. Disconnect'te downstream'e yazı denenmez.
Retry-After varsa biçimi kontrol edilerek geçirilir.

premium_credits_exhausted, model_not_in_plan, insufficient credits non-retryable.
Genel POST retry yok; HTTP 200 içi error da başarı değildir.

## 8. count_tokens ve models

Sayaç ayrı model çağrısı yapmaz. Serialized system/history/tools metninden açık
deterministik tahmin üretir, schema metnini de sayar; image için belgeli sabit
varsayım kullanır. `x-astra-token-count: estimate` her cevapta bulunur.
Önerilen basit taban: ceil(UTF8 semantic JSON byteLength / 3) + 4*messageCount;
image başına 1024 token, image base64 byte'ları metin hesabına katılmaz.
Bu sayılar Astra1 heuristiğidir; context limitine sığma garantisi değildir.
Gerçek client context davranışı bu tahminle bozulursa model-özel sayaç gerekir.

Models route auth zorunlu. Bearer+x-api-key çelişkisi yukarıdaki auth kuralına
tabi. Anthropic-version/x-api-key isteğinde Anthropic list şekli
data(type:model,id,display_name,created_at), first_id,last_id,has_more;
normal Responses istemcisinde OpenAI object:list/data model şekli kullanılır.
Model listesi config alias'larından gelir; upstream hesap kataloğu açığa çıkmaz.

## 9. İçeriksiz streaming/cache ölçümü

Inference sonundaki log `metrics` alanı conversationBound, stream,
samePrefixAsPrevious, upstreamReadyMs, firstTextMs, lastTextMs, textDeltas,
inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens ve
uncachedInputTokens alanlarını içerir. Süreler istek başlangıcına göredir.
İlk/son metin zamanı native metnin encoder'a ulaşmasıdır; terminal boyama ölçümü değildir.

samePrefixAsPrevious yalnız model/config/system/tools eşitliğidir; mesaj geçmişi
bu ölçüme dahil değildir ve true cache hit garantisi vermez. Karşılaştırma için
HMAC yalnız bellekte tutulur; hash veya içerik loglanmaz. İlk istek/TTL sonrası null.

Cache sayaçları doğrulanmış native totalUsage.inputTokenDetails'ten alınır.
Kaynağın bildirmediği değer null; açık sıfır 0'dır. Pause continuation'da bütün
segmentler bildirmedikçe ilgili toplam null kalır. Mevcut protokol usage
eşlemeleri değişmez. Cache sonucu upstream/model sorumluluğundadır; bridge
promptCache alanı uydurmaz, sahte hit üretmez veya cache uğruna geçmişi kesmez.

## 10. Yapılandırılabilir model, effort ve trace

`models` 1–32 benzersiz alias içerir. Her modelin `effortMap` alanı isteğe bağlıdır;
varsa default/none/minimal/low/medium/high/xhigh/max anahtarlarının tümü gerekir.
Hedef model.efforts içinden bir değer, `omit` veya `reject` olur. Bilinen native
katalog modelinde destek dışı effort config reddedilir. `omit` native alanı çıkarır;
`reject` ve bilinmeyen giriş upstream çağrısı olmadan 422 verir. Tablo yoksa eski
capability doğrulaması devam eder. `requestedEffort` özgün giriş, `reasoningEffort`
eşlenmiş değerdir; yokluk null/undefined ile ayırt edilir.

`clients.claude` ve `clients.codex` başlangıç model/effort seçer. Seçilen alias
profilden olmalı ve başlangıç effort'u reddedilmiyor olmalıdır. Claude girişleri
low/medium/high/xhigh/max, Codex none/minimal/low/medium/high/xhigh'dır.

`traceMode`: conversation veya request. Conversation'da aynı binding'den
türetilen 32 hex trace ID; her gönderimde yeni 16 hex span ID. W3C `traceparent`
00-trace-span-01 olarak gönderilir. Hint yoksa bağımsızdır. Alan yoksa tarihsel
header davranışı korunur. Session/thread restart/TTL devamlılığı aynı kalır.

Admin UI yolları loopback Host ister; veri/launch API'leri admin tokenı ve varsa
same-origin ister. Diagnostics yalnız generation isteklerini tutar; raw key,
prompt/tool içeriği yoktur. Trace ID sadece son 100 kaydın bellekteki panel
görünümündedir; logger trace/session ID içermez. Ölçümler public/upstream model,
requested/upstream effort, accountFingerprint, firstContentMs ve reasoningTokens
alanlarını da taşır. Cache/billing ilişkisi tahmin edilmez.
