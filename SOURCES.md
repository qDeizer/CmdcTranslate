# Kanıt ve eski prototipten çıkarılan kararlar

## 1. Bu turda gerçekten yapılan inceleme

- Kullanıcının dört pasted-text dosyasındaki rapor ve iddialar tarandı; ortak
  protokol bölümleri mevcut kaynaklarla karşılaştırıldı.
- commandcode-native-bridge/src içindeki decoder, native compiler, parser,
  encoder, server ve session akışları incelendi; testler ve monolit giriş
  noktası kontrol edildi.
- Kurulu CLI package.json sürümü 1.54.0, dist/cli.mjs SHA-256 değeri yeniden
  doğrulandı; serializer ve createModelClient fonksiyonları statik okundu.
- 15 Eylül sanitize aggregate ve son kapsamlı rapor okundu. Bu turda 36 GB
  ham recorder corpusunun yeniden tarandığı iddia edilmiyor.
- Resmi OpenAI/Codex ve Anthropic/Claude belgeleri açıldı.
- Eski projede npm.cmd test çalıştırıldı: **20 monolit self-check + 20/20
  modüler test passed**. Eski rapordaki 11 self-check sayısı güncel değil.
- Üç ek küçük yerel probe cache hesabı, erken finish ve aktif session TTL
  hatasını yeniden üretti. Gerçek inference çağrısı yapılmadı.

Hash ve test ortamı [baseline.json](evidence/baseline.json) içindedir. Dosya
hash'i kaynağın bu turdaki halini sabitler; rapordaki her iddianın doğru olduğunu
garanti etmez.

## 2. Kaynak sırası

1. Kontrollü gerçek native request/stream ve gerçek hedef istemci davranışı.
2. Hash'i sabitlenmiş CLI serializer/parser.
3. Hedef API'nin açılmış resmi sözleşmesi.
4. Mevcut prototip kodu ve test sonuçları.
5. Geçmiş agent raporları; hipotez kaynağı.

Çelişkide “son rapor böyle diyor” yeterli değildir. Örneğin CLI assistant
sırasını koruyor; eski prototip ise reasoning/text/tool diye değiştiriyor.
Tercih CLI statik kaynağına göre yapıldı.

## 3. Yerel kaynaklar

| Ref | Dosya | Kullanım |
|---|---|---|
| P1 | [Kullanıcı rapor 1](C:/Users/Emre/.codex/attachments/1d61f0a0-9c25-4eb2-a249-b797913aeb9a/pasted-text.txt) | Ana mimari, çelişki ve risk envanteri |
| P2 | [Kullanıcı rapor 2](C:/Users/Emre/.codex/attachments/1cba7fdc-b58a-4fe2-9dab-170a9136fad1/pasted-text.txt) | CLI kod parçaları ve önceki öneriler |
| P3 | [Dört Muse oturumu raporu](C:/Users/Emre/.codex/attachments/83385dcc-b6d6-49d7-9f0f-822e9ff73167/pasted-text.txt) | Sessiz reasoning, uzun akış, image döngüsü hipotezleri |
| P4 | [Nexus raporu](C:/Users/Emre/.codex/attachments/7e124bc1-1839-42aa-8aeb-85f734752525/pasted-text.txt) | Fingerprint/signature/WebSocket iddialarının kontrolü |
| N1 | [CLI statik notu](../analysis-commandcode-2026-09-14/native-cli.md) | Serializer ve native continuation |
| N2 | [CLI ofset manifesti](../analysis-commandcode-2026-09-14/native-cli-evidence.json) | SHA ve Unicode ofsetleri |
| N3 | [Kurulu native dağıtım](C:/Users/Emre/AppData/Roaming/npm/node_modules/command-code/dist/cli.mjs) | Statik birincil referans |
| R1 | [15 Eylül final raporu](../analysis-commandcode-2026-09-15/COMMANDCODE_FINAL_COMPREHENSIVE_REPORT.md) | Sentez ve önceki veri yöntemleri |
| R2 | [15 Eylül sanitize aggregate](../analysis-commandcode-2026-09-15/muse-evidence-sanitized.json) | 142 HTTP 200, 139 finish, maksimum 307436.591 ms |
| C1 | [Eski prototip](../commandcode-native-bridge/README.md) | Yeniden kullanım adayları ve mevcut test baseline'ı |

CLI sha256: 0de512d28b0a66708fbb0e367443ad7f9f9d4e8eda62a76563f1493b997dd61d.
Statik Unicode ofsetleri: toWireTools 807969; toWireMessages 808236;
toWireSystem 809182; createModelClient 815055. UTF-16 JS string offset'i
olarak kullanma.

## 4. Somut eski kod açıkları

Satırlar bu inceleme anındaki kardeş projeye aittir. Astra1 bu dosyaları değiştirmedi.

| Açık | Kanıt | Astra1 karşılığı |
|---|---|---|
| Test ve runtime iki implementasyon | [package.json:8](../commandcode-native-bridge/package.json:8) start monolite gidiyor | Tek src/server entrypoint |
| is_error tool sonuçları reddediliyor | [native.mjs:51](../commandcode-native-bridge/src/native.mjs:51), ayrıca user dalı | F05, hata metnini ilet |
| Assistant sırası değişiyor | [native.mjs:45](../commandcode-native-bridge/src/native.mjs:45) | F04, CLI gibi sırayı koru |
| Typed search wire'a iç adla gidiyor | [ingress.mjs:108](../commandcode-native-bridge/src/ingress.mjs:108) | F07, request-local ters tablo |
| İsimden tool kind tahmin ediliyor | [egress.mjs:173](../commandcode-native-bridge/src/egress.mjs:173) | Aynı isimli function ile typed search ayrılır |
| Responses cache toplamdan çıkarılıyor | [egress.mjs:195](../commandcode-native-bridge/src/egress.mjs:195) | Probe: beklenen 100, gerçek 30; F17 |
| Tool açılınca reasoning/text kapatılıyor | [egress.mjs:171](../commandcode-native-bridge/src/egress.mjs:171) | F12, item Map ve source end |
| Finish ledger doğrulamasından önce emit | [stream.mjs](../commandcode-native-bridge/src/stream.mjs) finish/close dalları | Probe: finish emit, sonra incomplete_tool_arguments; F15 |
| Prelude yalnız olay sayısıyla sınırlı | [server.mjs:139](../commandcode-native-bridge/src/server.mjs:139) | F21, süre/byte/olay bütçesi |
| Heartbeat ayrı write; backpressure yok | [server.mjs:163](../commandcode-native-bridge/src/server.mjs:163) | F23, tek writer |
| count_tokens JSON hatası dış try sınırında | [server.mjs:90](../commandcode-native-bridge/src/server.mjs:90) | F28, ortak route hata sınırı |
| Aktif session TTL bitince kilit değişiyor | [session.mjs:25](../commandcode-native-bridge/src/session.mjs:25) | Probe: ikinci turn kabul edildi; F26 busy önce |
| Native'den gelmeyen signature üretiliyor | [egress.mjs:4](../commandcode-native-bridge/src/egress.mjs:4) | Gerçek signature gibi sunma; model/client gate |

Bu tablo bütün eski monolitin tam güvenlik denetimi değildir; yeni temel için
doğrulanmış, ilgili davranışların incelemesidir.

## 5. Çelişki kararları

| İddia | Sonuç |
|---|---|
| “144 isteğin 144'ü başarılı” | Aggregate 142 status=200, 139 finish; başarı bu sayaçlardan ayrı değerlendirilir |
| “30 saniye byte timeout yeterli” | 307 s toplam süre, maksimum byte-idle ölçümü değildir; 600 s başlangıç seçimi tasarım |
| “Heartbeat bağlantıyı asla düşürmez” | Yanlış garanti; yalnız downstream sessizliğini azaltır, upstream veya proxy limitini kaldırmaz |
| “Fingerprint zorunlu handshake” | Static telemetry akışı bunu kanıtlamıyor; defaultta eklenmez |
| “0x12 signature Anthropic ile aynı” | İntegrity signature değildir; defaultta üretilmez |
| “Her assistant reasoning-first yeniden sıralanmalı” | Native serializer sıralamıyor; profile-specific validasyon başka konudur |
| “Boş system'e kesin tek boşluk” | Kontrollü A/B kanıtı yok; preserve |
| “Dangling tool history budansın” | Veri kaybı; açık 422 |
| “prompt_cache_key konuşma anahtarıdır” | Cache anahtarı eşsiz konuşma garantisi vermez; oturum binding'inden çıkarıldı |
| “Codex için backend WebSocket şart” | Custom provider HTTP Responses ayrı yol; hedef sürümde canlı doğrulama gerekir |

## 6. Açılmış resmi kaynaklar · 15 Eylül 2026

- [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference):
  custom provider base URL, env_key, headers, Responses ve ayrı WebSocket desteği.
- [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events):
  output/item/content/arguments olayları ve sequence_number.
- [Responses create](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create):
  request/response şekli, input/output usage ve cache alt alanları.
- [Streaming responses guide](https://developers.openai.com/api/docs/guides/streaming-responses):
  HTTP SSE akışı.
- [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming):
  message/block olayları, ping ve signature_delta.
- [Claude Code gateway](https://code.claude.com/docs/en/llm-gateway):
  gateway bağlantısı; açılan güncel sayfa eski search snippet'iyle aynı metin değil.
- [Claude Code environment](https://code.claude.com/docs/en/env-vars):
  CLAUDE_CODE_DISABLE_THINKING düşünmeyi upstream model içinde durdurma
  garantisi vermez; request'te thinking parametresinin gönderimini kaldırır.

Web sayfaları gelecekte değişebilir. Yayın agent'ı hedef sürümleri ayrıca sabitler.
Mimari runtime tamamlandığını veya hiçbir edge case kalmadığını iddia etmez.
# Uygulama aşamasındaki ek kaynaklar

15 Eylül 2026: güncel gerçek test sonuçları [release kaydında](evidence/release.md).
İlk mimari baseline değiştirilmedi.

- [Codex yapılandırma referansı](https://learn.chatgpt.com/docs/config-file/config-reference):
  model_catalog_json, custom Responses provider, Windows sandbox, Apps ve web_search.
- [Codex model metadata şeması](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs):
  yerel catalog zorunlu alanları ve apply_patch_tool_type.
- [Codex ResponseItem şeması](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs):
  namespace alanı ve function call/output ilişkisi.
- [Claude ayar önceliği](https://code.claude.com/docs/en/settings):
  izole config ve komut kapsamlı ayar dosyası.
- Yerelde claude --help, claude --version, codex exec --help,
  codex debug models --bundled ve codex --version kontrol edildi.
- [Canlı native probe özeti](evidence/native-probe.json): high effort ile imzasız
  reasoning üretildi; önceki none-observed profile bilgisi güncellendi.
