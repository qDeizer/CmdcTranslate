# Claude terminalinde toplu görünme · 16 Eylül 2026

**Durum: HTTP akışı doğrulandı; kurulu Claude Code 2.1.273 Windows
istemcisinde metnin canlı görünmesi çözülmedi.** Önceki API akış testleri
terminalin metni aynı anda çizdiğini kanıtlamıyordu.

## Video ve gerçek terminal

38,21 saniyelik kullanıcı videosu: 0–5 saniye 1 fps, orta bölüm 4 saniyede
bir, 32–38 saniye 2 fps örneklendi. 12–34,5 saniyede token sayacı artıyor;
thinking satırı görünüyor ama şiir yaklaşık 35. saniyede topluca beliriyor.
Kareler özel test klasöründedir, depoya alınmadı.

Gerçek etkileşimli Claude CLI ile ayrı yerel köprü/profile üzerinde yeniden
üretildi. Model `z-ai/glm-5.3-flash`, effort `low`; global ayarlar değiştirilmedi.
Native NDJSON ve istemciye yazılan SSE aynı saatle, yalnız olay türü, sıra,
karakter sayısı ve zaman olarak kaydedildi: [ölçüm](render-baseline.json).

| Ölçüm | Sonuç |
|---|---:|
| Upstream HTTP başlıkları | 2.584 ms |
| İlk metin, isteğin başlangıcından | 9.852 ms |
| Son metin | 21.111 ms |
| Metin delta sayısı | 395 |
| İlk–son metin arası | 11.259 ms |
| İlk native delta → SSE yazımı | 1 ms |

Bu istekte tek metin bloğu, indeks 0; thinking veya tool bloğu yok.
Dolayısıyla bu tekrar üretimde blokların iç içe geçmesi neden değil.
CLI sayacı üretim sırasında arttı, metin tamamlanınca göründü. İlk tokena
kadar geçen upstream bekleme ile terminalin metni saklaması ayrı sorunlar.
Ölçümdeki yardımcı `not_found` kaydı başarılı Messages isteğinin sonucu değildir.

## Kurulu istemcideki gösterim koşulu

İkili dosya yalnız okundu, değiştirilmedi. `claude --version`: 2.1.273.
SHA-256: `19654006672b6da7c945115eea99ca10051796016df563a65b3f0c7d72720ef0`.

Gömülü JavaScript'te tek tanımlı `nEt()` sabit `true` döndürüyor.
Tek tanımlı `oZ(prefersReducedMotion, nEtResult)` ikinci argüman true ise
false döndürüyor. Hem `showStreamingText` hem akış deposunun
`isStreamingTextVisible` çağrısı bu koşulu kullanıyor. Görünürlük false
olunca metin önizlemesi null yapılıyor; token sayacı ayrı güncelleniyor.
Bu, ölçülen davranışı açıklayan kurulu sürüme özgü yerel bulgudur;
tüm platformlar/sürümler için genelleme değildir. `prefersReducedMotion=false`
bu sabit ikinci koşulu açamaz. Binary patch veya rastgele sürüm düşürme yapılmadı.

Anthropic deposundaki [80364 numaralı bildirim](https://github.com/anthropics/claude-code/issues/80364)
de sürekli SSE gelirken terminalde metnin yalnız sonda göründüğünü anlatıyor.
Bu kullanıcı bildirimi resmi düzeltme veya kök neden teyidi değildir.

## Gateway karşılaştırması

- [LiteLLM pass-through kaynak kodu](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/pass_through_endpoints/streaming_handler.py):
  doğrudan yolda upstream byte parçaları geldikçe yield edilir. Son yanıtın
  tamamlanmasını beklemek streaming için gerekli değildir.
- [Cloudflare Workers Streams](https://developers.cloudflare.com/workers/runtime-apis/streams/):
  okunabilir akış Response'a bağlanabilir; bütün gövdeyi önce belleğe almak gerekmez.
- [NGINX proxy modülü](https://nginx.org/en/docs/http/ngx_http_proxy_module.html):
  proxy buffering kapatılabilir; `X-Accel-Buffering: no` yanıtı da bunu kontrol eder.
  Astra1 bu başlığı zaten gönderiyor. Bu testte arada NGINX bulunmuyor.
- Yerel 9router, native satırları geldikçe Chat Completions deltalarına ve
  ardından Claude bloklarına çeviriyor. Thinking/text geçişlerinde önceki bloğu
  kapatıyor. Mevcut tekrar üretimde yalnız tek text bloğu olduğundan bu fark
  toplu görünmeyi açıklamıyor. Upstream kapanınca koşulsuz DONE üretme yaklaşımı
  doğrulanmış tamamlanma sözleşmemize taşınmadı.

Sonuç: passthrough yöntemleri mevcut köprünün artımlı okuma/yazma yaklaşımını
destekliyor. İstemcinin kapalı önizlemesini gateway tarafında sahte bloklar,
erken completion veya kelime animasyonu ekleyerek düzeltmek doğru değil.
Thinking içeriği upstream tarafından üretilirse iletiliyor; bu GLM tekrar
üretiminde reasoning token sayısı sıfır. Videodaki thinking satırı ayrı gözlemdir.

## Açık kabul maddesi

Görsel akışın düzeldiği söylenebilmesi için aynı terminalde yanıt tamamlanmadan
metnin görünmesi tekrar gözlenmeli. Desteklenen bir istemci düzeltmesi henüz
doğrulanmadı. Bu inceleme runtime davranışını değiştirmiyor; mevcut sabit trace
ve cache düzenini koruyor.
