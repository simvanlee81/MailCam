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
function viereckAusMaske(cv, maske, breite, hoehe) {
  const konturen = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(maske, konturen, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let bestes = null;
  let besteFlaeche = 0;
  for (let i = 0; i < konturen.size(); i++) {
    const k = konturen.get(i);
    const a = cv.contourArea(k);
    if (a < breite * hoehe * 0.12) { k.delete(); continue; }
    const huelle = new cv.Mat();
    cv.convexHull(k, huelle);
    const umfang = cv.arcLength(huelle, true);
    for (const eps of [0.02, 0.03, 0.045]) {
      const approx = new cv.Mat();
      cv.approxPolyDP(huelle, approx, eps * umfang, true);
      if (approx.rows === 4) {
        const pkt = [];
        for (let j = 0; j < 4; j++) pkt.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
        const e = sortiereEcken(pkt);
        const f = flaeche(e);
        if (plausibel(e, breite, hoehe) && f > besteFlaeche) { bestes = e; besteFlaeche = f; }
        approx.delete();
        break;
      }
      approx.delete();
    }
    huelle.delete();
    k.delete();
  }
  konturen.delete();
  hier.delete();
  return bestes;
}

// Papier im Bild finden. quelle: Canvas (klein, ~500 px). Rückgabe: 4 Ecken oder null.
export function findePapier(cv, quelle) {
  const src = cv.imread(quelle);
  const grau = new cv.Mat();
  cv.cvtColor(src, grau, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(grau, grau, new cv.Size(5, 5), 0);
  const B = src.cols, H = src.rows;
  const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const kandidaten = [];

  // Weg 1: Kanten (Canny) – gut bei Kontrast Papier/Tisch
  const kanten = new cv.Mat();
  cv.Canny(grau, kanten, 40, 120);
  cv.dilate(kanten, kanten, kern);
  const k1 = viereckAusMaske(cv, kanten, B, H);
  if (k1) kandidaten.push(k1);

  // Weg 2: Helligkeit (Otsu) – Papier ist meist heller als die Unterlage
  const hell = new cv.Mat();
  cv.threshold(grau, hell, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.morphologyEx(hell, hell, cv.MORPH_CLOSE, kern, new cv.Point(-1, -1), 2);
  const k2 = viereckAusMaske(cv, hell, B, H);
  if (k2) kandidaten.push(k2);

  [src, grau, kanten, hell, kern].forEach((m) => m.delete());
  if (!kandidaten.length) return null;
  // Größeres Viereck gewinnt, aber nicht, wenn es praktisch der ganze Bildrand ist
  kandidaten.sort((a, b) => flaeche(b) - flaeche(a));
  const rand = kandidaten.find((e) => flaeche(e) < B * H * 0.97);
  return einruecken(rand || kandidaten[0], 0.008);
}

// Ecken minimal zur Mitte ziehen, damit kein Streifen der Unterlage am Rand bleibt
function einruecken(e, anteil) {
  const m = { x: e.reduce((s, p) => s + p.x, 0) / 4, y: e.reduce((s, p) => s + p.y, 0) / 4 };
  return e.map((p) => ({ x: p.x + (m.x - p.x) * anteil * 2, y: p.y + (m.y - p.y) * anteil * 2 }));
}

// ---------- Entzerren & aufhellen ----------
export function entzerren(cv, quelle, ecken, { scan = true, maxSeite = 3000 } = {}) {
  const [tl, tr, br, bl] = ecken;
  let w = Math.max(abstand(tl, tr), abstand(bl, br));
  let h = Math.max(abstand(tl, bl), abstand(tr, br));
  const f = Math.min(1, maxSeite / Math.max(w, h));
  w = Math.round(w * f);
  h = Math.round(h * f);
  const src = cv.imread(quelle);
  const von = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const nach = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const M = cv.getPerspectiveTransform(von, nach);
  const aus = new cv.Mat();
  cv.warpPerspective(src, aus, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  let ergebnis = aus;
  if (scan) ergebnis = scanLook(cv, aus);
  const canvas = document.createElement("canvas");
  cv.imshow(canvas, ergebnis);
  [src, von, nach, M, aus].forEach((m) => m.delete());
  if (ergebnis !== aus) ergebnis.delete();
  return canvas;
}

// Schatten und Graustich entfernen: Hintergrund schätzen und herausrechnen (wie ein Flachbettscan)
function scanLook(cv, rgba) {
  const grau = new cv.Mat();
  cv.cvtColor(rgba, grau, cv.COLOR_RGBA2GRAY);
  const klein = new cv.Mat();
  const s = 0.25;
  cv.resize(grau, klein, new cv.Size(Math.max(1, Math.round(grau.cols * s)), Math.max(1, Math.round(grau.rows * s))), 0, 0, cv.INTER_AREA);
  const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  cv.dilate(klein, klein, kern); // Schrift "wegwischen"
  cv.medianBlur(klein, klein, 15);
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

async function alsCanvas(quelle) {
  const bild = quelle instanceof Blob ? await createImageBitmap(quelle, { imageOrientation: "from-image" }) : quelle;
  const w = bild.videoWidth || bild.width, h = bild.videoHeight || bild.height;
  const f = Math.min(1, MAX_SEITE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * f);
  c.height = Math.round(h * f);
  c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
  bild.close?.();
  return c;
}

// Blatt im fertigen Foto suchen (auf 1000 px verkleinert, Ecken zurückgerechnet)
function eckenImFoto(cv, roh) {
  const s = 1000 / Math.max(roh.width, roh.height);
  const m = document.createElement("canvas");
  m.width = Math.round(roh.width * s);
  m.height = Math.round(roh.height * s);
  m.getContext("2d").drawImage(roh, 0, 0, m.width, m.height);
  const e = findePapier(cv, m);
  return e ? e.map((p) => ({ x: p.x / s, y: p.y / s })) : null;
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
    this.ergebnis = entzerren(this.cv, a.roh, a.ecken, { scan: this.einstellungen().scan });
    p.hidden = false;
    p.innerHTML = `<div class="sc-vorschau"></div>
      ${a.erkannt ? "" : '<p class="sc-warn">Kein Blatt erkannt – ganzes Foto übernommen. Mit „Ecken anpassen“ zuschneiden.</p>'}
      <div class="sc-reihe">
        <button class="sc-zweit" data-p="neu">↺ Neu</button>
        <button class="sc-zweit" data-p="ecken">⬚ Ecken anpassen</button>
        <button class="sc-zweit" data-p="modus">${this.einstellungen().scan ? "🎨 Farbe" : "📄 Scan"}</button>
      </div>
      <button class="sc-ok" data-p="ok">✓ Seite übernehmen</button>`;
    this.ergebnis.className = "sc-ergebnis";
    p.querySelector(".sc-vorschau").append(this.ergebnis);
    p.onclick = (e) => { const b = e.target.closest("[data-p]"); if (b && !b.disabled) this.aktion(b.dataset.p, b); };
    // Blatt erkannt und nichts angefasst: nach 2 s automatisch übernehmen
    if (a.erkannt && !a.bearbeitet) {
      let rest = 2;
      const k = p.querySelector("[data-p=ok]");
      k.textContent = `✓ Übernehme in ${rest} …`;
      this.countdown = setInterval(() => {
        rest--;
        if (rest > 0) k.textContent = `✓ Übernehme in ${rest} …`;
        else { clearInterval(this.countdown); if (!k.disabled) this.aktion("ok", k); }
      }, 1000);
    }
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
        const blob = await new Promise((r) => this.ergebnis.toBlob(r, "image/jpeg", 0.9));
        return this.schliessen({ blob });
      }
      case "neu": return this.schliessen(null);
      case "modus": e.scan = !e.scan; this.speichereEinstellungen(e); return this.darstellen();
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

// ---------- App-Kamera: selbst auslösen, danach automatisch zuschneiden ----------
export class Scanner {
  constructor({ cv, onSeite, onNaechsterBrief, onSchliessen, status, einstellungen, speichereEinstellungen }) {
    Object.assign(this, { cv, onSeite, onNaechsterBrief, onSchliessen, status, einstellungen, speichereEinstellungen });
    this.beschaeftigt = false;
  }

  async starten() {
    this.el = document.createElement("div");
    this.el.className = "scanner";
    this.el.innerHTML = `
      <div class="sc-oben"><button class="sc-x" data-s="schliessen" aria-label="Schließen">✕</button><span class="sc-info"></span></div>
      <div class="sc-bild"><video playsinline muted autoplay></video><span class="sc-hinweis">Brief ins Bild halten und auslösen</span></div>
      <div class="sc-unten">
        <button class="sc-klein" data-s="licht" hidden>🔦<span>Licht</span></button>
        <button class="sc-klein" data-s="modus"><b></b><span>Bild</span></button>
        <button class="sc-ausloeser" data-s="ausloesen" aria-label="Aufnehmen"></button>
        <button class="sc-klein" data-s="brief">➕<span>Nächster Brief</span></button>
        <span class="sc-klein-platz"></span>
      </div>
      <button class="sc-fertig" data-s="schliessen">Fertig mit Fotografieren</button>
      <div class="sc-pruefen" hidden></div>`;
    document.body.append(this.el);
    document.body.classList.add("scanner-offen");
    this.video = this.el.querySelector("video");
    this.pruefer = new Pruefer({ cv: this.cv, huelle: this.el.querySelector(".sc-pruefen"), einstellungen: this.einstellungen, speichereEinstellungen: this.speichereEinstellungen });
    this.el.addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (b && !b.disabled) this.aktion(b.dataset.s, b); });
    this.zeigeKnoepfe();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 3840 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    await new Promise((r) => (this.video.videoWidth ? r() : this.video.addEventListener("loadedmetadata", r, { once: true })));
    this.spur = this.stream.getVideoTracks()[0];
    try { if ("ImageCapture" in window) this.fotoapparat = new ImageCapture(this.spur); } catch {}
    try {
      const f = this.spur.getCapabilities?.() || {};
      if (f.torch) this.el.querySelector("[data-s=licht]").hidden = false;
      if (f.focusMode?.includes("continuous")) await this.spur.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    } catch {}
  }

  zeigeKnoepfe() {
    const e = this.einstellungen();
    this.el.querySelector("[data-s=modus] b").textContent = e.scan ? "Scan" : "Farbe";
    const s = this.status();
    this.el.querySelector(".sc-info").textContent = `Brief ${s.brief} · ${s.seitenImBrief} Seite${s.seitenImBrief === 1 ? "" : "n"}`;
  }

  hinweis(t) { this.el.querySelector(".sc-hinweis").textContent = t || ""; }

  // Foto in voller Auflösung (ImageCapture), sonst Einzelbild aus dem Kamerabild
  async foto() {
    if (this.fotoapparat) {
      try {
        const blob = await Promise.race([this.fotoapparat.takePhoto(), new Promise((_, j) => setTimeout(() => j(new Error("zu langsam")), 5000))]);
        return await alsCanvas(blob);
      } catch { this.fotoapparat = null; } // Gerät kann es nicht – ab jetzt Einzelbild
    }
    return alsCanvas(this.video);
  }

  async ausloesen() {
    if (this.beschaeftigt) return;
    this.beschaeftigt = true;
    const k = this.el.querySelector("[data-s=ausloesen]");
    k.classList.add("arbeitet");
    this.el.classList.add("blitz");
    setTimeout(() => this.el.classList.remove("blitz"), 150);
    navigator.vibrate?.(25);
    try {
      const roh = await this.foto();
      const ergebnis = await this.pruefer.zeige(roh);
      if (ergebnis?.blob) {
        await this.onSeite(ergebnis.blob);
        this.zeigeKnoepfe();
        this.hinweis("Nächste Seite hinlegen und auslösen");
      }
    } catch (e) {
      this.hinweis(`Fehler: ${e.message}`);
    } finally {
      k.classList.remove("arbeitet");
      this.beschaeftigt = false;
    }
  }

  async aktion(was, knopf) {
    const e = this.einstellungen();
    switch (was) {
      case "ausloesen": return this.ausloesen();
      case "modus": e.scan = !e.scan; this.speichereEinstellungen(e); return this.zeigeKnoepfe();
      case "licht": {
        this.licht = !this.licht;
        try { await this.spur.applyConstraints({ advanced: [{ torch: this.licht }] }); } catch {}
        return knopf.classList.toggle("an", this.licht);
      }
      case "brief": { if (this.onNaechsterBrief() !== false) { this.zeigeKnoepfe(); this.hinweis("Neuer Brief – erste Seite auslösen"); } return; }
      case "schliessen": return this.beenden();
    }
  }

  beenden() {
    try { if (this.licht) this.spur.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.el?.remove();
    document.body.classList.remove("scanner-offen");
    this.onSchliessen?.();
  }
}
