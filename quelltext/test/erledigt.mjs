// Testet: To-dos abhaken, rückgängig machen, Zustand nach Neustart
import { starte } from "./browser-helfer.mjs";
const [ORDNER = "/home/claude/post-kamera/public", SHOTS] = process.argv.slice(2);
const { url, browser, stop } = await starte(ORDNER);
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));
await ctx.addInitScript(() => {
  localStorage.setItem("pk_filen", JSON.stringify({ email: "t@x.de" }));
  localStorage.setItem("pk_einstellungen", JSON.stringify({ ordner: "/Dokumente", github: { owner: "x", repo: "post-archiv", token: "t" } }));
  const stand = { stand: new Date(Date.now() - 3600e3).toISOString(), anzahl: 3, fristen: [],
    zuErledigen: [
      { id: "aaaaaaaaaaaa", absender: "Stadtwerke", typ: "Rechnung", handlung: ["312,40 € überweisen"], datei: "Rechnungen/a.pdf" },
      { id: "bbbbbbbbbbbb", absender: "Finanzamt", typ: "Bescheid", handlung: ["Bescheid prüfen"], datei: "Steuern/b.pdf" },
    ],
    erledigt: [{ id: "cccccccccccc", absender: "Versicherung", typ: "Schreiben", handlung: ["Unterlagen senden"], datei: "Versicherung/c.pdf", erledigtAm: new Date().toISOString() }],
    neueste: [] };
  window.PK_TEST = { hochgeladen: JSON.parse(sessionStorage.getItem("hoch") || "[]"),
    async hochladen(d) { this.hochgeladen.push(d.name); sessionStorage.setItem("hoch", JSON.stringify(this.hochgeladen)); return "u"; },
    erledigtListe() { return this.hochgeladen; },
    async papierkorb() {}, async github() { return {}; }, async liesJson() { return stand; } };
});
await page.goto(url);
await page.waitForSelector(".todo-zeile");
const zaehle = () => page.evaluate(() => ({ offen: document.querySelectorAll(".todo-zeile:not(.fertig)").length, erledigt: document.querySelectorAll(".todo-zeile.fertig").length, summary: document.querySelector("details.erledigt summary")?.textContent }));
console.log("Start:", JSON.stringify(await zaehle()));
if (SHOTS) await page.screenshot({ path: SHOTS + "/todo-1.png", fullPage: true });
await page.click('[data-a=erledigt][data-id=aaaaaaaaaaaa]');
await page.waitForTimeout(300);
console.log("nach Abhaken:", JSON.stringify(await zaehle()), "Datei:", await page.evaluate(() => window.PK_TEST.hochgeladen.at(-1)));
await page.click("details.erledigt summary");
if (SHOTS) await page.screenshot({ path: SHOTS + "/todo-2.png", fullPage: true });
await page.click('[data-a=wieder-offen][data-id=cccccccccccc]');
await page.waitForTimeout(300);
console.log("Versicherung wieder offen:", JSON.stringify(await zaehle()));
await page.reload();
await page.waitForSelector(".todo-zeile");
await page.waitForTimeout(300);
const nach = await page.evaluate(() => [...document.querySelectorAll(".todo-zeile")].map((li) => (li.classList.contains("fertig") ? "✓ " : "○ ") + li.querySelector("strong").textContent));
console.log("nach Neustart:", nach.join(" | "));
const ok = nach.join("|") === "○ Finanzamt|○ Versicherung|✓ Stadtwerke";
console.log(ok ? "✓ Zustand stimmt" : "✗ Zustand falsch");
console.log("Fehler:", fehler);
await stop();
