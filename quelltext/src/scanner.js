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

// ---------- Live-Scanner ----------
// Öffnet eine Vollbild-Kamera. onSeite(blob) wird für jede übernommene Seite aufgerufen.
export class Scanner {
  constructor({ cv, onSeite, onNaechsterBrief, onSchliessen, status, einstellungen, speichereEinstellungen }) {
    Object.assign(this, { cv, onSeite, onNaechsterBrief, onSchliessen, status, einstellungen, speichereEinstellungen });
    this.verlauf = [];
    this.letzteAufnahme = null;
    this.pause = false;
    this.aktiv = false;
  }

  async starten() {
    this.el = document.createElement("div");
    this.el.className = "scanner";
    this.el.innerHTML = `
      <div class="sc-oben"><button class="sc-x" data-s="schliessen" aria-label="Schließen">✕</button><span class="sc-info"></span></div>
      <div class="sc-bild"><video playsinline muted autoplay></video><canvas class="sc-overlay"></canvas><span class="sc-hinweis"></span></div>
      <div class="sc-unten">
        <button class="sc-klein" data-s="licht" hidden>🔦<span>Licht</span></button>
        <button class="sc-klein" data-s="auto"><b></b><span>Auto</span></button>
        <button class="sc-ausloeser" data-s="ausloesen" aria-label="Aufnehmen"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="ring"/><circle cx="50" cy="50" r="46" class="fortschritt"/></svg></button>
        <button class="sc-klein" data-s="modus"><b></b><span>Bild</span></button>
        <button class="sc-klein" data-s="brief">➕<span>Nächster Brief</span></button>
      </div>
      <button class="sc-fertig" data-s="schliessen">Fertig mit Fotografieren</button>
      <div class="sc-pruefen" hidden></div>`;
    document.body.append(this.el);
    document.body.classList.add("scanner-offen");
    this.video = this.el.querySelector("video");
    this.overlay = this.el.querySelector(".sc-overlay");
    this.klein = document.createElement("canvas");
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
    try {
      const f = this.spur.getCapabilities?.() || {};
      if (f.torch) this.el.querySelector("[data-s=licht]").hidden = false;
      if (f.focusMode?.includes("continuous")) await this.spur.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    } catch {}
    this.aktiv = true;
    this.schleife();
  }

  zeigeKnoepfe() {
    const e = this.einstellungen();
    this.el.querySelector("[data-s=auto] b").textContent = e.auto ? "AN" : "AUS";
    this.el.querySelector("[data-s=auto]").classList.toggle("an", e.auto);
    this.el.querySelector("[data-s=modus] b").textContent = e.scan ? "Scan" : "Farbe";
    const s = this.status();
    this.el.querySelector(".sc-info").textContent = `Brief ${s.brief} · ${s.seitenImBrief} Seite${s.seitenImBrief === 1 ? "" : "n"}`;
  }

  hinweis(t) { this.el.querySelector(".sc-hinweis").textContent = t || ""; }

  // Erkennung ~8x pro Sekunde auf einem verkleinerten Bild
  async schleife() {
    let letzte = 0;
    const takt = async (zeit) => {
      if (!this.aktiv) return;
      if (!this.pause && zeit - letzte > 120 && this.video.videoWidth) {
        letzte = zeit;
        try { this.erkenne(); } catch (e) { console.warn(e); }
      }
      requestAnimationFrame(takt);
    };
    requestAnimationFrame(takt);
  }

  erkenne() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const s = 480 / Math.max(vw, vh);
    this.klein.width = Math.round(vw * s);
    this.klein.height = Math.round(vh * s);
    this.klein.getContext("2d", { willReadFrequently: true }).drawImage(this.video, 0, 0, this.klein.width, this.klein.height);
    const e = findePapier(this.cv, this.klein);
    const ecken = e ? e.map((p) => ({ x: p.x / s, y: p.y / s })) : null;
    this.aktuelleEcken = ecken;
    const diag = Math.hypot(vw, vh);

    // Stabilität: Ecken bewegen sich kaum über mehrere Messungen
    if (ecken) {
      const vorher = this.verlauf[this.verlauf.length - 1];
      const ruhig = vorher && ecken.every((p, i) => abstand(p, vorher[i]) < diag * 0.012);
      this.verlauf = ruhig ? [...this.verlauf, ecken].slice(-12) : [ecken];
    } else {
      this.verlauf = [];
    }
    // Nach einer Aufnahme erst wieder auslösen, wenn eine andere Seite im Bild ist
    if (this.letzteAufnahme) {
      if (!ecken) { if (++this.leerZaehler > 3) this.letzteAufnahme = null; }
      else if (ecken.some((p, i) => abstand(p, this.letzteAufnahme[i]) > diag * 0.08)) this.letzteAufnahme = null;
      else this.leerZaehler = 0;
    }
    const noetig = 8;
    const fortschritt = this.einstellungen().auto && !this.letzteAufnahme ? Math.min(1, (this.verlauf.length - 1) / noetig) : 0;
    this.zeichneOverlay(ecken, fortschritt);
    if (!ecken) this.hinweis("Seite ins Bild halten");
    else if (this.letzteAufnahme) this.hinweis("Nächste Seite hinlegen");
    else if (this.einstellungen().auto) this.hinweis(fortschritt < 1 ? "Ruhig halten …" : "");
    else this.hinweis("Seite erkannt – auslösen");
    if (fortschritt >= 1) this.ausloesen(true);
  }

  // Overlay passend zum Video (object-fit: contain)
  zeichneOverlay(ecken, fortschritt) {
    const box = this.overlay.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (this.overlay.width !== Math.round(box.width * dpr)) { this.overlay.width = Math.round(box.width * dpr); this.overlay.height = Math.round(box.height * dpr); }
    const g = this.overlay.getContext("2d");
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const ring = this.el.querySelector(".fortschritt");
    ring.style.strokeDashoffset = String(289 * (1 - fortschritt));
    if (!ecken) return;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const s = Math.min(this.overlay.width / vw, this.overlay.height / vh);
    const ox = (this.overlay.width - vw * s) / 2, oy = (this.overlay.height - vh * s) / 2;
    g.beginPath();
    ecken.forEach((p, i) => (i ? g.lineTo(ox + p.x * s, oy + p.y * s) : g.moveTo(ox + p.x * s, oy + p.y * s)));
    g.closePath();
    const farbe = this.letzteAufnahme ? "rgba(255,255,255,.7)" : "#3ddc84";
    g.fillStyle = this.letzteAufnahme ? "rgba(255,255,255,.08)" : "rgba(61,220,132,.18)";
    g.fill();
    g.lineWidth = 3 * dpr;
    g.strokeStyle = farbe;
    g.stroke();
    g.fillStyle = farbe;
    for (const p of ecken) { g.beginPath(); g.arc(ox + p.x * s, oy + p.y * s, 6 * dpr, 0, Math.PI * 2); g.fill(); }
  }

  // Aktuelles Kamerabild in voller Auflösung festhalten
  async ausloesen(automatisch) {
    if (this.pause) return;
    this.pause = true;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const roh = document.createElement("canvas");
    roh.width = vw;
    roh.height = vh;
    roh.getContext("2d").drawImage(this.video, 0, 0, vw, vh);
    this.el.classList.add("blitz");
    setTimeout(() => this.el.classList.remove("blitz"), 180);
    navigator.vibrate?.(30);
    // Ecken im festgehaltenen Bild noch einmal genauer suchen (1000 px)
    let ecken = this.aktuelleEcken;
    try {
      const s = 1000 / Math.max(vw, vh);
      const mittel = document.createElement("canvas");
      mittel.width = Math.round(vw * s);
      mittel.height = Math.round(vh * s);
      mittel.getContext("2d").drawImage(roh, 0, 0, mittel.width, mittel.height);
      const genau = findePapier(this.cv, mittel);
      if (genau) ecken = genau.map((p) => ({ x: p.x / s, y: p.y / s }));
    } catch {}
    const erkannt = !!ecken;
    if (!ecken) ecken = [{ x: 0, y: 0 }, { x: vw, y: 0 }, { x: vw, y: vh }, { x: 0, y: vh }];
    this.pruefen({ roh, ecken, erkannt, automatisch });
  }

  // Ergebnis anzeigen: übernehmen, Ecken anpassen oder neu
  pruefen(aufnahme) {
    this.aufnahme = aufnahme;
    const p = this.el.querySelector(".sc-pruefen");
    const bild = entzerren(this.cv, aufnahme.roh, aufnahme.ecken, { scan: this.einstellungen().scan });
    this.ergebnis = bild;
    p.hidden = false;
    p.innerHTML = `<div class="sc-vorschau"></div>
      ${aufnahme.erkannt ? "" : '<p class="sc-warn">Keine Seite erkannt – ganzes Bild übernommen. Mit „Ecken anpassen“ zuschneiden.</p>'}
      <div class="sc-reihe">
        <button class="sc-zweit" data-s="neu">↺ Neu</button>
        <button class="sc-zweit" data-s="ecken">⬚ Ecken anpassen</button>
        <button class="sc-zweit" data-s="modus-pruefen">${this.einstellungen().scan ? "🎨 Farbe" : "📄 Scan"}</button>
      </div>
      <button class="sc-ok" data-s="uebernehmen">✓ Seite übernehmen</button>`;
    bild.className = "sc-ergebnis";
    p.querySelector(".sc-vorschau").append(bild);
    // Automatik: nach 3 s selbst übernehmen, außer man tippt vorher etwas an
    clearInterval(this.countdown);
    if (aufnahme.automatisch && aufnahme.erkannt && !aufnahme.bearbeitet) {
      let rest = 3;
      const k = p.querySelector("[data-s=uebernehmen]");
      k.textContent = `✓ Übernehme in ${rest} …`;
      this.countdown = setInterval(() => {
        rest--;
        if (rest > 0) k.textContent = `✓ Übernehme in ${rest} …`;
        else { clearInterval(this.countdown); if (!k.disabled) { k.disabled = true; this.uebernehmen(); } }
      }, 1000);
    }
  }

  // Ecken per Finger verschieben
  eckenAnpassen() {
    const { roh } = this.aufnahme;
    const ecken = this.aufnahme.ecken.map((p) => ({ ...p }));
    const p = this.el.querySelector(".sc-pruefen");
    p.innerHTML = `<p class="sc-info2">Ecken auf die Blattkanten ziehen</p><div class="sc-edit"><canvas></canvas></div>
      <div class="sc-reihe"><button class="sc-zweit" data-s="ecken-abbrechen">Abbrechen</button><button class="sc-ok" data-s="ecken-ok">✓ Zuschneiden</button></div>`;
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
    const zeichne = () => {
      g.drawImage(roh, 0, 0, c.width, c.height);
      g.fillStyle = "rgba(0,0,0,.35)";
      g.beginPath(); g.rect(0, 0, c.width, c.height);
      ecken.forEach((q, i) => (i ? g.lineTo(q.x * k, q.y * k) : g.moveTo(q.x * k, q.y * k)));
      g.closePath(); g.fill("evenodd");
      g.beginPath(); ecken.forEach((q, i) => (i ? g.lineTo(q.x * k, q.y * k) : g.moveTo(q.x * k, q.y * k))); g.closePath();
      g.lineWidth = 2 * dpr; g.strokeStyle = "#3ddc84"; g.stroke();
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

  async uebernehmen() {
    const blob = await new Promise((r) => this.ergebnis.toBlob(r, "image/jpeg", 0.9));
    this.letzteAufnahme = this.aufnahme.ecken.length ? this.aktuelleEcken || this.aufnahme.ecken : null;
    this.leerZaehler = 0;
    this.verlauf = [];
    this.schliessePruefen();
    await this.onSeite(blob);
    this.zeigeKnoepfe();
  }

  schliessePruefen() {
    const p = this.el.querySelector(".sc-pruefen");
    p.hidden = true;
    p.innerHTML = "";
    this.aufnahme = null;
    this.pause = false;
    clearInterval(this.countdown);
  }

  async aktion(was, knopf) {
    const e = this.einstellungen();
    if (this.aufnahme && was !== "uebernehmen") { clearInterval(this.countdown); this.aufnahme.bearbeitet = true; }
    switch (was) {
      case "ausloesen": return this.ausloesen(false);
      case "auto": e.auto = !e.auto; this.speichereEinstellungen(e); this.verlauf = []; return this.zeigeKnoepfe();
      case "modus": e.scan = !e.scan; this.speichereEinstellungen(e); return this.zeigeKnoepfe();
      case "licht": {
        this.licht = !this.licht;
        try { await this.spur.applyConstraints({ advanced: [{ torch: this.licht }] }); } catch {}
        return knopf.classList.toggle("an", this.licht);
      }
      case "brief": { const ok = this.onNaechsterBrief(); if (ok !== false) { this.letzteAufnahme = null; this.zeigeKnoepfe(); this.hinweis("Neuer Brief – erste Seite"); } return; }
      case "neu": this.letzteAufnahme = null; return this.schliessePruefen();
      case "ecken": return this.eckenAnpassen();
      case "ecken-abbrechen": return this.pruefen(this.aufnahme);
      case "ecken-ok": this.aufnahme.ecken = sortiereEcken(this.eckenEdit); this.aufnahme.erkannt = true; return this.pruefen(this.aufnahme);
      case "modus-pruefen": e.scan = !e.scan; this.speichereEinstellungen(e); this.zeigeKnoepfe(); return this.pruefen(this.aufnahme);
      case "uebernehmen": knopf.disabled = true; return this.uebernehmen();
      case "schliessen": return this.beenden();
    }
  }

  beenden() {
    this.aktiv = false;
    clearInterval(this.countdown);
    try { if (this.licht) this.spur.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.el?.remove();
    document.body.classList.remove("scanner-offen");
    this.onSchliessen?.();
  }
}
