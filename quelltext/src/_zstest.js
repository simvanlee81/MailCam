import { ladeOpenCV, _eckenImFoto, _alsCanvas, entzerren } from "./scanner.js";
window.zstest = async (name, wahr) => {
  const { cv } = await ladeOpenCV();
  const blob = await (await fetch(name + ".jpg")).blob();
  const t0 = performance.now();
  const roh = await _alsCanvas(blob);
  const e = _eckenImFoto(cv, roh);
  const ms = Math.round(performance.now() - t0);
  const f = roh.width / 3000;
  const diag = Math.hypot(roh.width, roh.height);
  if (!e) return { name, gefunden: false, ms };
  const w = wahr.map(([x, y]) => ({ x: Math.min(roh.width, Math.max(0, x * f)), y: Math.min(roh.height, Math.max(0, y * f)) }));
  const fehler = e.map((p, i) => (Math.hypot(p.x - w[i].x, p.y - w[i].y) / diag) * 100);
  const bild = entzerren(cv, roh, e, { scan: true, maxSeite: 900 });
  return { name, gefunden: true, ms, mittel: +(fehler.reduce((a, b) => a + b) / 4).toFixed(2), max: +Math.max(...fehler).toFixed(2), bild: bild.toDataURL("image/jpeg", 0.7) };
};
import { textAusrichtung } from "./scanner.js";
// Ausrichtungstest: Foto um r° drehen, optional verkleinern/unscharf, Blatt suchen, entzerren, Ausrichtung bestimmen
window.drehtest = async (name, r, lang = 0, blur = 0, ext = ".jpg") => {
  const { cv } = await ladeOpenCV();
  const blob = await (await fetch(name + ext)).blob();
  let roh = await _alsCanvas(blob);
  if (lang) { const s = lang / Math.max(roh.width, roh.height); const c = document.createElement("canvas"); c.width = Math.round(roh.width * s); c.height = Math.round(roh.height * s); const g = c.getContext("2d"); if (blur) g.filter = `blur(${blur}px)`; g.drawImage(roh, 0, 0, c.width, c.height); roh = c; }
  const c = document.createElement("canvas");
  const q = r % 180 ? [roh.height, roh.width] : [roh.width, roh.height];
  c.width = q[0]; c.height = q[1];
  const g = c.getContext("2d");
  g.translate(c.width / 2, c.height / 2); g.rotate((r * Math.PI) / 180); g.drawImage(roh, -roh.width / 2, -roh.height / 2);
  const e = ext === ".jpg" ? _eckenImFoto(cv, c) : null;
  const ecken = e || [{ x: 0, y: 0 }, { x: c.width, y: 0 }, { x: c.width, y: c.height }, { x: 0, y: c.height }];
  const t0 = performance.now();
  const d = window.PK_AUSRICHTUNG ? window.PK_AUSRICHTUNG(cv, c, ecken) : textAusrichtung(cv, entzerren(cv, c, ecken, { scan: true, maxSeite: 1200 }));
  // Foto wurde um r im Uhrzeigersinn gedreht -> Korrektur (360-r)
  const u = textAusrichtung.letzte || {}; return { ok: d === (360 - r) % 360, u: `w1=${(u.w1||0).toFixed(2)} L${u.links}/R${u.rechts}/${u.zeilen}`, d, soll: (360 - r) % 360, ms: Math.round(performance.now() - t0) };
};
window._alsCanvasTest = _alsCanvas;
