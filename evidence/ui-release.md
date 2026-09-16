# Astra Console UI doğrulaması

Tarih: 2026-09-15

## Kanıt dosyaları

- Tasarım konsepti: `evidence/ui-concept.png`
- Masaüstü uygulama: `evidence/ui-desktop.png` (1440 × 1000)
- Mobil uygulama: `evidence/ui-mobile.png` (390 × 844)

## Tarayıcı doğrulaması

Codex in-app browser ile gerçek `http://127.0.0.1:8742/` sayfası kullanıldı.
Erişilebilirlik ağacı, Playwright locator'ları ve gerçek viewport görüntüleriyle:

- config GET yüklemesi ve bütün alan değerleri,
- API anahtarının geri gösterilmemesi,
- panelden config kaydı,
- gerçek Command Code bağlantı testi (`ASTRA_OK`),
- Claude Code 2.1.272 ve Codex CLI 0.154.0-alpha.6.2 tespiti,
- 390 px görünümde yatay taşma olmaması,
- üst ve alt mobil içeriklerin erişilebilirliği

doğrulandı. Yerel PNG kanıtları aynı URL'nin Chromium render'ından alındı ve
ayrıca görsel olarak incelendi.

## Konsept karşılaştırması

| Nokta | Sonuç |
|---|---|
| Üç numaralı ayar bölümü + sağ durum paneli | Korundu |
| Claude/Codex → Command Code rota diyagramı | Korundu |
| Koyu lacivert, cyan rota, mint başarı sistemi | Korundu |
| Komut kopyalama ve son işlem alanı | Korundu |
| Mobilde tek kolon akış | Uygulandı ve 390 × 844'te doğrulandı |

Copy farkları işlevsel profile göre bilinçli güncellendi: konseptteki örnek
Claude modeli yerine canlı doğrulanmış Muse kimliği; genel takım adları yerine
istemcide seçilecek model alias'ları; `npm run` yerine Windows'ta çalışan
`npm.cmd run`; örnek tarih yerine gerçek kayıt zamanı kullanılıyor.

Kalan görsel farklar: konseptteki masaüstü pencere düğmeleri browser sayfasında
yer almıyor; dekoratif telefon maketi yerine gerçek responsive sayfa teslim
ediliyor. Native klasör seçici eklenmedi; mutlak yol alanı doğrudan doğrulanıyor.

## Çalışma kanıtı

- Offline: 44/44 test geçti.
- Foundation: 7 belge, 12 sentetik vaka, 18 kaynak.
- Panel bağlantı testi: başarılı.
- Claude error → recovery → read: başarılı, exact final token.
- Codex error → recovery → read: başarılı, exact final token.
