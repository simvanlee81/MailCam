// Misst die Genauigkeit der Blatterkennung an Testfotos mit bekannten Ecken
import { starte } from "./browser-helfer.mjs";
import fs from "node:fs";
const ORDNER = process.argv[2], AUS = process.argv[3];
const wahrheit = fs.readFileSync(ORDNER + "/wahrheit.txt", "utf8").trim().split("\n").map((z) => { const [n, ...p] = z.split(" "); return [n, p.map((q) => q.split(",").map(Number))]; });
const { url, browser, stop } = await starte(ORDNER);
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(url);
let summe = 0, ok = 0;
for (const [n, w] of wahrheit) {
  const r = await page.evaluate(([n, w]) => window.zstest(n, w), [n, w]);
  const gut = r.gefunden && r.max < 1;
  if (gut) ok++;
  summe += r.gefunden ? r.mittel : 10;
  console.log(`${gut ? "✓" : "✗"} ${n.padEnd(22)} ${r.gefunden ? `Fehler Ø ${r.mittel.toFixed(2)} % / max ${r.max.toFixed(2)} % der Bilddiagonale` : "NICHT GEFUNDEN"}  (${r.ms} ms)`);
  if (AUS && r.bild) fs.writeFileSync(`${AUS}/erg_${n}.jpg`, Buffer.from(r.bild.split(",")[1], "base64"));
}
console.log(`Ergebnis: ${ok}/${wahrheit.length} genau (max. Eckenfehler < 1 %), Ø-Fehler gesamt ${(summe / wahrheit.length).toFixed(2)} %`);
await stop();
