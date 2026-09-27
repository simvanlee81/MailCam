// Testet Wiederholung bei Upload-Fehlern und das Fortsetzen nach Schließen der App
import { starte } from "./browser-helfer.mjs";
const ORDNER = process.argv[2] || "/home/claude/post-kamera/public";
const FOTO = "/tmp/claude-0/-home-claude/4760dfad-3764-5a2e-89c4-a82060c51d08/scratchpad/vier/1.jpg";
const { url, browser, stop } = await starte(ORDNER);
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
const page = await ctx.newPage();
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));
await ctx.addInitScript(() => {
  localStorage.setItem("pk_filen", JSON.stringify({ email: "t@x.de" }));
  localStorage.setItem("pk_einstellungen", JSON.stringify({ ordner: "/Dokumente", github: { owner: "x", repo: "post-archiv", token: "t" } }));
  localStorage.setItem("pk_scanner", JSON.stringify({ an: false, zuschneiden: false }));
  const modus = sessionStorage.getItem("modus") || "wackelig";
  window.PK_TEST = { versuche: 0, hochgeladen: [],
    async hochladen(d, onP) {
      this.versuche++;
      if (modus === "haengt") return new Promise(() => {}); // Verbindung hängt für immer (App wird dann geschlossen)
      for (const p of [0.3, 0.6, 1]) { await new Promise((r) => setTimeout(r, 200)); onP?.(p); }
      if (this.versuche === 1) throw new Error("Netzwerkfehler");
      this.hochgeladen.push(d.name); return "u" + this.versuche; },
    async papierkorb() {}, async github() { return {}; }, async liesJson() { throw new Error("not found"); } };
});
await page.goto(url);
// 1) Erster Versuch schlägt fehl -> automatische Wiederholung
const foto = async () => { const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-a=kamera]")]); await fc.setFiles(FOTO); };
await foto();
await page.waitForFunction(() => window.PK_TEST.hochgeladen.length === 1, null, { timeout: 15000 });
console.log("1) Wiederholung nach Fehler:", await page.evaluate(() => `${window.PK_TEST.versuche} Versuche, Status: ${document.querySelector("[data-upload-status]")?.textContent}`));
// 2) Upload hängt, App wird geschlossen und neu geöffnet -> Upload geht weiter
await page.evaluate(() => sessionStorage.setItem("modus", "haengt"));
await page.reload();
await page.waitForSelector("[data-a=kamera]");
await foto();
await page.waitForTimeout(800);
console.log("2a) hängt:", await page.textContent("[data-upload-status]"));
await page.evaluate(() => sessionStorage.setItem("modus", "gut"));
await page.reload(); // App geschlossen & wieder geöffnet
await page.waitForFunction(() => window.PK_TEST.hochgeladen.length === 1, null, { timeout: 15000 });
await page.waitForTimeout(300);
console.log("2b) nach Neustart fortgesetzt:", await page.evaluate(() => window.PK_TEST.hochgeladen[0]), "|", await page.textContent("[data-upload-status]"));
console.log("Seiten in Sitzung:", await page.evaluate(() => JSON.parse(localStorage.getItem("pk_sitzung")).seiten.map((s) => s.status).join(",")));
console.log("Fehler:", fehler);
await stop();
