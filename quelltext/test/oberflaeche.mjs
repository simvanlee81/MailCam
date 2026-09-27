// Klickt die Post-Kamera mit Attrappen für Filen und GitHub durch und macht Bildschirmfotos
import { starte } from "./browser-helfer.mjs";
const SHOTS = process.argv[2] || "/tmp";
const FOTOS = ["/tmp/claude-0/-home-claude/4760dfad-3764-5a2e-89c4-a82060c51d08/scratchpad/vier/1.jpg", "/tmp/claude-0/-home-claude/4760dfad-3764-5a2e-89c4-a82060c51d08/scratchpad/vier/2.jpg", "/tmp/claude-0/-home-claude/4760dfad-3764-5a2e-89c4-a82060c51d08/scratchpad/vier/3.jpg"];
const { url, browser, stop } = await starte("/home/claude/post-kamera/public");
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: process.argv[3] || "light" });
const page = await ctx.newPage();
const fehler = [];
page.on("pageerror", (e) => fehler.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem("pk_scanner", JSON.stringify({ an: false, zuschneiden: false }));
  const heute = new Date();
  const tag = (n) => new Date(heute.getTime() + n * 86400000).toISOString().slice(0, 10);
  let ergebnisVersuche = 0;
  window.PK_TEST = {
    hochgeladen: [],
    async hochladen(datei) { await new Promise((r) => setTimeout(r, 250)); this.hochgeladen.push(datei.name); return "uuid-" + this.hochgeladen.length; },
    async papierkorb() {},
    async github(weg, opt) {
      if (weg === "") return { default_branch: "main" };
      if (weg.endsWith("/dispatches")) { window.PK_TEST.dispatch = JSON.parse(opt.body); return null; }
      if (weg.includes("/runs")) return { workflow_runs: [{ created_at: new Date().toISOString(), status: "in_progress", conclusion: null, html_url: "https://github.com/x" }] };
      return {};
    },
    async liesJson(p) {
      if (p.endsWith("app.json")) return { stand: new Date().toISOString(), anzahl: 7,
        fristen: [{ datum: tag(2), was: "Zahlung fällig", art: "zahlung", absender: "Finanzamt Hamburg-Nord" }, { datum: tag(32), was: "Einspruch/Widerspruch möglich bis", art: "einspruch", berechnet: true, absender: "Finanzamt Hamburg-Nord" }],
        zuErledigen: [{ absender: "Finanzamt Hamburg-Nord", typ: "Bescheid", handlung: ["Zahlen bis " + tag(2).split("-").reverse().join(".")] }], neueste: [] };
      if (p.includes("/laeufe/")) {
        if (++ergebnisVersuche < 3) throw new Error("not found");
        return { status: "fertig", neu: [
          { datei: "Steuern/2026/2026-09-24_Finanzamt-Hamburg-Nord_Bescheid.pdf", absender: "Finanzamt Hamburg-Nord", typ: "Bescheid", kategorie: "Steuern", briefdatum: "2026-09-24", seiten: 2, betrag: { wert: 412, art: "Nachzahlung" }, fristen: [{ datum: tag(32), was: "Zahlung fällig", art: "zahlung" }], handlung: ["Nachzahlung 412 € überweisen"], zusammenfassung: "Einkommensteuerbescheid 2025 mit Nachzahlung von 412 €." },
          { datei: "Versicherungen/2026-09-02_HUK-COBURG_Preisanpassung.pdf", absender: "HUK-COBURG", typ: "Preisanpassung", kategorie: "Versicherungen", briefdatum: "2026-09-02", seiten: 1, betrag: { wert: 412.8, art: "Wird abgebucht" }, fristen: [], handlung: [], zusammenfassung: "Kfz-Beitrag steigt ab 2027, wird abgebucht." } ], fehler: [] };
      }
      throw new Error("not found");
    },
  };
});
await page.goto(url);
await page.screenshot({ path: SHOTS + "/1-einrichtung.png", fullPage: true });
await page.fill("#f-mail", "test@example.com"); await page.fill("#f-pw", "x");
await page.click("[data-a=filen-an]");
await page.fill("#g-owner", "simvanlee81"); await page.fill("#g-token", "github_pat_test");
await page.click("[data-a=speichern]");
await page.waitForSelector("text=Fristen");
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + "/2-start.png", fullPage: true });
const foto = async (datei) => { const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-a=kamera] >> nth=0")]); await fc.setFiles(datei); await page.waitForTimeout(700); };
await foto(FOTOS[0]); await foto(FOTOS[1]);
await page.click("[data-a=naechster]");
await foto(FOTOS[2]);
await page.waitForTimeout(800);
await page.screenshot({ path: SHOTS + "/3-aufnahme.png", fullPage: true });
await page.click("[data-a=fertig]");
await page.waitForTimeout(1500);
await page.screenshot({ path: SHOTS + "/4-lauf.png", fullPage: true });
await page.waitForSelector("text=archiviert", { timeout: 40000 });
await page.screenshot({ path: SHOTS + "/5-ergebnis.png", fullPage: true });
const t = await page.evaluate(() => ({ hochgeladen: window.PK_TEST.hochgeladen, dispatch: window.PK_TEST.dispatch }));
console.log(JSON.stringify(t));
console.log("Seitenfehler:", fehler);
await stop();
