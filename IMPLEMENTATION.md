# Uygulama ve devam rehberi

Runtime oluşturuldu. Güncel davranış CONTRACTS.md, doğrulanan kapsam
evidence/release.md içindedir.

Model/effort eşlemesi, konuşma trace'i, hesap ve cache ölçümleri, görünür CLI
başlatma tamamlandı. Güncel doğrulama: [routing-release](evidence/routing-release.md).

## Dosya sahipliği

| Dosya | Sorumluluk |
|---|---|
| src/core.mjs | Tür/alan doğrulaması, model yetenekleri, usage, güvenli hata |
| src/commandcode.mjs | Native compiler, http(s) transport, NDJSON parser, reducer |
| src/anthropic.mjs | Messages girişi, JSON/SSE çıktısı, token tahmini |
| src/responses.mjs | Responses girişi, namespace araçları, bağımsız output item'ları |
| src/session.mjs | HMAC konuşma bağlama, TTL, kapasite ve aktif turn kilidi |
| src/server.mjs | Tek runtime girişi, auth/route, SSE writer, iptal/kapatma |
| scripts/run.mjs | Yerel config/credential hazırlama, tek runtime'ı başlatma |
| scripts/client.mjs | İzole Claude/Codex istemci profilleri ve başlatıcı |
| codex.models.json | Codex'e sunulan gerçek gateway yetenekleri |
| test/ | Offline fixture, gerçek HTTP ve süre testleri |
| scripts/smoke-*.mjs | Hesaba inference gönderen canlı kabul testleri |

Kardeş commandcode-native-bridge dizini referanstır. Runtime oradan import yapmaz.

## Değişiklik döngüsü

1. AGENTS.md ve ilgili protokol bölümünü oku.
2. Gerçek client alanını veya native olayı kanıtla; ham private payload kaydetme.
3. Gerekli en küçük decoder/compiler/encoder değişikliğini yap.
4. Anlam kaybını yakalayan karşı örneği test et; yalnız uygulamayı tekrar eden
   testler ekleme.
5. npm test ve check:foundation çalıştır. Transport/timer değiştiyse test:long;
   client wire değiştiyse ilgili canlı CLI/API kabulünü tekrar çalıştır.
6. CONTRACTS.md, contracts.d.ts ve evidence/release.md sonuçlarını güncelle.

## Başlatma ayrıntıları

npm start tek src/server.mjs sürecini başlatır. npm bağımlılığı kurulmaz.
Gateway ve session secret'ı ayrı, upstream credential bunlardan farklıdır.
Credentials env ile child'a verilir; argümanda upstream key bulunmaz.
Config metadata'sındaki tarih/ortam/git durumu her başlatmada güncellenir.

Doğrudan kullanım:

~~~powershell
node src/server.mjs --config config.local.json
~~~

Bu yolda profile.auth içinde adı verilen üç env değişkeni önceden tanımlı
olmalıdır. Kolay başlatıcı mevcut Command Code login dosyasını da kullanır.

Claude başlatıcısı ayrı CLAUDE_CONFIG_DIR ve komut kapsamlı ayar dosyası kullanır.
Global ~/.claude/settings.json içindeki provider override'ları böylece devreye
girmez. Gateway token içeren .clients/ dizini gitignore kapsamındadır.

Codex başlatıcısı ayrı CODEX_HOME, yerel model_catalog_json, HTTP Responses ve
Windows unelevated sandbox kullanır. Sandbox izinlerini istemci belirler.
Web search/Apps bu profilde kapalıdır. Freeform apply_patch yerine function/shell
profili kullanılır; model catalog'u GPT modeli gibi başka yetenekler ilan etmez.

## Sonraki genişletmeler için açık işler

- Desktop ve VS Code uygulamalarında gerçek kurulum ve L01–L03 senaryoları.
- İki gerçek CLI'da iptal ve uzun ilk içerik testi; HTTP seviyesinde iptal ve
  310 saniye sessizlik zaten doğrulanmıştır.
- Taze Command Code CLI capture'ıyla L08 structural compare; mevcut oracle
  pinned CLI statik kaynağı ve sentetik golden'ları kullanır.
- İhtiyaç varsa JSON-schema output, custom/freeform grammar, hosted araçlar,
  compact/stateful Responses. Mevcut 422'leri sessiz veri kaybıyla kapatma.
- Pause continuation'ı açmadan canlı çok segmentli kanıt.
- İmzalı Anthropic thinking isteyen SDK'lar için kaynak sağlayıcının gerçek
  signature desteği. Hash veya sahte signature ekleme.

Bu liste yapılmış testlerin yerine geçmez. Geniş RELEASE_READY kapısı
ACCEPTANCE.md içindeki kanıtlar tamamlanınca kapatılır.

