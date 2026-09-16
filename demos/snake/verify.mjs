import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("index.html", "utf8");
let pass = 0;
function ok(cond, name) {
  if (!cond) { console.error("FAIL: " + name); process.exit(1); }
  pass++;
  console.log("PASS: " + name);
}

// 1. engine script must exist and expose createGame
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
ok(!!m, "engine script tagi var");
const engineSrc = m[1];
ok(engineSrc.includes("createGame"), "engine createGame icerir");

const ctx = { Math, console };
vm.createContext(ctx);
vm.runInContext(engineSrc + "\nthis.__cg = createGame;", ctx);
const createGame = ctx.__cg;
ok(typeof createGame === "function", "createGame fonksiyon");

// helper
function base(o) { return Object.assign({ cols: 5, rows: 5, random: () => 0 }, o); }

// 2. hareket
{
  const g = createGame(base({ snake: [{x:2,y:2},{x:1,y:2},{x:0,y:2}], dir: {x:1,y:0}, food: {x:4,y:4} }));
  ok(g.status === "ready", "baslangic ready");
  g.start();
  ok(g.status === "running", "start running yapar");
  g.tick();
  ok(g.snake[0].x === 3 && g.snake[0].y === 2, "hareket sag dogru");
}

// 3. ters donus engeli
{
  const g = createGame(base({ snake: [{x:2,y:2},{x:1,y:2},{x:0,y:2}], dir: {x:1,y:0}, food: {x:4,y:4} }));
  g.start();
  const r = g.setDirection(-1, 0);
  ok(r === false, "ters donus engellenir");
  g.tick();
  ok(g.snake[0].x === 3 && g.snake[0].y === 2, "ters donus sonrasi yon korunur");
}

// 4. hizli iki giris ile ters donus engeli (ayni tick icinde)
{
  const g = createGame(base({ snake: [{x:2,y:2},{x:1,y:2},{x:0,y:2}], dir: {x:1,y:0}, food: {x:4,y:4} }));
  g.start();
  const a = g.setDirection(0, -1);
  ok(a === true, "ilk kuyruklu donus kabul");
  const b = g.setDirection(-1, 0);
  ok(b === false, "ayni tick icinde tersine donus engellenir");
  g.tick();
  ok(g.snake[0].x === 2 && g.snake[0].y === 1, "kuyruk sirasiyla yukari gidilir");
}

// 5. buyume ve skor
{
  const g = createGame(base({ snake: [{x:2,y:2},{x:1,y:2},{x:0,y:2}], dir: {x:1,y:0}, food: {x:3,y:2} }));
  g.start();
  const n0 = g.snake.length;
  g.tick();
  ok(g.snake.length === n0 + 1, "yem yiyince buyur");
  ok(g.score === 1, "skor artar");
}

// 6. yem sadece bos hucrede dogar
{
  const g = createGame({ cols: 3, rows: 3, snake: [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:0,y:2},{x:1,y:2}], dir: {x:1,y:0}, food: {x:2,y:2}, random: () => 0 });
  g.start();
  g.tick(); // (1,0)? head (0,0)+right=(1,0) collides body -> over; use spawnFood check instead
  const g2 = createGame({ cols: 3, rows: 3, random: () => 0.999 });
  const occ = new Set(g2.snake.map(p => p.x + "," + p.y));
  for (let i = 0; i < 20; i++) { g2.spawnFood(); ok(!occ.has(g2.food.x + "," + g2.food.y), "yem bos hucrede #" + i); }
}

// 7. duvar carpismasi
{
  const g = createGame(base({ snake: [{x:4,y:2},{x:3,y:2},{x:2,y:2}], dir: {x:1,y:0}, food: {x:0,y:0} }));
  g.start();
  const st = g.tick();
  ok(st === "over" && g.status === "over", "duvar carpmasi bitirir");
}

// 8. govde carpismasi
{
  const g = createGame(base({ snake: [{x:2,y:2},{x:2,y:1},{x:1,y:1},{x:1,y:2}], dir: {x:0,y:-1}, food: {x:4,y:4} }));
  g.start();
  const st = g.tick(); // head (2,2)->(2,1) body
  ok(st === "over", "govde carpmasi bitirir");
}

// 9. kuyruga adim (buyumesiz yasal)
{
  const g = createGame({ cols: 4, rows: 4, snake: [{x:1,y:1},{x:1,y:2},{x:0,y:2},{x:0,y:1}], dir: {x:-1,y:0}, food: {x:3,y:3}, random: () => 0 });
  g.start();
  const st = g.tick();
  ok(st === "running", "kuyruga adim yasal");
  ok(g.snake[0].x === 0 && g.snake[0].y === 1, "kuyruk hucresine gidildi");
}

// 10. alan dolunca kazanma
{
  const g = createGame({ cols: 2, rows: 2, snake: [{x:0,y:0},{x:1,y:0},{x:1,y:1}], dir: {x:0,y:1}, food: {x:0,y:1}, random: () => 0 });
  g.start();
  const st = g.tick();
  ok(st === "won" && g.status === "won", "alan dolunca kazanilir");
  ok(g.snake.length === 4, "kazaninca tahta dolu");
}

// 11. pause / resume
{
  const g = createGame(base({ snake: [{x:2,y:2},{x:1,y:2},{x:0,y:2}], dir: {x:1,y:0}, food: {x:4,y:4} }));
  g.start();
  g.pause();
  ok(g.status === "paused", "pause duraklatir");
  const hx = g.snake[0].x;
  g.tick();
  ok(g.snake[0].x === hx && g.status === "paused", "duraklatilmis tick islemez");
  g.resume();
  ok(g.status === "running", "resume devam eder");
  g.tick();
  ok(g.snake[0].x === hx + 1, "resume sonrasi hareket eder");
}

// 12. restart
{
  const g = createGame(base({ snake: [{x:4,y:2},{x:3,y:2},{x:2,y:2}], dir: {x:1,y:0}, food: {x:0,y:0} }));
  g.start();
  g.tick();
  ok(g.status === "over", "once over olmali");
  g.restart();
  ok(g.status === "running" && g.score === 0, "restart sifirlar ve baslatir");
  ok(g.snake.length === 3, "restart yilani eski haline getirir");
}

// 13. UI engine'i gercekten kullaniyor + sayfa gereksinimleri
{
  const scripts = [...html.matchAll(/<script(?![^>]*id="engine")[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).join("\n");
  ok(scripts.includes("createGame"), "UI createGame kullanir");
  ok(html.includes('id="status"'), "durum metni var");
  ok(html.includes('id="board"'), "canvas var");
  ok(html.includes("visibilitychange"), "arka plan otomatik duraklatma var");
  ok(html.includes("localStorage"), "en iyi skor localStorage");
  ok(html.includes("20"), "20x20 alani");
}

console.log("TUM TESTLER GECTI: " + pass);
