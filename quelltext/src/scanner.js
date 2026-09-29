// Dokumenten-Scanner: Live-Kamera mit Seitenerkennung, automatischer Aufnahme,
// Entzerrung, "Scan-Look" und manueller Ecken-Korrektur. Bilderkennung mit OpenCV.js.

// ---------- OpenCV laden (einmalig, ~13 MB, danach aus dem Speicher des Handys) ----------
let _cv = null;
let _laden = null;
// Achtung: Das OpenCV-Modul hat je nach Version eine eigene then()-Funktion. Es darf deshalb nie direkt
// an resolve() oder "return" in einer async-Funktion gehen, sonst wartet das Promise endlos auf sich selbst.
// Rückgabe darum als Hülle: { cv }.
function istBereit(c) { return !!(c && c.Mat && c.imread); }
export function ladeOpenCV() {
  if (_cv) return Promise.resolve({ cv: _cv });
  if (!_laden) {
    _laden = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "opencv.js";
      s.async = true;
      s.onerror = () => reject(new Error("Scanner-Bibliothek (opencv.js) konnte nicht geladen werden"));
      s.onload = () => {
        const start = Date.now();
        let gewartet = false;
        const pruefe = () => {
          const c = window.cv;
          if (istBereit(c)) { _cv = c; return resolve(); }
          if (c instanceof Promise && !gewartet) { gewartet = true; c.then((m) => { window.cv = m; }, reject); }
          if (Date.now() - start > 45000) return reject(new Error("Scanner-Bibliothek startet nicht"));
          setTimeout(pruefe, 100);
        };
        pruefe();
      };
      document.head.append(s);
    }).catch((e) => { _laden = null; throw e; });
  }
  return _laden.then(() => ({ cv: _cv }));
}

// ---------- Geometrie ----------
const abstand = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Ecken sortieren: oben-links, oben-rechts, unten-rechts, unten-links
export function sortiereEcken(p) {
  const summe = [...p].sort((a, b) => a.x + a.y - (b.x + b.y));
  const diff = [...p].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [summe[0], diff[0], summe[3], diff[3]];
}

function flaeche(e) {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = e[i], q = e[(i + 1) % 4]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

// Ist das Viereck plausibel ein Blatt? (konvex, nicht zu klein, keine extremen Winkel)
function plausibel(e, breite, hoehe) {
  const f = flaeche(e);
  if (f < breite * hoehe * 0.12) return false;
  for (let i = 0; i < 4; i++) {
    const a = e[(i + 3) % 4], b = e[i], c = e[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    const winkel = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (winkel < 45 || winkel > 135) return false;
  }
  const seiten = [abstand(e[0], e[1]), abstand(e[1], e[2]), abstand(e[2], e[3]), abstand(e[3], e[0])];
  const verh = Math.max(...seiten) / Math.min(...seiten);
  return verh < 4;
}

// Größtes plausibles Viereck in einer Kanten-/Schwellwert-Maske finden
// ---------- Blatterkennung ----------
// Idee: mehrere Masken für "Papier" bilden (Helligkeit, farbloses Hell, Kanten), aus jeder die besten Vierecke ableiten
// und sie danach bewerten, wie sehr sie nach Papier aussehen. Danach werden die Kanten in höherer Auflösung nachjustiert.

function geradeDurch(a, b) { return { a: b.y - a.y, b: a.x - b.x, c: (b.y - a.y) * a.x + (a.x - b.x) * a.y }; }
function schnitt(g, h) {
  const d = g.a * h.b - h.a * g.b;
  if (Math.abs(d) < 1e-9) return null;
  return { x: (h.b * g.c - g.b * h.c) / d, y: (g.a * h.c - h.a * g.c) / d };
}

// Aus einem (konvexen) Polygon ein Viereck machen: die 4 längsten Seiten behalten und schneiden.
// So wird z. B. eine vom Daumen verdeckte Ecke rekonstruiert.
function viereckAusPolygon(pkt) {
  if (pkt.length === 4) return sortiereEcken(pkt);
  if (pkt.length < 4 || pkt.length > 10) return null;
  const seiten = pkt.map((p, i) => ({ i, a: p, b: pkt[(i + 1) % pkt.length], l: abstand(p, pkt[(i + 1) % pkt.length]) }));
  const lang = [...seiten].sort((x, y) => y.l - x.l).slice(0, 4).sort((x, y) => x.i - y.i);
  const ecken = [];
  for (let i = 0; i < 4; i++) {
    const s = schnitt(geradeDurch(lang[i].a, lang[i].b), geradeDurch(lang[(i + 1) % 4].a, lang[(i + 1) % 4].b));
    if (!s) return null;
    ecken.push(s);
  }
  return sortiereEcken(ecken);
}

// Kandidaten-Vierecke aus einer Maske (größte Flächen zuerst)
function vierecksKandidaten(cv, maske, B, H) {
  const konturen = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(maske, konturen, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const liste = [];
  for (let i = 0; i < konturen.size(); i++) {
    const k = konturen.get(i);
    const a = cv.contourArea(k);
    if (a >= B * H * 0.1) liste.push({ k, a }); else k.delete();
  }
  liste.sort((x, y) => y.a - x.a);
  const erg = [];
  for (const { k, a } of liste.slice(0, 3)) {
    const huelle = new cv.Mat();
    cv.convexHull(k, huelle);
    const umfang = cv.arcLength(huelle, true);
    const gesehen = new Set();
    for (const eps of [0.015, 0.025, 0.04, 0.06, 0.09]) {
      const approx = new cv.Mat();
      cv.approxPolyDP(huelle, approx, eps * umfang, true);
      const n = approx.rows;
      if (n >= 4 && n <= 8 && !gesehen.has(n)) {
        gesehen.add(n);
        const pkt = [];
        for (let j = 0; j < n; j++) pkt.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
        const e = viereckAusPolygon(pkt);
        if (e && plausibel(e, B, H)) erg.push({ e, fuellung: Math.min(1, a / flaeche(e)) });
      }
      approx.delete();
    }
    huelle.delete();
    k.delete();
  }
  konturen.delete();
  hier.delete();
  return erg;
}

// Wie sehr sieht das Viereck nach Papier aus? (innen hell & farblos, außen dunkler/bunter, nicht der Bildrand)
function bewerte(cv, kand, helligkeit, saettigung, papier, B, H) {
  const { e } = kand;
  const maske = cv.Mat.zeros(H, B, cv.CV_8UC1);
  const pts = cv.matFromArray(4, 1, cv.CV_32SC2, e.flatMap((p) => [Math.round(p.x), Math.round(p.y)]));
  const mv = new cv.MatVector();
  mv.push_back(pts);
  cv.fillPoly(maske, mv, new cv.Scalar(255));
  const rand = Math.max(3, Math.round(Math.min(B, H) * 0.03));
  const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(rand, rand));
  const innen = new cv.Mat(), aussen = new cv.Mat(), gross = new cv.Mat();
  cv.erode(maske, innen, kern);
  cv.dilate(maske, gross, kern);
  cv.subtract(gross, maske, aussen);
  const vi = cv.mean(helligkeit, innen)[0], va = cv.countNonZero(aussen) > 20 ? cv.mean(helligkeit, aussen)[0] : vi - 40;
  const si = cv.mean(saettigung, innen)[0], sa = cv.countNonZero(aussen) > 20 ? cv.mean(saettigung, aussen)[0] : si + 20;
  // Wie viel der Fläche im Viereck ist wirklich "Papier" (hell & farblos)? Daumen, Tisch, Handy drücken den Wert.
  const papierInnen = new cv.Mat();
  cv.bitwise_and(papier, innen, papierInnen);
  const papierAnteil = cv.countNonZero(papierInnen) / Math.max(1, cv.countNonZero(innen));
  papierInnen.delete();
  [maske, pts, mv, kern, innen, aussen, gross].forEach((m) => m.delete());
  const kontrast = Math.max(0, vi - va) / 255 + Math.max(0, sa - si) / 255 * 0.7;
  const hell = vi / 255;
  // Seiten, die am Bildrand kleben
  const tol = Math.max(B, H) * 0.012;
  const amRand = (p) => p.x < tol || p.y < tol || p.x > B - tol || p.y > H - tol;
  let randSeiten = 0;
  for (let i = 0; i < 4; i++) if (amRand(e[i]) && amRand(e[(i + 1) % 4])) randSeiten++;
  // Viereck am Bildrand: bei Holz/Stoff oft ein Fehlgriff – außer es besteht fast nur aus Papier (Brief füllt das Foto)
  const randFaktor = randSeiten >= 3 ? (papierAnteil > 0.85 ? 0.7 : 0.05) : randSeiten === 2 ? (papierAnteil > 0.85 ? 0.9 : 0.6) : 1;
  const anteil = flaeche(e) / (B * H);
  kand.papierAnteil = papierAnteil;
  return (0.15 + kontrast) * hell * Math.pow(papierAnteil, 6) * Math.sqrt(anteil) * randFaktor;
}

// Papier im Bild finden. quelle: Canvas (~800 px). Rückgabe: 4 Ecken (in Canvas-Koordinaten) oder null.
export function findePapier(cv, quelle) {
  const src = cv.imread(quelle);
  const B = src.cols, H = src.rows;
  const rgb = new cv.Mat(), hsv = new cv.Mat(), grau = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  const kanaele = new cv.MatVector();
  cv.split(hsv, kanaele);
  const sat = kanaele.get(1), val = kanaele.get(2);
  cv.cvtColor(src, grau, cv.COLOR_RGBA2GRAY);
  // Struktur von Holz/Stoff wegglätten, Blattkanten bleiben
  const glatt = new cv.Mat();
  cv.medianBlur(grau, glatt, 7);
  cv.GaussianBlur(glatt, glatt, new cv.Size(5, 5), 0);
  const satGlatt = new cv.Mat();
  cv.medianBlur(sat, satGlatt, 7);

  const k = Math.max(5, Math.round(Math.min(B, H) * 0.02)) | 1;
  const kernGross = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
  const kernKlein = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const masken = [];

  // 1) hell (Otsu)
  const m1 = new cv.Mat();
  cv.threshold(glatt, m1, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.morphologyEx(m1, m1, cv.MORPH_CLOSE, kernGross); // Knickschatten überbrücken
  cv.morphologyEx(m1, m1, cv.MORPH_OPEN, kernKlein);
  masken.push(m1);

  // 2) hell UND farblos (Papier vs. Holz/Stoff/Tisch)
  const hellM = new cv.Mat(), farblos = new cv.Mat(), m2 = new cv.Mat();
  const otsuV = cv.threshold(glatt, hellM, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.threshold(glatt, hellM, Math.max(90, otsuV * 0.85), 255, cv.THRESH_BINARY);
  cv.threshold(satGlatt, farblos, 60, 255, cv.THRESH_BINARY_INV);
  cv.bitwise_and(hellM, farblos, m2);
  const papier = m2.clone(); // für die Bewertung: echte Papierpixel
  cv.morphologyEx(m2, m2, cv.MORPH_CLOSE, kernGross);
  cv.morphologyEx(m2, m2, cv.MORPH_OPEN, kernKlein);
  masken.push(m2);

  // 3) Kanten mit automatischen Schwellen
  const m3 = new cv.Mat();
  const sortiert = Array.from(glatt.data).sort((a, b) => a - b);
  const median = sortiert[sortiert.length >> 1];
  cv.Canny(glatt, m3, Math.max(10, 0.5 * median), Math.min(255, 1.2 * median));
  cv.dilate(m3, m3, kernKlein);
  cv.morphologyEx(m3, m3, cv.MORPH_CLOSE, kernGross);
  masken.push(m3);

  // 4) hell UND glatt: Papier hat kaum Struktur, Holzmaserung/Stoff schon (hilft, wenn Tisch und Papier ähnlich hell sind)
  const g32 = new cv.Mat(), mittel = new cv.Mat(), quad = new cv.Mat(), mittelQuad = new cv.Mat(), varianz = new cv.Mat();
  grau.convertTo(g32, cv.CV_32F);
  const fenster = new cv.Size(9, 9);
  cv.blur(g32, mittel, fenster);
  cv.multiply(g32, g32, quad);
  cv.blur(quad, mittelQuad, fenster);
  cv.multiply(mittel, mittel, mittel);
  cv.subtract(mittelQuad, mittel, varianz);
  const glattM = new cv.Mat(), m4 = new cv.Mat();
  cv.threshold(varianz, glattM, 60, 255, cv.THRESH_BINARY_INV); // Standardabweichung < ~8
  glattM.convertTo(glattM, cv.CV_8U);
  cv.bitwise_and(glattM, m1, m4);
  const kernText = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k * 2 + 1, k * 2 + 1));
  cv.morphologyEx(m4, m4, cv.MORPH_CLOSE, kernText); // Textzeilen im Papier schließen
  cv.morphologyEx(m4, m4, cv.MORPH_OPEN, kernGross); // Maserungs-Reste entfernen
  masken.push(m4);
  [g32, mittel, quad, mittelQuad, varianz, glattM, kernText].forEach((x) => x.delete());

  // Kandidaten sammeln und fast gleiche zusammenfassen (spart viel Rechenzeit bei der Bewertung)
  const alle = [];
  const gleich = (x, y) => x.every((p, i) => abstand(p, y[i]) < Math.hypot(B, H) * 0.01);
  for (const m of masken) for (const kand of vierecksKandidaten(cv, m, B, H)) if (!alle.some((a) => gleich(a.e, kand.e))) alle.push(kand);
  let beste = null;
  {
    for (const kand of alle) {
      const punkte = bewerte(cv, kand, val, sat, papier, B, H);
      if (!beste || punkte > beste.punkte) beste = { ...kand, punkte };
    }
  }
  [src, rgb, hsv, kanaele, sat, val, grau, glatt, satGlatt, kernGross, kernKlein, hellM, farblos, papier, ...masken].forEach((m) => m.delete());
  return beste && beste.punkte > 0.02 ? beste.e : null;
}

// Kanten nachjustieren: entlang jeder Blattseite die stärkste Helligkeitskante suchen und eine Gerade hindurchlegen.
// quelle: Canvas in Arbeitsauflösung, ecken: grobe Ecken in denselben Koordinaten.
export function kantenVerfeinern(cv, quelle, ecken) {
  const src = cv.imread(quelle);
  const grau = new cv.Mat();
  cv.cvtColor(src, grau, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(grau, grau, new cv.Size(5, 5), 0);
  const gx = new cv.Mat(), gy = new cv.Mat();
  cv.Sobel(grau, gx, cv.CV_32F, 1, 0, 3);
  cv.Sobel(grau, gy, cv.CV_32F, 0, 1, 3);
  const B = grau.cols, H = grau.rows;
  const diag = Math.hypot(B, H);
  const such = Math.round(diag * 0.03);
  const mitte = { x: ecken.reduce((s, p) => s + p.x, 0) / 4, y: ecken.reduce((s, p) => s + p.y, 0) / 4 };
  const geraden = [];
  const tolRand = Math.max(B, H) * 0.012;
  const amRand = (p, q) =>
    (p.x < tolRand && q.x < tolRand) || (p.y < tolRand && q.y < tolRand) || (p.x > B - tolRand && q.x > B - tolRand) || (p.y > H - tolRand && q.y > H - tolRand);
  for (let i = 0; i < 4; i++) {
    const a = ecken[i], b = ecken[(i + 1) % 4];
    // Seite liegt am Bildrand (Brief füllt das Foto): dort gibt es keine Kante – Bildrand behalten
    if (amRand(a, b)) { geraden.push(geradeDurch(a, b)); continue; }
    const len = abstand(a, b);
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
    let nx = -dy, ny = dx; // Normale nach außen
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((m.x - mitte.x) * nx + (m.y - mitte.y) * ny < 0) { nx = -nx; ny = -ny; }
    // Für jede Messstelle die zwei stärksten Kanten "hell innen -> dunkler außen" merken
    const punkte = [];
    const N = 48;
    for (let j = 1; j < N; j++) {
      const t = j / N;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      const spitzen = [];
      let vorher = 0;
      for (let d = -such; d <= such; d++) {
        const x = Math.round(px + nx * d), y = Math.round(py + ny * d);
        if (x < 1 || y < 1 || x >= B - 1 || y >= H - 1) { vorher = 0; continue; }
        const o = y * B + x;
        const g = -(gx.data32F[o] * nx + gy.data32F[o] * ny);
        spitzen.push({ g, x, y });
        vorher = g;
      }
      spitzen.sort((p, q) => q.g - p.g);
      for (const sp of spitzen.slice(0, 2)) if (sp.g > 25) punkte.push(sp);
    }
    // RANSAC: Gerade mit den meisten genau passenden Punkten
    let beste = null;
    if (punkte.length >= 10) {
      const tol = Math.max(1.5, diag * 0.0012);
      for (let it = 0; it < 300; it++) {
        const p = punkte[(Math.random() * punkte.length) | 0], q = punkte[(Math.random() * punkte.length) | 0];
        const l = abstand(p, q);
        if (l < len * 0.25) continue;
        // Richtung muss ungefähr zur Seite passen (max. ~8°)
        if (Math.abs(((q.x - p.x) * dx + (q.y - p.y) * dy) / l) < 0.99) continue;
        const g = geradeDurch(p, q);
        const n = Math.hypot(g.a, g.b);
        let treffer = 0;
        for (const r of punkte) if (Math.abs(g.a * r.x + g.b * r.y - g.c) / n < tol) treffer++;
        if (!beste || treffer > beste.treffer) beste = { g, treffer, n };
      }
    }
    if (!beste || beste.treffer < 12) { geraden.push(geradeDurch(a, b)); continue; }
    // Feinanpassung (kleinste Quadrate) nur auf den passenden Punkten
    const tol = Math.max(1.5, diag * 0.0012);
    const drin = punkte.filter((r) => Math.abs(beste.g.a * r.x + beste.g.b * r.y - beste.g.c) / beste.n < tol);
    const pm = cv.matFromArray(drin.length, 1, cv.CV_32FC2, drin.flatMap((r) => [r.x, r.y]));
    const linie = new cv.Mat();
    cv.fitLine(pm, linie, cv.DIST_L2, 0, 0.01, 0.01);
    const [vx, vy, x0, y0] = linie.data32F;
    geraden.push(geradeDurch({ x: x0, y: y0 }, { x: x0 + vx * 100, y: y0 + vy * 100 }));
    pm.delete();
    linie.delete();
  }
  [src, grau, gx, gy].forEach((m) => m.delete());
  const neu = [];
  for (let i = 0; i < 4; i++) {
    const s = schnitt(geraden[(i + 3) % 4], geraden[i]);
    // Sicherheitsnetz: große Sprünge nicht übernehmen
    neu.push(s && abstand(s, ecken[i]) < diag * 0.04 ? s : ecken[i]);
  }
  return neu;
}

// Ecken minimal zur Mitte ziehen, damit kein Streifen der Unterlage am Rand bleibt
function einruecken(e, anteil) {
  const m = { x: e.reduce((s, p) => s + p.x, 0) / 4, y: e.reduce((s, p) => s + p.y, 0) / 4 };
  return e.map((p) => ({ x: p.x + (m.x - p.x) * anteil * 2, y: p.y + (m.y - p.y) * anteil * 2 }));
}

// ---------- Entzerren & aufhellen ----------
export function entzerren(cv, quelle, ecken, { scan = true, maxSeite = 2480, drehung = 0 } = {}) {
  const [tl, tr, br, bl] = ecken;
  let w = Math.max(abstand(tl, tr), abstand(bl, br));
  let h = Math.max(abstand(tl, bl), abstand(tr, br));
  // Fast A4 (1 : 1,414)? Dann exakt A4 – gleicht Perspektivfehler aus
  const verh = Math.max(w, h) / Math.min(w, h);
  if (Math.abs(verh - Math.SQRT2) / Math.SQRT2 < 0.07) { if (h >= w) h = w * Math.SQRT2; else w = h * Math.SQRT2; }
  const f = Math.min(1, maxSeite / Math.max(w, h));
  w = Math.round(w * f);
  h = Math.round(h * f);
  // Nur den Bereich um das Blatt einlesen (spart Speicher und Zeit)
  const x0 = Math.max(0, Math.floor(Math.min(tl.x, bl.x, tr.x, br.x)) - 2), y0 = Math.max(0, Math.floor(Math.min(tl.y, tr.y, bl.y, br.y)) - 2);
  const x1 = Math.min(quelle.width, Math.ceil(Math.max(tl.x, bl.x, tr.x, br.x)) + 2), y1 = Math.min(quelle.height, Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y)) + 2);
  const bereich = quelle.getContext("2d").getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  const src = cv.matFromImageData(bereich);
  const v = (p) => [p.x - x0, p.y - y0];
  const von = cv.matFromArray(4, 1, cv.CV_32FC2, [...v(tl), ...v(tr), ...v(br), ...v(bl)]);
  const nach = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(von, nach);
  const aus = new cv.Mat();
  cv.warpPerspective(src, aus, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  let ergebnis = aus;
  if (scan) ergebnis = scanLook(cv, aus);
  if (drehung) {
    const gedreht = new cv.Mat();
    cv.rotate(ergebnis, gedreht, { 90: cv.ROTATE_90_CLOCKWISE, 180: cv.ROTATE_180, 270: cv.ROTATE_90_COUNTERCLOCKWISE }[drehung]);
    if (ergebnis !== aus) ergebnis.delete();
    ergebnis = gedreht;
  }
  const canvas = document.createElement("canvas");
  cv.imshow(canvas, ergebnis);
  [src, von, nach, M, aus].forEach((m) => m.delete());
  if (ergebnis !== aus) ergebnis.delete();
  return canvas;
}

// ---------- Textausrichtung ----------
// Liefert die nötige Drehung im Uhrzeigersinn (0, 90, 180, 270), damit die Schrift aufrecht steht.
// 1) Laufen die Zeilen waagerecht oder senkrecht? (Zeilen erzeugen ein stark schwankendes Profil quer zur Schrift)
// 2) Oben oder unten? Oberlängen (b d f h k l t, Großbuchstaben, Umlautpunkte) sind im Deutschen deutlich häufiger als
//    Unterlängen (g j p q y) – liegt mehr "Tinte" unter dem Zeilenkern als darüber, steht die Seite auf dem Kopf.
export function textAusrichtung(cv, quelle) {
  const src = cv.imread(quelle);
  const grau = new cv.Mat();
  cv.cvtColor(src, grau, cv.COLOR_RGBA2GRAY);
  const s = Math.min(1, 1400 / Math.max(grau.cols, grau.rows));
  if (s < 1) cv.resize(grau, grau, new cv.Size(Math.round(grau.cols * s), Math.round(grau.rows * s)), 0, 0, cv.INTER_AREA);
  const tinte = new cv.Mat();
  cv.adaptiveThreshold(grau, tinte, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 25, 18);
  // Rand (Schatten, Lochung, Tischreste) ignorieren
  const r = Math.round(Math.min(tinte.cols, tinte.rows) * 0.04);
  const innen = tinte.roi(new cv.Rect(r, r, tinte.cols - 2 * r, tinte.rows - 2 * r));

  const profil = (m, richtung) => {
    const out = new cv.Mat();
    cv.reduce(m, out, richtung, cv.REDUCE_SUM, cv.CV_32S);
    const a = Array.from(out.data32S);
    out.delete();
    return a;
  };
  // Leserichtung: Schrift in beide Richtungen "verschmieren" – in Leserichtung verschmelzen Buchstaben zu wenigen Zeilen
  const teile = (kx, ky) => {
    const m = new cv.Mat(), lab = new cv.Mat();
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kx, ky));
    cv.dilate(innen, m, k);
    const n = cv.connectedComponents(m, lab, 8, cv.CV_32S);
    [m, lab, k].forEach((x) => x.delete());
    return n;
  };
  const breite = Math.max(9, Math.round(Math.max(innen.cols, innen.rows) * 0.012));
  const waagerecht = teile(breite, 1) <= teile(1, breite);

  // Oben/unten an einem Zeilenprofil entscheiden (Zeilen verlaufen waagerecht)
  const obenUnten = (p) => {
    let ober = 0, unter = 0, n = 0;
    const max = Math.max(...p);
    if (!max) return 0;
    let i = 0;
    while (i < p.length) {
      if (p[i] < max * 0.04) { i++; continue; }
      let j = i;
      while (j < p.length && p[j] >= max * 0.04) j++;
      const zeile = p.slice(i, j);
      const zmax = Math.max(...zeile);
      if (j - i >= 6 && j - i < p.length * 0.08) {
        const kern = zeile.map((v, k) => (v >= zmax * 0.5 ? k : -1)).filter((k) => k >= 0);
        const a = kern[0], b = kern[kern.length - 1];
        for (let k = 0; k < a; k++) ober += zeile[k];
        for (let k = b + 1; k < zeile.length; k++) unter += zeile[k];
        n++;
      }
      i = j;
    }
    if (n < 3 || ober + unter === 0) return 0;
    return (ober - unter) / (ober + unter); // > 0: aufrecht, < 0: auf dem Kopf
  };

  // Zweites Merkmal: Briefe sind linksbündig – viele Zeilen beginnen an derselben Stelle, die Zeilenenden flattern.
  // Steht die Seite auf dem Kopf, ist es umgekehrt. Robust auch bei unscharfen Fotos, weil nur Zeilen-Umrisse zählen.
  const buendig = (m) => {
    const d = new cv.Mat(), lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(breite, 1));
    cv.dilate(m, d, k);
    const n = cv.connectedComponentsWithStats(d, lab, st, ce, 8, cv.CV_32S);
    const links = [], rechts = [];
    const W = m.cols, H = m.rows;
    for (let i = 1; i < n; i++) {
      const x = st.intAt(i, 0), y = st.intAt(i, 1), w = st.intAt(i, 2), h = st.intAt(i, 3);
      // nur Textzeilen: flach, nicht winzig, nicht die ganze Seite
      if (w < W * 0.12 || h < 4 || h > H * 0.05 || w < h * 4) continue;
      links.push(x); rechts.push(x + w);
    }
    [d, lab, st, ce, k].forEach((x) => x.delete());
    const tol = Math.max(3, W * 0.01);
    const cluster = (a) => { let best = 0; for (const v of a) { let c = 0; for (const u of a) if (Math.abs(u - v) <= tol) c++; best = Math.max(best, c); } return best; };
    return { links: cluster(links), rechts: cluster(rechts), zeilen: links.length };
  };
  // > 0: aufrecht, < 0: auf dem Kopf (für waagerechte Zeilen)
  const urteil = (m) => {
    const w1 = obenUnten(profil(m, 1));
    const b = buendig(m);
    const w2 = b.zeilen >= 4 ? (b.links - b.rechts) / Math.max(4, b.links, b.rechts) : 0;
    // Bündigkeit ist das stärkere Signal, wenn eindeutig; sonst Ober-/Unterlängen
    const wert = Math.abs(w2) >= 0.2 ? w2 * 2 + w1 : w1 * 3 + w2;
    return { wert, w1, w2, ...b };
  };

  let drehung = 0;
  if (waagerecht) {
    const u = urteil(innen);
    textAusrichtung.letzte = u;
    drehung = u.wert < -0.15 ? 180 : 0;
  } else {
    // Zeilen senkrecht: 90° im Uhrzeigersinn drehen und dann oben/unten prüfen
    const gedreht = new cv.Mat();
    cv.rotate(innen, gedreht, cv.ROTATE_90_CLOCKWISE);
    const u = urteil(gedreht);
    textAusrichtung.letzte = u;
    gedreht.delete();
    drehung = u.wert < -0.15 ? 270 : 90;
  }
  [src, grau, tinte, innen].forEach((m) => m.delete());
  return drehung;
}

// Schatten und Graustich entfernen: Hintergrund schätzen und herausrechnen (wie ein Flachbettscan)
function scanLook(cv, rgba) {
  const grau = new cv.Mat();
  cv.cvtColor(rgba, grau, cv.COLOR_RGBA2GRAY);
  const klein = new cv.Mat();
  // Hintergrund (Papierhelligkeit inkl. Schatten und Knicke) schätzen: Schrift wegwischen, leicht glätten
  const s = 0.25;
  cv.resize(grau, klein, new cv.Size(Math.max(1, Math.round(grau.cols * s)), Math.max(1, Math.round(grau.rows * s))), 0, 0, cv.INTER_AREA);
  const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)); // wischt dünne Schriftstriche weg, breite Knickschatten bleiben im Hintergrund
  cv.dilate(klein, klein, kern);
  cv.medianBlur(klein, klein, 5);
  const hg = new cv.Mat();
  cv.resize(klein, hg, new cv.Size(grau.cols, grau.rows), 0, 0, cv.INTER_LINEAR);
  const aus = new cv.Mat();
  cv.divide(grau, hg, aus, 255); // Papier -> weiß, Schrift bleibt dunkel
  // leichte Kontrastanhebung: fast weiß -> weiß
  cv.convertScaleAbs(aus, aus, 1.15, -30);
  const farbe = new cv.Mat();
  cv.cvtColor(aus, farbe, cv.COLOR_GRAY2RGBA);
  [grau, klein, kern, hg, aus].forEach((m) => m.delete());
  return farbe;
}

// ---------- Bild vorbereiten ----------
const MAX_SEITE = 3200; // größere Fotos werden verkleinert (reicht für Briefe, schont den Speicher)

// JPEG-Kopf lesen: EXIF-Ausrichtung (1–8) und die gespeicherte Pixelgröße
async function jpegInfo(blob) {
  try {
    const v = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xffd8) return null;
    let o = 2, orientierung = 1, breite = 0, hoehe = 0;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const ifd = t + v.getUint32(t + 4, le);
        const n = v.getUint16(ifd, le);
        for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (v.getUint16(e, le) === 0x0112) orientierung = v.getUint16(e + 8, le); }
      } else if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
        hoehe = v.getUint16(o + 5); breite = v.getUint16(o + 7);
        break;
      }
      o += 2 + len;
    }
    return { orientierung, breite, hoehe };
  } catch { return null; }
}

async function alsCanvas(quelle) {
  const bild = quelle instanceof Blob ? await createImageBitmap(quelle, { imageOrientation: "from-image" }) : quelle;
  const w = bild.videoWidth || bild.width, h = bild.videoHeight || bild.height;
  // Absicherung: Hat der Browser die EXIF-Drehung (Hochformat-Foto quer gespeichert) nicht angewendet, selbst drehen
  let drehen = 0;
  if (quelle instanceof Blob) {
    const j = await jpegInfo(quelle);
    if (j && j.orientierung >= 5 && j.breite !== j.hoehe && w === j.breite && h === j.hoehe) drehen = j.orientierung === 8 || j.orientierung === 7 ? 270 : 90;
  }
  const f = Math.min(1, MAX_SEITE / Math.max(w, h));
  const bw = Math.round(w * f), bh = Math.round(h * f);
  const c = document.createElement("canvas");
  c.width = drehen ? bh : bw;
  c.height = drehen ? bw : bh;
  const g = c.getContext("2d");
  if (drehen) { g.translate(c.width / 2, c.height / 2); g.rotate((drehen * Math.PI) / 180); g.drawImage(bild, -bw / 2, -bh / 2, bw, bh); }
  else g.drawImage(bild, 0, 0, bw, bh);
  bild.close?.();
  return c;
}

// Blatt im fertigen Foto suchen: grob auf 640 px, Kanten fein auf bis zu 1200 px, Ecken zurückgerechnet
function verkleinert(roh, lang) {
  const s = Math.min(1, lang / Math.max(roh.width, roh.height));
  const c = document.createElement("canvas");
  c.width = Math.round(roh.width * s);
  c.height = Math.round(roh.height * s);
  c.getContext("2d").drawImage(roh, 0, 0, c.width, c.height);
  return { c, s };
}
function eckenImFoto(cv, roh) {
  const grob = verkleinert(roh, 640);
  const e = findePapier(cv, grob.c);
  if (!e) return null;
  const fein = verkleinert(roh, 1200);
  const f = fein.s / grob.s;
  let ecken = e.map((p) => ({ x: p.x * f, y: p.y * f }));
  try { ecken = kantenVerfeinern(cv, fein.c, ecken); } catch (x) { console.warn(x); }
  ecken = einruecken(ecken, 0.003);
  return ecken.map((p) => ({ x: Math.min(roh.width, Math.max(0, p.x / fein.s)), y: Math.min(roh.height, Math.max(0, p.y / fein.s)) }));
}

// ---------- Prüfen & Zuschneiden (für App-Kamera und Handy-Fotos) ----------
// Zeigt die zugeschnittene Seite. Ergebnis: { blob } bei Übernehmen, null bei "Neu"/Abbrechen.
class Pruefer {
  constructor({ cv, huelle, einstellungen, speichereEinstellungen }) {
    Object.assign(this, { cv, huelle, einstellungen, speichereEinstellungen });
  }

  zeige(roh) {
    const ecken = eckenImFoto(this.cv, roh);
    this.aufnahme = { roh, ecken: ecken || [{ x: 0, y: 0 }, { x: roh.width, y: 0 }, { x: roh.width, y: roh.height }, { x: 0, y: roh.height }], erkannt: !!ecken, bearbeitet: false };
    return new Promise((resolve) => { this.fertig = resolve; this.darstellen(); });
  }

  darstellen() {
    const a = this.aufnahme;
    const p = this.huelle;
    clearInterval(this.countdown);
    // Vorschau klein und schnell – die volle Auflösung wird erst beim Übernehmen berechnet
    const opt = { scan: this.einstellungen().scan, maxSeite: 1200 };
    if (a.drehung === undefined) {
      // Ausrichtung einmalig automatisch bestimmen (Schrift aufrecht) – auf einer eigenen, größeren Fassung für sichere Erkennung
      try {
        const probe = entzerren(this.cv, a.roh, a.ecken, { scan: true, maxSeite: 2000 });
        a.drehung = textAusrichtung(this.cv, probe);
        probe.width = probe.height = 0;
      } catch { a.drehung = 0; }
    }
    this.ergebnis = entzerren(this.cv, a.roh, a.ecken, { ...opt, drehung: a.drehung });
    p.hidden = false;
    p.innerHTML = `<div class="sc-vorschau"></div>
      ${a.erkannt ? "" : '<p class="sc-warn">Kein Blatt erkannt – ganzes Foto übernommen. Mit „Ecken anpassen“ zuschneiden.</p>'}
      <div class="sc-reihe">
        <button class="sc-zweit" data-p="neu">↺<br>Neu</button>
        <button class="sc-zweit" data-p="ecken">⬚<br>Ecken</button>
        <button class="sc-zweit" data-p="drehen">⟳<br>Drehen</button>
        <button class="sc-zweit" data-p="modus">${this.einstellungen().scan ? "🎨<br>Farbe" : "📄<br>Scan"}</button>
      </div>
      <button class="sc-ok" data-p="ok">✓ Seite übernehmen</button>`;
    this.ergebnis.className = "sc-ergebnis";
    p.querySelector(".sc-vorschau").append(this.ergebnis);
    p.onclick = (e) => { const b = e.target.closest("[data-p]"); if (b && !b.disabled) this.aktion(b.dataset.p, b); };
  }

  eckenAnpassen() {
    const { roh } = this.aufnahme;
    const ecken = this.aufnahme.ecken.map((q) => ({ ...q }));
    const p = this.huelle;
    p.innerHTML = `<p class="sc-info2">Ecken auf die Blattkanten ziehen</p><div class="sc-edit"><canvas></canvas></div>
      <div class="sc-reihe"><button class="sc-zweit" data-p="ecken-abbrechen">Abbrechen</button><button class="sc-ok" data-p="ecken-ok">✓ Zuschneiden</button></div>`;
    const c = p.querySelector("canvas");
    const box = p.querySelector(".sc-edit").getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const s = Math.min(box.width / roh.width, box.height / roh.height);
    c.style.width = `${roh.width * s}px`;
    c.style.height = `${roh.height * s}px`;
    c.width = Math.round(roh.width * s * dpr);
    c.height = Math.round(roh.height * s * dpr);
    const g = c.getContext("2d");
    const k = s * dpr;
    const pfad = () => { g.beginPath(); ecken.forEach((q, i) => (i ? g.lineTo(q.x * k, q.y * k) : g.moveTo(q.x * k, q.y * k))); g.closePath(); };
    const zeichne = () => {
      g.drawImage(roh, 0, 0, c.width, c.height);
      g.fillStyle = "rgba(0,0,0,.4)";
      g.beginPath(); g.rect(0, 0, c.width, c.height);
      ecken.forEach((q, i) => (i ? g.lineTo(q.x * k, q.y * k) : g.moveTo(q.x * k, q.y * k)));
      g.closePath(); g.fill("evenodd");
      pfad(); g.lineWidth = 2 * dpr; g.strokeStyle = "#3ddc84"; g.stroke();
      for (const q of ecken) {
        g.beginPath(); g.arc(q.x * k, q.y * k, 16 * dpr, 0, Math.PI * 2); g.fillStyle = "rgba(61,220,132,.35)"; g.fill();
        g.lineWidth = 3 * dpr; g.strokeStyle = "#fff"; g.stroke();
      }
    };
    zeichne();
    let ziehe = -1;
    const pos = (ev) => { const r = c.getBoundingClientRect(); return { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s }; };
    c.addEventListener("pointerdown", (ev) => {
      const q = pos(ev);
      let best = -1, d = Infinity;
      ecken.forEach((e, i) => { const x = abstand(e, q); if (x < d) { d = x; best = i; } });
      if (d * s < 60) { ziehe = best; c.setPointerCapture(ev.pointerId); ev.preventDefault(); }
    });
    c.addEventListener("pointermove", (ev) => {
      if (ziehe < 0) return;
      const q = pos(ev);
      ecken[ziehe] = { x: Math.max(0, Math.min(roh.width, q.x)), y: Math.max(0, Math.min(roh.height, q.y)) };
      zeichne();
    });
    c.addEventListener("pointerup", () => (ziehe = -1));
    this.eckenEdit = ecken;
  }

  async aktion(was, knopf) {
    if (was !== "ok") { clearInterval(this.countdown); this.aufnahme.bearbeitet = true; }
    const e = this.einstellungen();
    switch (was) {
      case "ok": {
        clearInterval(this.countdown);
        knopf.disabled = true;
        knopf.textContent = "Speichere …";
        await new Promise((r) => setTimeout(r, 30)); // Anzeige aktualisieren lassen
        const voll = entzerren(this.cv, this.aufnahme.roh, this.aufnahme.ecken, { scan: this.einstellungen().scan, drehung: this.aufnahme.drehung || 0 });
        const blob = await new Promise((r) => voll.toBlob(r, "image/jpeg", 0.9));
        return this.schliessen({ blob });
      }
      case "neu": return this.schliessen(null);
      case "modus": e.scan = !e.scan; this.speichereEinstellungen(e); return this.darstellen();
      case "drehen": this.aufnahme.drehung = ((this.aufnahme.drehung || 0) + 90) % 360; return this.darstellen();
      case "ecken": return this.eckenAnpassen();
      case "ecken-abbrechen": return this.darstellen();
      case "ecken-ok": this.aufnahme.ecken = sortiereEcken(this.eckenEdit); this.aufnahme.erkannt = true; return this.darstellen();
    }
  }

  schliessen(ergebnis) {
    clearInterval(this.countdown);
    this.huelle.hidden = true;
    this.huelle.innerHTML = "";
    this.huelle.onclick = null;
    const f = this.fertig;
    this.fertig = null;
    f?.(ergebnis);
  }
}

// Ein Foto aus der Handy-Kamera oder Galerie zuschneiden (Vollbild-Dialog)
export async function fotoZuschneiden({ cv, datei, einstellungen, speichereEinstellungen }) {
  const el = document.createElement("div");
  el.className = "scanner";
  el.innerHTML = `<div class="sc-pruefen"><p class="sc-info2">Wird zugeschnitten …</p></div>`;
  document.body.append(el);
  document.body.classList.add("scanner-offen");
  try {
    const roh = await alsCanvas(datei);
    const pr = new Pruefer({ cv, huelle: el.querySelector(".sc-pruefen"), einstellungen, speichereEinstellungen });
    return await pr.zeige(roh);
  } finally {
    el.remove();
    if (!document.querySelector(".scanner")) document.body.classList.remove("scanner-offen");
  }
}

// Nur für Tests
export { eckenImFoto as _eckenImFoto, alsCanvas as _alsCanvas };
