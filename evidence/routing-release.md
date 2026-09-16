# Model, effort, trace ve cache doğrulaması · 15 Eylül 2026

## Sonuç

Hesap `deizermonokixhtf`, upstream `meta/muse-spark-1.3-contributor`.
Kaydedilmiş anahtarın SHA-256 izi `154c5a419e33`; anahtar rapora alınmadı.
`/alpha/whoami` hesabı doğruladı, organizasyon alanı boştu. UI aynı doğrulamayı gösterir.

Gerçek Claude Code 2.1.272 ile üç tur Read → Read → metin;
Codex CLI 0.154.0-alpha.6.2 ile hatalı Read → başarılı Read → sonuç geçti.
Altı generation isteği HTTP 200 ve doğrulanmış terminal ile tamamlandı.
Her iki istemcide de istenen ve gönderilen effort `low` idi.

## Trace ve gerçek ücret

Oturum kimliği ile trace ayrıdır. Yeni `conversation` modu aynı konuşmada aynı
W3C trace ID, her istekte yeni span ID gönderir. Bu, native CLI'ın iteration
başına trace yaklaşımından kullanıcının istediği bilinçli ayrımdır.

[Command Code kullanım panelinde](https://commandcode.ai/deizermonokixhtf/settings/usage)
giriş yapılmış oturumla şu satırlar görüldü. Zamanlar Türkiye saatidir.

| İstemci | Saat | Ortak trace öneki | Input / output | Gösterilen USD |
|---|---|---|---|---|
| Claude | 19:21:37 | 0b4dc874… | 857 / 579 | 0.000190 |
| Claude | 19:21:40 | 0b4dc874… | 1251 / 106 | 0.000135 |
| Claude | 19:21:49 | 0b4dc874… | 2073 / 584 | 0.000213 |
| Codex | 19:23:57 | d16544e5… | 2836 / 400 | 0.000353 |
| Codex | 19:23:59 | d16544e5… | 3049 / 109 | 0.000316 |
| Codex | 19:24:02 | d16544e5… | 3182 / 31 | 0.0000499 |

Altısı da Muse Contributor / COMPLETED. Aynı trace satırları birleştirip ücret
kaydını silmedi; ayrı request satırları kaldı. Toplamlar Claude **$0.000538**,
Codex **$0.0007189**; bunlar panelde gösterilen tutarların toplamıdır.
Kullanıcı panelin 3–4 dakika gecikmeli işlendiğini bildirdi; gecikme sonrası
100 satırlık görünümde kayıtlar bulundu. Bu gecikme inference süresi değildir.
Yakındaki DeepSeek satırları bu testin model/sayaç/trace kayıtlarıyla eşleşmedi;
onların hangi başka süreçten geldiği bu incelemede belirlenmedi.

## Streaming ve yavaşlık

[Claude ölçümü](continuity-routing-low.json): son yanıt ilk metni 4.252 saniyede
geldi; 89 delta 4.039 saniyeye yayıldı. Önceki ayrı koşuda ilk metin 13.158 saniye
idi. Bunlar farklı model örneklemeleridir; sabit hızlanma oranı veya SLA değildir.
Önceki [transport ölçümü](continuity-release.md) native metin geldikten sonra
bridge gecikmesini en fazla 1 ms, CLI'a ulaşmayı 8 ms ölçtü.

Metin geldiği anda SSE'ye aktarılıyor. Tam yanıtı bölüp sahte stream üretmiyoruz.
İlk metinden önceki model reasoning/üretim beklemesi hâlâ mümkün. Başlangıç ve
effort gelmeyen istekler `low`; kullanıcı UI'dan değiştirebilir. Tool argümanları
provider sahipliği ve terminal çağrı doğrulanana kadar tamponlanır; tool JSON'u
blok halinde görünmesi beklenen davranıştır.

## Cache

| İstemci / tur | Input toplam | Cache read | Uncached | Cache write |
|---|---:|---:|---:|---|
| Claude 1 | 857 | 113 | 744 | Bildirilmedi |
| Claude 2 | 1251 | 113 | 1138 | Bildirilmedi |
| Claude 3 | 2073 | 1137 | 936 | Bildirilmedi |
| Codex 1 | 2836 | 113 | 2723 | Bildirilmedi |
| Codex 2 | 3049 | 113 | 2936 | Bildirilmedi |
| Codex 3 | 3182 | 2801 | 381 | Bildirilmedi |

Kaynak native usage sayaçlarıdır; cache read toplam input değildir. Son Codex
isteğinin okuma oranı %88,03. Cache miss sıfır değil. İlk iki turda az prefix
yeniden kullanılmış, üçüncü turda artmış. Bunlar server-side cache eligibility,
history ve yeni tokenlarla ilgilidir; yalnız trace eşitlemek cache garantisi vermez.
Model/config/system/tools prefix'i bu koşularda sabit kaldı; bu ölçüm bütün
geçmişin byte olarak aynı olduğunu iddia etmez. Başlatıcı artık sırf CLI açmak
için git/config prefix'ini yeniden yazmıyor. Model/effort/ayar değiştirmek prefix'i
değiştirebilir.

Dashboard eski satırlarda cache ayrıntısı sunmuyor; sadece toplam input ve ücretten
geçmiş miss nedeni çıkarılamaz. Eksik sayaç `null` / UI'da `?`; sıfır uydurulmaz.
Trace/ücret DOM gözlemi [routing-dashboard.json](routing-dashboard.json), native
Codex kayıtları [codex-error-then-read.json](codex-error-then-read.json) içindedir.

## UI ve istemci kontrolü

- Çoklu alias → upstream ID, her model için sekiz giriş effort eşlemesi,
  başlangıç modeli/effort ve trace modu kaydediliyor.
- Kurulu CLI 1.54.0 statik kataloğundaki 40 modelin effort bilgisi kullanılıyor.
  Muse: low/medium/high/xhigh. Katalogda olmayan model açıkça doğrulanmamış gösterilir.
- Aynı model adını iki kez ekleme hatası tarayıcıda gösterildi; kaldırma ve tekrar
  kayıt başarılı. 390 × 844 ekranda yatay taşma yok; tarayıcı error logu boş.
- Claude Başlat düğmesi görünür Windows terminalini, Node başlatıcısını ve gerçek
  claude.exe sürecini açtı. Native masaüstü ekranı otomasyonla okunmadı.
- Ayrı gerçek CLI PTY oturumunda `/model` menüsü iki yapılandırılmış adı ve gerçek
  upstream açıklamalarını gösterdi; `astra-muse` seçimi uygulandı.
  Claude `modelPicker` ve Codex yerel model kataloğu her açılışta oluşturulur.
- Claude bilinmeyen özel model için 200k context varsayımı uyarısı verebilir;
  doğrulanmamış context kapasitesi veya sahte Claude model kimliği ayarlanmadı.
- Başlat düğmesi form değiştiyse önce kaydeder. Global istemci profilleri değişmez.
- Servis yeniden başlatıldıktan sonra UI bağlantı testi başarılı: 7.883 saniye,
  alias astra-muse → Muse, varsayılan → low. Bağımsız bu soğuk istekte native
  sayaç 7334 input / 0 cache read / 7334 uncached bildirdi; önceki konuşmanın
  %88 oranının her istek için geçerli olmadığı UI'da da görüldü.

50/50 kısa test geçti: iki protokolde effort dönüşümü, aynı trace/farklı span,
farklı konuşma izolasyonu, metnin terminalden önce iletilmesi, cache unknown/zero,
admin yetkisi/Host kontrolü, çoklu model kaydı ve geçersiz kaydın diski koruması.
Önceki 310 saniye sessizlik testi kanıtı korunuyor; transport değişmediği için
bu güncellemede uzun test yeniden çalıştırılmadı.

## Kapsam sınırı

Claude Messages ve Codex Responses desteklenir. ChatGPT web uygulaması genel bir
özel model base URL ayarı sunan istemci değildir; bu teslim onu dönüştürmez.
Chat Completions, hosted araçlar, previous_response_id, compaction ve schema
output mevcut sözleşmede destek dışıdır. Önceki release sınırları geçerlidir.

Resmî istemci ayar kaynakları:
[Claude modelPicker](https://code.claude.com/docs/en/settings-reference#modelpicker),
[Claude model ayarı](https://code.claude.com/docs/en/model-config),
[Codex config](https://learn.chatgpt.com/docs/config-file/config-reference).
