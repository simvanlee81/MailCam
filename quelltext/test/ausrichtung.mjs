// Prüft die automatische Ausrichtung: jedes Testfoto in 4 Drehungen und mehreren Qualitätsstufen
import { starte } from "./browser-helfer.mjs";
const ORDNER = process.argv[2] || "/home/claude/post-kamera/zstest";
const { url, browser, stop } = await starte(ORDNER);
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(url);
const fotos = ["1_holz_gerade", "2_hell_schwach", "3_starke_perspektive", "4_gedreht_25", "5_rand_beruehrt", "6_unruhig", "7_gefaltet", "8_daumen"];
const stufen = [["voll", 0, 0], ["2000px", 2000, 0], ["1500px+unscharf", 1500, 1.2], ["1200px+unscharf", 1200, 1.5]];
let gesamt = 0, gut = 0;
for (const [st, lang, blur] of stufen) {
  let g = 0, n = 0, fehl = [];
  for (const f of fotos) for (const r of [0, 90, 180, 270]) {
    const x = await page.evaluate(([f, r, lang, blur]) => window.drehtest(f, r, lang, blur), [f, r, lang, blur]);
    n++; if (x.ok) g++; else fehl.push(`${f}@${r}→${x.d} [${x.u}]`);
  }
  for (const f of ["formular", "kurz"]) for (const r of [0, 90, 180, 270]) {
    const x = await page.evaluate(([f, r, lang, blur]) => window.drehtest(f, r, lang, blur, ".png"), [f, r, lang, blur]);
    n++; if (x.ok) g++; else fehl.push(`${f}@${r}→${x.d} [${x.u}]`);
  }
  gesamt += n; gut += g;
  console.log(`${st.padEnd(18)} ${g}/${n}${fehl.length ? "  falsch: " + fehl.join(", ") : ""}`);
}
console.log(`Gesamt: ${gut}/${gesamt}`);
await stop();
