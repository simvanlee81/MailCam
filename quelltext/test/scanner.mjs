// Testet den Live-Scanner mit einer simulierten Kamera (Video eines Briefes auf dem Tisch)
import { starte } from "./browser-helfer.mjs";
const SHOTS = process.argv[2] || "/tmp";
const VIDEO = process.argv[3];
const ORDNER = process.argv[4] || "/home/claude/post-kamera/public";
const { url, browser, stop } = await starte(ORDNER, ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + VIDEO]);
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] });
const page = await ctx.newPage();
const BREMSE = Number(process.argv[5] || 1);
if (BREMSE > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: BREMSE }); }
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));
page.on("console", (m) => m.type() === "error" && fehler.push(m.text()));
await page.addInitScript(() => {
  localStorage.setItem("pk_filen", JSON.stringify({ email: "test@example.com" }));
  localStorage.setItem("pk_einstellungen", JSON.stringify({ ordner: "/Dokumente", github: { owner: "x", repo: "post-archiv", token: "t", branch: "main" } }));
  window.PK_TEST = { hochgeladen: [], groessen: [],
    async hochladen(d) { this.hochgeladen.push(d.name); this.groessen.push(d.size); return "u" + this.hochgeladen.length; },
    async papierkorb() {}, async github() { return {}; }, async liesJson() { throw new Error("not found"); } };
});
await page.goto(url);
await page.click("[data-a=kamera]");
await page.waitForSelector(".scanner video", { timeout: 60000 });
const t0 = Date.now();
await page.waitForTimeout(700);
await page.screenshot({ path: SHOTS + "/s1-live.png" });
await page.waitForSelector(".sc-pruefen:not([hidden]) .sc-ergebnis", { timeout: 20000 });
console.log("automatisch ausgelöst nach", ((Date.now() - t0) / 1000).toFixed(1), "s");
await page.screenshot({ path: SHOTS + "/s2-pruefen.png" });
// Automatik: ohne Tippen nach 3 s übernommen?
await page.waitForSelector(".sc-pruefen[hidden]", { state: "attached", timeout: 6000 }); await page.waitForTimeout(300);
console.log("automatisch übernommen:", await page.evaluate(() => window.PK_TEST.hochgeladen.length) === 1 ? "ja" : "nein");
await page.waitForTimeout(1500);
await page.screenshot({ path: SHOTS + "/s4-nach-uebernahme.png" });
const zweiteAuto = await page.locator(".sc-pruefen:not([hidden])").count();
console.log("gleiche Seite erneut ausgelöst?", zweiteAuto ? "JA (Fehler)" : "nein");
await page.click(".sc-fertig");
await page.waitForTimeout(500);
await page.screenshot({ path: SHOTS + "/s5-aufnahme.png", fullPage: true });
console.log(JSON.stringify(await page.evaluate(() => ({ h: window.PK_TEST.hochgeladen, g: window.PK_TEST.groessen }))));
console.log("Erkennung dauert im Schnitt:", await page.evaluate(() => document.querySelector(".scanner") ? "-" : "(Scanner zu)"));
console.log("Fehler:", fehler);
await stop();
