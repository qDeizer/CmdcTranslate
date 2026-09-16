# Kabul kapıları

**Şimdiki durum:** Çalışan CLI sürümü. 50 kısa runtime testi, önceki gerçek süreli F35
ve canlı API/CLI metin, araç hata döngüsü ve görsel testleri geçti.
Güncel sonuçlar [evidence/release.md](evidence/release.md) içindedir.

Model/effort ve trace güncellemesi: [kanıt raporu](evidence/routing-release.md).
İki gerçek istemcinin aynı konuşmadaki üçer isteği Command Code panelinde ortak
trace altında ayrı ücret satırları olarak doğrulandı. Çoklu model kaydı, effort
eşlemesi/reddi, admin Host/token sınırı, Claude picker, görünür terminal başlatma
ve 390px ekran kontrolü geçti. Dashboard eski cache ayrıntılarını sunmadığından
geçmiş miss nedenleri için daha ileri iddia yoktur.
Geniş RELEASE_READY etiketi henüz verilmedi; GUI ve bazı uzun istemci senaryoları
ayrıca kanıt gerektiriyor. Foundation check yalnız dosya bütünlüğünü kontrol eder.

## 1. Hazır olma düzeyleri

| Düzey | Şart |
|---|---|
| FOUNDATION_READY | Belgeler, type imzaları, sentetik fixture ve kaynak manifesti tutarlı |
| OFFLINE_READY | Aşağıdaki F testleri gerçek Astra1 modülleri üzerinde passed |
| CLIENT_READY | İlan edilen her istemci/model profili için L testleri passed |
| RELEASE_READY | CLIENT_READY + başlangıç/kapatma/kurulum/tek entrypoint ve eksik zorunlu özellik yok |

Testin skip olması pass değildir. Sadece HTTP 200, substrings veya olay adı sayısı
yeterli değildir. SSE parse edilip ID/indeks/sıra/sonuç şeması ve final JSON
karşılaştırılır. İki ayrı nondeterministik model cevabının aynı kelimeler olması
beklenmez; native request projection ve bridge'e gelen/giden anlam karşılaştırılır.

## 2. Offline zorunlu testler

Her ID için test/native, anthropic, responses veya server dosyasında en az bir
anlamlı assertion bulunur. Alttaki tüm satırlar iki protokolün ortak pipeline'ına
uygulandığı yerde stream true/false ile kapsanır.

| ID | Senaryo | Beklenen kanıt |
|---|---|---|
| F01 | İki protokolden aynı anlamdaki request | Native golden zarfı; tek POST /alpha/generate |
| F02 | Null / absent / empty / temperature=0 | Atılan ve korunan alanlar Object.hasOwn ile doğrulanır |
| F03 | System string, sections, cache | Section newline ve cache sınırı CLI golden ile aynı |
| F04 | Assistant blok sırası / user grouping | Assistant sırası korunur, native tool/user grouping açık beklenir |
| F05 | Function tool döngüsü + is_error=true | Call ID/ad değişmez; hata metni native tool result olur |
| F06 | Duplicate/orphan/dangling/collision | 422; upstream çağrı sayısı 0; history budanmaz |
| F07 | tool_search typed ve aynı adlı ordinary function | Wire search_tools; geri dönüş kind tablosuna göre; iç alias sızmaz |
| F08 | User image + tool output image | User byte'ları aynı; tool image promotion için call ID, metin ve byte round trip |
| F09 | Her byte sınırında UTF-8/NDJSON kesimi | Çıktı eşit; CRLF ve final newline yokluğu çalışır |
| F10 | Invalid UTF-8/JSON/8 MiB üstü satır | Sınırlı bellek, açık hata, upstream abort |
| F11 | İki araç iç içe delta, ters bitiş | Ayrı callId; terminal mismatch'te executable call yok |
| F12 | Text A, reasoning B, tool C interleaving | Item ID/index sabit; C açılınca A/B kapanmaz |
| F13 | Provider-owned / undeclared tool | Provider aracı client'ta tekrar çalıştırılmaz; unknown client tool error |
| F14 | Finishsiz EOF, abort, error | Hiçbir completed/message_stop başarı terminali yok |
| F15 | Finish + metadata + EOF / bozuk tail | Tek success veya tek error; completed ardından failed yok |
| F16 | Length + yarım tool, bilinmeyen reason | incomplete/max_tokens; yarım tool yürütülmez; unknown başarı olmaz |
| F17 | Usage cache ve reasoning | Native 100/60/10/20 → Claude 30, Responses 100/120; double count yok |
| F18 | Eksik/negatif usage ve metadata altkümesi | Sahte 0 veya negatif/clamp yok; geçerli 1h write iki kez eklenmez |
| F19 | JSON/SSE içerik eşitliği | ID'ler normalize edilince final içerik/usage/stop eşit |
| F20 | SSE errors + heartbeats | Errors sequence taşır; ping sequence'yi değiştirmez; doğru error schema |
| F21 | İlk içerik gecikmesi / bounded prelude | Header sonrası timer commit; heartbeat içerik beklerken de akar |
| F22 | Headers öncesi error / sonrasında error | Önce HTTP error; sonra stream error; raw secret yok |
| F23 | Yavaş downstream + drain gelmeden close | Writer iptal olur; sonsuz queue/listener/timer kalmaz |
| F24 | İstemci iptali / upstream idle / tail timeout | Upstream AbortSignal tetiklenir; lease bırakılır |
| F25 | Aynı binding busy ve dört farklı binding | İlki 409; dört farklı request eşzamanlı başlar |
| F26 | Aktif TTL aşımı / aynı session farklı agent | Aktif entry yenilenmez; ayrı agent'lar doğru ayrılır |
| F27 | Cache-key çakışması / hint yok / restart | Cache key konuşmaları birleştirmez; hint yokta bağımsız identity |
| F28 | Bütün route'larda auth/body/error | models auth, count_tokens malformed body, çift auth conflict; process ayakta |
| F29 | Unsupported control ve null state | Sessiz atma yok; allowlist defaultlar kabul; upstream 0 veya tam beklenen POST |
| F30 | Request/output/session/concurrency limit | Açık 413/429/502; bounded memory; aktif session tahliye edilmez |
| F31 | pause_turn disabled ve enabled 6 segment | Disabled açık hata; enabled state/body eşit, tek final, usage segment başına bir |
| F32 | Empty reasoning-only / opaque state / unknown event | Fake reasoning/text/success yok; explicit error |
| F33 | Secret sızıntı sentinel testi | Key/prompt/tool/image/session test sentinel'ları hiçbir log/error'da yok |
| F34 | Startup, tek entrypoint, cleanup | Config placeholder reddi; src/server start; normal stop'ta açık socket/timer yok |
| F35 | Gerçek 310 s sentetik sessiz upstream | Heartbeat devamı, toplam süre timeout'u yok, sonra geçerli completion |

F35 testinin ilk safhası upstream header + start verir, 310 s gövde sessizliği
sonra text/finish/EOF yollar. Clock fake testi de yapılabilir, ama release'te
bir gerçek süreli koşu bulunur. Header gecikmesi bunun ayrı testidir.
F31 enabled dalı offline test edilir; canlı kanıt yoksa configte enabled açılmaz.

## 3. Gerçek istemci / native karşılaştırma

Her hücre sürüm + model + config hash + tarih + sonuç + güvenli evidence yolu
ile doldurulur. Güncel kapsam ve açık kapılar evidence/release.md tablosundadır.

| ID | Zorunlu senaryo | Uygulanacağı hedef |
|---|---|---|
| L01 | Custom endpoint gerçekten Astra1'e geliyor; text cevap | Claude Code CLI, Codex CLI |
| L02 | Read-only tool isteği → yerel sonuç → model finali | İki CLI, en az 3 turn |
| L03 | Tool hata sonucu → model düzeltme/cevap; duplicate execution yok | İki CLI |
| L04 | Dört konuşma aynı anda; mümkünse bir client subagent | İki protokol birlikte |
| L05 | Client cancel + uzun ilk içerik/uzun cevap | İki CLI; client timeout etkisi |
| L06 | Screenshot/user image ve tool içinden image dönüşü | İki istemcinin gerçek kullandığı biçim |
| L07 | Gerçek uygulama içinden L01–L03 | İlan edilecek Claude Desktop, Claude VS Code, Codex Desktop/IDE sürümleri |
| L08 | Aynı profile sahip CLI'ın native request'iyle structural compare | Versiyon, header aileleri, zarf alanları, araç/System dönüşümü |
| L09 | Varsayılan client tool/state/beta payload envanteri | 422 olan normal iş akışı bırakılmamış olmalı |
| L10 | Model capability: reasoning, pause, boş system | Kullanılacak özelliğe göre; kapalı özellik için açık not |

L06'da gerçek client tool-result image gönderirse mevcut 422 tabanı yeterli
sayılmaz; CLI orchestration'daki image promotion davranışı kontrollü fixture ile
uygulanır. L09'da Codex custom/freeform tool kullanıyorsa mapper veya gerçekten
çalışan belgeli client ayarı teslim edilir. Bu işleri “P2” diye taşıyarak istenen
Claude/Codex final uyumluluğu ilan edilmez.

Desktop veya IDE erişilemiyorsa o hedef NOT_RUN kalır. “CLI geçti, Desktop da
geçmiştir” denmez. Kullanıcının hedeflerinden yalnız bir kısmı geçtiyse rapor
tamamlanan kısmı açıkça söyler; genel uçtan uca final sonucu verilmez.

## 4. Native parity oracle oluşturma

1. Aynı pinned CLI sürümü/model/workspace profiliyle küçük sentetik konuşma üret.
2. Kayıttaki gerçek /alpha/generate request'i seç; snapshot'ları kalıcı recorder
   ID'siyle tekilleştir. Stream için reconstructed görünümü yalnız bir kez oku.
3. Secret'ları çıkar; session/thread/call/random item değerlerine tutarlı
   placeholder atayarak ilişkileri koru. Prompt içeriği sentetik olmalı.
4. Native serializer helper'ları statik referans alınır; dağıtım import edilmez,
   arbitrary CLI kodu eval edilmez. Compiler'a aynı semantik input ver.
5. Header projection ve parsed JSON deep equality karşılaştır. Null/absence
   farkını, tools/system/images ve alias mapping'i maskeleme.
6. Canlı run sonucu ile sentetik offline expectation'ı ayrı dosyalarda etiketle.

Şimdiki fixtures/contract-cases.json sentetik referanstır; bir gerçek client
capture'ı veya çalışan renderer egress golden'ı olduğu iddia edilmez.
Runtime agent'ları gerçek compiler/reducer/encoder çıktısını bu beklentilere
karşı test eden assertion'ları ayrıca yazacaktır.

## 5. Release raporu şablonu

E görevi sırasında evidence/release.md oluştur:

~~~text
Durum:
Test tarihi:
Node / OS:
CLI wire sürümü / SHA:
Bridge revision / config hash:
Claude sürümü / endpoint seçme yöntemi:
Codex sürümü / endpoint seçme yöntemi:
Model ve aktif capability'ler:
F01–F35: test adı, komut, pass/fail
L01–L10: istemci, komut/işlem, pass/fail/not_run, evidence
Kalan engeller:
İlan edilebilen kesin destek kapsamı:
~~~

Kurulum keyleri veya ham istemci geçmişleri bu rapora eklenmez.
