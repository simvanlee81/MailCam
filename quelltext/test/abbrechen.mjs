// Testet: hängender Upload im Lauf-Bildschirm -> Abbrechen; verwaister Lauf nach Neustart; ?reset
import { starte } from "./browser-helfer.mjs";
const ORDNER = process.argv[2] || "/home/claude/post-kamera/public";
const { url, browser, stop } = await starte(ORDNER);
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
const page = await ctx.newPage();
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));
page.on("dialog", (d) => d.accept());
await ctx.addInitScript(() => {
  localStorage.setItem("pk_filen", JSON.stringify({ email: "t@x.de" }));
  localStorage.setItem("pk_einstellungen", JSON.stringify({ ordner: "/Dokumente", github: { owner: "x", repo: "post-archiv", token: "t" } }));
  localStorage.setItem("pk_scanner", JSON.stringify({ an: false, zuschneiden: false }));
  window.PK_TEST = { hochladen: () => new Promise(() => {}), async papierkorb() {}, async github() { return {}; }, async liesJson() { throw new Error("not found"); } };
});
await page.goto(url);
const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-a=kamera]")]);
await fc.setFiles("/tmp/claude-0/-home-claude/4760dfad-3764-5a2e-89c4-a82060c51d08/scratchpad/vier/1.jpg");
await page.waitForTimeout(500);
await page.click("[data-a=fertig]");
await page.waitForSelector("[data-a=lauf-abbrechen]");
console.log("1) Abbrechen-Knopf beim Hochladen sichtbar: ja");
await page.click("[data-a=lauf-abbrechen]");
console.log("   danach:", await page.textContent("header h1"));
await page.click("[data-a=abbrechen]");
await page.waitForTimeout(300);
console.log("   Aufnahme verwerfen trotz hängendem Upload ->", await page.textContent("header h1"));
// 2) verwaister Lauf (wie bei dir: App im Schritt "hochladen" geschlossen)
await page.evaluate(() => { localStorage.setItem("pk_lauf", JSON.stringify({ id: "x", schritt: "hochladen", start: Date.now(), seiten: 4, briefe: 1 })); localStorage.setItem("pk_sitzung", JSON.stringify({ id: "x", brief: 1, seiten: [{ b: 1, s: 1, name: "Kamera_x_b1_s1.jpg", status: "laedt" }] })); });
await page.reload();
await page.waitForTimeout(500);
console.log("2) Neustart mit verwaistem Lauf ->", await page.textContent("header h1"), "|", await page.textContent("[data-upload-status]"));
// 3) Notausgang ?reset
await page.evaluate(() => localStorage.setItem("pk_lauf", JSON.stringify({ id: "x", schritt: "warten", start: Date.now() })));
await page.goto(url + "/?reset");
await page.waitForTimeout(500);
console.log("3) ?reset ->", await page.textContent("header h1"), "| Adresse:", new URL(page.url()).search || "(ohne ?reset)", "| Filen-Anmeldung noch da:", await page.evaluate(() => !!localStorage.getItem("pk_filen")));
console.log("Fehler:", fehler);
await stop();
