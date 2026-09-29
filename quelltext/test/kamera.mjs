// Testet: 📷 -> Handy-Kamera (Datei) -> App erkennt und schneidet zu -> übernimmt automatisch -> Upload
import { starte } from "./browser-helfer.mjs";
const [ORDNER, FOTO, SHOTS, BREMSE = "1"] = process.argv.slice(2);
const { url, browser, stop } = await starte(ORDNER);
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
if (Number(BREMSE) > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(BREMSE) }); }
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));
await ctx.addInitScript(() => {
  localStorage.setItem("pk_filen", JSON.stringify({ email: "t@x.de" }));
  localStorage.setItem("pk_einstellungen", JSON.stringify({ ordner: "/Dokumente", github: { owner: "x", repo: "post-archiv", token: "t" } }));
  window.PK_TEST = { hochgeladen: [], async hochladen(d) { this.hochgeladen.push(d.name); return "u"; }, async papierkorb() {}, async github() { return {}; }, async liesJson() { throw new Error("not found"); } };
});
await page.goto(url);
const kameraKnopf = await page.locator("[data-a=kamera]").count();
const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-a=kamera]")]);
console.log("📷 öffnet Handy-Kamera:", fc.isMultiple() === false && (await page.evaluate(() => document.querySelector("input[capture]") !== null)) ? "ja" : "?");
const t0 = Date.now();
await fc.setFiles(FOTO);
await page.waitForSelector(".sc-pruefen .sc-ergebnis", { timeout: 60000 });
console.log(`zugeschnitten nach ${((Date.now() - t0) / 1000).toFixed(1)} s, Blatt erkannt: ${(await page.locator(".sc-warn").count()) ? "NEIN" : "ja"}`);
if (SHOTS) await page.screenshot({ path: SHOTS + "/v16-pruefen.png" });
console.log("automatisch ausgerichtet:", await page.evaluate(() => { const c = document.querySelector(".sc-ergebnis"); return c.height > c.width ? "Hochformat" : "Querformat"; }));
await page.waitForTimeout(3500);
console.log("Prüfansicht bleibt offen (kein Auto-Übernehmen):", (await page.locator(".sc-pruefen .sc-ergebnis").count()) && !(await page.evaluate(() => window.PK_TEST.hochgeladen.length)) ? "✓" : "✗");
// Scan-Look aus und wieder an: Ausrichtung bleibt gleich
const form = () => page.evaluate(() => { const c = document.querySelector(".sc-ergebnis"); return c.width + "x" + c.height; });
const f0 = await form(); await page.click("[data-p=modus]"); await page.waitForTimeout(400); const f1 = await form(); await page.click("[data-p=modus]"); await page.waitForTimeout(400); const f2 = await form();
console.log("Scan-Look aus/an, Format:", f0, f1, f2, f0 === f1 && f1 === f2 ? "✓" : "✗");
await page.click("[data-p=ok]");
await page.waitForFunction(() => window.PK_TEST.hochgeladen.length === 1, null, { timeout: 15000 });
await page.waitForTimeout(300);
if (SHOTS) await page.screenshot({ path: SHOTS + "/v16-aufnahme.png", fullPage: true });
// zweites Foto (Bilderkennung ist jetzt geladen)
const [fc2] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-a=kamera]")]);
const t1 = Date.now();
await fc2.setFiles(FOTO);
await page.waitForSelector(".sc-pruefen .sc-ergebnis", { timeout: 60000 });
console.log(`2. Foto zugeschnitten nach ${((Date.now() - t1) / 1000).toFixed(1)} s`);
await page.click("[data-p=ok]");
await page.waitForFunction(() => window.PK_TEST.hochgeladen.length === 2, null, { timeout: 15000 });
console.log("übernommen & hochgeladen:", await page.evaluate(() => window.PK_TEST.hochgeladen[0]));
console.log("Knopf „Handy-Kamera“ noch da:", await page.locator("[data-a=handykamera]").count() ? "ja (Fehler)" : "nein");
// drehen-test: Knopf ⟳ Drehen dreht die Vorschau um 90°
const [fc3] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-a=kamera]")]);
await fc3.setFiles(FOTO);
await page.waitForSelector(".sc-pruefen .sc-ergebnis", { timeout: 60000 });
const vorher = await page.evaluate(() => { const c = document.querySelector(".sc-ergebnis"); return [c.width, c.height]; });
await page.click("[data-p=drehen]");
await page.waitForTimeout(500);
const nachher = await page.evaluate(() => { const c = document.querySelector(".sc-ergebnis"); return [c.width, c.height]; });
console.log("⟳ Drehen:", JSON.stringify(vorher), "→", JSON.stringify(nachher), nachher[0] === vorher[1] ? "✓" : "✗");
if (SHOTS) await page.screenshot({ path: SHOTS + "/v18-gedreht.png" });
console.log("Fehler:", fehler);
await stop();
