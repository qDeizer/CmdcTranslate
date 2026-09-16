# Snake · Claude Code canlı demosu

Oyun dosyası: `index.html`. Dosyayı çift tıklayıp tarayıcıda açabilirsiniz.
Dış bağımlılık veya build gerekmez.

Ok tuşları / WASD ile yön, Space ile duraklat / devam et. Mobilde yön düğmelerini
kullanın. Duvar veya gövde çarpışmasından sonra Yeniden Başlat düğmesine basın.

Oyun ve `verify.mjs`, gerçek Claude Code CLI 2.1.272 üzerinden,
`deizermonokixhtf` hesabının anahtarıyla ve
`meta/muse-spark-1.3-contributor` modeliyle üretildi. Host oyun kodunu yazmadı.

Oyun mantığı kontrolü:

```powershell
cd C:\Users\Emre\Desktop\Taha\Astra1\demos\snake
node verify.mjs
```

Akış, hesap/model ve oyun dosyalarının birlikte bağımsız kontrolü:

```powershell
cd C:\Users\Emre\Desktop\Taha\Astra1
node scripts/check-snake.mjs
```

Kanıt: `evidence/claude-snake.json` ham yapısal sayaçlar;
`evidence/claude-snake-verified.json` bağımsız sonuç. Gerçek API anahtarı,
prompt veya araç payload'ı bu kayıtlara yazılmaz.
