// Testet App-Kamera (selbst auslösen -> zuschneiden) und Handy-Foto (zuschneiden) mit simulierter Kamera
import { starte } from "./browser-helfer.mjs";
const SHOTS = process.argv[2] || "/tmp";
const VIDEO = process.argv[3];
const ORDNER = process.argv[4] || "/home/claude/post-kamera/public";
const BREMSE = Number(process.argv[5] || 1);
const FOTO = process.argv[6];
const { url, browser, stop } = await starte(ORDNER, ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + VIDEO]);
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] });
const page = await ctx.newPage();
if (BREMSE > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: BREMSE }); }
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));
page.on("console", (m) => m.type() === "error" && fehler.push(m.text()));
await ctx.addInitScript(() => {
  localStorage.setItem("pk_filen", JSON.stringify({ email: "test@example.com" }));
  localStorage.setItem("pk_einstellungen", JSON.stringify({ ordner: "/Dokumente", github: { owner: "x", repo: "post-archiv", token: "t", branch: "main" } }));
  window.PK_TEST = { hochgeladen: [],
    async hochladen(d) { this.hochgeladen.push(d.name); return "u" + this.hochgeladen.length; },
    async papierkorb() {}, async github() { return {}; }, async liesJson() { throw new Error("not found"); } };
});
await page.goto(url);
// --- 1) App-Kamera ---
await page.click("[data-a=kamera]");
await page.waitForSelector(".scanner video", { timeout: 60000 });
await page.waitForTimeout(2500); // Video ruhig
await page.screenshot({ path: SHOTS + "/k1-kamera.png" });
let t0 = Date.now();
await page.click("[data-s=ausloesen]");
await page.waitForSelector(".sc-pruefen:not([hidden]) .sc-ergebnis", { timeout: 30000 });
console.log("1) App-Kamera: Auslösen -> zugeschnittene Seite in", ((Date.now() - t0) / 1000).toFixed(1), "s; Blatt erkannt:", (await page.locator(".sc-warn").count()) === 0 ? "ja" : "NEIN");
await page.screenshot({ path: SHOTS + "/k2-ergebnis.png" });
await page.waitForFunction(() => window.PK_TEST.hochgeladen.length === 1, null, { timeout: 8000 });
console.log("   nach 2 s automatisch übernommen und hochgeladen: ja");
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + "/k3-zurueck.png" });
await page.click(".sc-fertig");
// --- 2) Handy-Kamera-Foto ---
t0 = Date.now();
const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-a=handykamera]")]);
await fc.setFiles(FOTO);
await page.waitForSelector(".sc-pruefen .sc-ergebnis", { timeout: 30000 });
console.log("2) Handy-Foto: zugeschnitten in", ((Date.now() - t0) / 1000).toFixed(1), "s; Blatt erkannt:", (await page.locator(".sc-warn").count()) === 0 ? "ja" : "NEIN");
await page.screenshot({ path: SHOTS + "/k4-handyfoto.png" });
await page.waitForFunction(() => window.PK_TEST.hochgeladen.length === 2, null, { timeout: 8000 });
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + "/k5-aufnahme.png", fullPage: true });
console.log(JSON.stringify(await page.evaluate(() => window.PK_TEST.hochgeladen)));
console.log("Fehler:", fehler);
await stop();
