# Astra1 çalışma kuralları

Kullanıcı uygulamayı da istedi. Runtime ve CLI başlatıcıları oluşturuldu.
Güncel kanıt evidence/release.md; devam işleri IMPLEMENTATION.md içindedir.

1. Önce README.md, ARCHITECTURE.md, CONTRACTS.md, contracts.d.ts ve kendi kabul
   maddelerini oku. Çelişki varsa uygulamadan önce kanıtla çöz ve sözleşmeyi güncelle.
2. Ponytail: Node ESM, platform kütüphaneleri, tek servis. Paket/framework/DB/router
   eklemek yerine var olan altı modül içinde çöz. Uydurma stub endpoint yazma.
3. Bütün yazılar bu klasörde. Kardeş projeler referanstır; çalışma ayarlarını veya
   kaynaklarını bu iş kapsamında değiştirme.
4. Kullanıcı görevlendirmesi olmadan başka agent başlatma. Birden çok agent
   görevlendirildiyse IMPLEMENTATION.md dosya sahipliğine uy; ortak sözleşme
   değişikliklerini entegratör birleştirir.
5. Native wire referansı CLI 1.54.0 ve evidence/baseline.json içindeki hash'tir.
   Minify ofsetleri Unicode code point cinsindedir. Kaynağı import edip çalıştırma.
6. Eski bridge'in testleri bağımsız doğruluk oracle'ı değildir. Özellikle tool
   error reddini, cache çıkarımını, sentetik imzayı ve erkenden completion'ı kopyalama.
7. İstemci credential'ını upstream'e geçirme. Gerçek key, prompt, tool payload,
   session kimliği veya image byte'larını loga/fixture'a yazma.
8. Bilinmeyen alanları veri kaybederek geçirme. CONTRACTS.md alan politikasını uygula.
   Upstream POST retry ve endpoint fallback varsayılan kapalı.
9. Tamamlanma yalnız doğrulanmış terminal geçişidir. HTTP 200, heartbeat, socket
   kapanması veya test sayısı tek başına başarı değildir.
10. Kendi değişikliğin için ACCEPTANCE.md'deki anlamlı testleri çalıştır. Sentetik
    fixture'ı gerçek capture diye etiketleme. Yapılmayan testi passed yazma.
11. Tek runtime giriş noktası src/server.mjs olacak. bridge.mjs monolitini veya
    kardeş projeye runtime import bağımlılığını getirme.
12. Canlı testlerin sürüm/model/komut/sonuç kaydını secretsız tut. Kapsam daraltarak
    zorunlu bir kapıyı geçmiş sayma; gereken özelliği uygula veya eksikliği açık bırak.
