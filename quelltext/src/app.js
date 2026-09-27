// Post-Kamera – fotografiert Briefe direkt in den Filen-Eingang, startet die Verarbeitung
// und zeigt, was daraus geworden ist (Dateien, Fristen, To-dos).
import { FilenSDK } from "@filen/sdk";
import { ladeOpenCV, Scanner } from "./scanner.js";

const VERSION = "1.1";
const WORKFLOW = "post-archiv.yml";
const $ = (s) => document.querySelector(s);
// Nur für automatische Tests: ersetzt Filen und GitHub durch Attrappen. Im normalen Betrieb nicht vorhanden.
const TEST = window.PK_TEST || null;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Speicher auf dem Handy ----------
const speicher = {
  lies(k, std = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : std; } catch { return std; } },
  schreib(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  weg(k) { try { localStorage.removeItem(k); } catch {} },
};
const einst = () => speicher.lies("pk_einstellungen", { ordner: "/Dokumente", github: { repo: "post-archiv" } });
const scanEinst = () => ({ an: true, auto: true, scan: true, ...speicher.lies("pk_scanner", {}) });
const scanEinstSpeichern = (e) => speicher.schreib("pk_scanner", e);

// ---------- Filen ----------
let _sdk = null;
function sdk() {
  if (_sdk) return _sdk;
  const cfg = speicher.lies("pk_filen");
  if (!cfg) throw new Error("Nicht bei Filen angemeldet");
  _sdk = new FilenSDK({ ...cfg, metadataCache: false, connectToSocket: false });
  return _sdk;
}
async function filenAnmelden(email, password, twoFactorCode) {
  if (TEST) { speicher.schreib("pk_filen", { email }); return; }
  const neu = new FilenSDK({ metadataCache: false, connectToSocket: false });
  await neu.login({ email, password, twoFactorCode: twoFactorCode || undefined });
  const c = neu.config;
  // Passwort wird NICHT gespeichert – nur die Sitzungsschlüssel, die Filen nach dem Login liefert
  speicher.schreib("pk_filen", { email: c.email, masterKeys: c.masterKeys, apiKey: c.apiKey, publicKey: c.publicKey, privateKey: c.privateKey, authVersion: c.authVersion, baseFolderUUID: c.baseFolderUUID, userId: c.userId });
  _sdk = null;
}
const pfad = (unter) => `${einst().ordner.replace(/\/+$/, "")}/${unter}`;
let _eingangUuid = null;
async function eingangUuid() {
  if (!_eingangUuid) _eingangUuid = await sdk().fs().mkdir({ path: pfad("Eingang") });
  return _eingangUuid;
}
async function liesJson(p) {
  if (TEST) return TEST.liesJson(p);
  const buf = await sdk().fs().readFile({ path: p });
  return JSON.parse(new TextDecoder().decode(buf));
}
async function hochladen(datei) {
  if (TEST) return TEST.hochladen(datei);
  const item = await sdk().cloud().uploadWebFile({ file: datei, parent: await eingangUuid() });
  return item.uuid;
}

// ---------- GitHub ----------
async function github(weg, opt = {}) {
  if (TEST) return TEST.github(weg, opt);
  const g = einst().github;
  const res = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}${weg}`, {
    ...opt,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${g.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opt.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 422 && /Unexpected inputs/i.test(text)) throw new Error("Die Workflow-Datei im Repo post-archiv ist veraltet – bitte .github/workflows/post-archiv.yml auf Version 3.0 aktualisieren.");
    const hinweis = res.status === 401 ? "Token ungültig oder abgelaufen" : res.status === 403 ? "Token hat keine Berechtigung für Actions" : res.status === 404 ? "Repo oder Workflow nicht gefunden – Benutzername/Repo prüfen" : text.slice(0, 150);
    throw new Error(`GitHub ${res.status}: ${hinweis}`);
  }
  return res.status === 204 ? null : res.json();
}
async function verarbeitungStarten(laufId) {
  const g = einst().github;
  await github(`/actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: g.branch || "main", inputs: { modus: "eingang", lauf_id: laufId } }) });
}
async function laufStatus(seit) {
  const d = await github(`/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`);
  return (d.workflow_runs || []).find((r) => new Date(r.created_at).getTime() >= seit - 60000) || null;
}

// ---------- Bilder ----------
async function verkleinern(datei, max = 3000) {
  const bild = await createImageBitmap(datei, { imageOrientation: "from-image" });
  const f = Math.min(1, max / Math.max(bild.width, bild.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bild.width * f);
  c.height = Math.round(bild.height * f);
  c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
  const t = document.createElement("canvas");
  const tf = 160 / Math.max(c.width, c.height);
  t.width = Math.round(c.width * tf);
  t.height = Math.round(c.height * tf);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  bild.close?.();
  return { blob, vorschau: t.toDataURL("image/jpeg", 0.6) };
}

// ---------- Aufnahme-Sitzung ----------
const neueSitzungsId = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${Math.random().toString(36).slice(2, 6)}`;
};
const sitzung = () => speicher.lies("pk_sitzung");
const sitzungSpeichern = (s) => speicher.schreib("pk_sitzung", s);

let warteschlange = Promise.resolve();
function seiteHochladen(seite, blob) {
  warteschlange = warteschlange.then(async () => {
    const s = sitzung();
    const eintrag = s?.seiten.find((x) => x.name === seite.name);
    if (!eintrag) return;
    try {
      eintrag.status = "laedt";
      sitzungSpeichern(s);
      zeichne();
      eintrag.uuid = await hochladen(new File([blob], seite.name, { type: blob.type || "image/jpeg", lastModified: Date.now() }));
      eintrag.status = "ok";
    } catch (e) {
      eintrag.status = "fehler";
      eintrag.fehler = e.message;
      blobs.set(seite.name, blob); // für "Erneut versuchen"
    }
    const aktuell = sitzung();
    if (aktuell) {
      const x = aktuell.seiten.find((y) => y.name === seite.name);
      if (x) Object.assign(x, { status: eintrag.status, uuid: eintrag.uuid, fehler: eintrag.fehler });
      sitzungSpeichern(aktuell);
    }
    zeichne();
  });
  return warteschlange;
}
const blobs = new Map();

async function fotoAufgenommen(dateien) {
  let s = sitzung();
  if (!s) { s = { id: neueSitzungsId(), brief: 1, seiten: [] }; sitzungSpeichern(s); }
  for (const datei of dateien) {
    if (datei.type === "application/pdf") {
      // PDFs gehen unverändert in den Eingang und werden wie gewohnt verarbeitet
      const name = datei.name.replace(/[^\w.\- äöüÄÖÜß]/g, "_");
      s.seiten.push({ b: s.brief, s: 0, name, status: "wartet", vorschau: null, pdf: true });
      sitzungSpeichern(s);
      zeichne();
      seiteHochladen({ name }, datei);
      continue;
    }
    const nr = s.seiten.filter((x) => x.b === s.brief && !x.pdf).length + 1;
    const name = `Kamera_${s.id}_b${s.brief}_s${nr}.jpg`;
    try {
      const { blob, vorschau } = await verkleinern(datei);
      s = sitzung();
      s.seiten.push({ b: s.brief, s: nr, name, status: "wartet", vorschau });
      sitzungSpeichern(s);
      zeichne();
      seiteHochladen({ name }, blob);
    } catch (e) {
      meldung(`Foto konnte nicht gelesen werden: ${e.message}`);
    }
  }
}

function naechsterBrief() {
  const s = sitzung();
  if (!s) return;
  if (!s.seiten.some((x) => x.b === s.brief)) return meldung("Erst mindestens eine Seite fotografieren.");
  s.brief++;
  sitzungSpeichern(s);
  zeichne();
}

async function seiteLoeschen(name) {
  const s = sitzung();
  const x = s?.seiten.find((y) => y.name === name);
  if (!x || !confirm("Diese Seite löschen?")) return;
  try {
    if (x.uuid) await (TEST ? TEST.papierkorb(x.uuid) : sdk().cloud().trashFile({ uuid: x.uuid }));
  } catch (e) {
    return meldung(`Löschen fehlgeschlagen: ${e.message}`);
  }
  s.seiten = s.seiten.filter((y) => y.name !== name);
  sitzungSpeichern(s);
  zeichne();
}

async function erneutVersuchen() {
  const s = sitzung();
  for (const x of s.seiten.filter((y) => y.status === "fehler")) {
    const blob = blobs.get(x.name);
    if (blob) seiteHochladen({ name: x.name }, blob);
    else meldung(`„${x.name}“ muss neu fotografiert werden (App wurde zwischendurch geschlossen).`);
  }
}

async function abbrechen() {
  const s = sitzung();
  if (!s) return;
  if (s.seiten.length && !confirm(`Aufnahme verwerfen? ${s.seiten.length} hochgeladene Seite(n) kommen in den Filen-Papierkorb.`)) return;
  await warteschlange;
  for (const x of s.seiten) if (x.uuid) await (TEST ? TEST.papierkorb(x.uuid) : sdk().cloud().trashFile({ uuid: x.uuid })).catch(() => {});
  speicher.weg("pk_sitzung");
  ansicht = "start";
  zeichne();
}

async function fertig() {
  const s = sitzung();
  if (!s?.seiten.length) return meldung("Noch keine Seite fotografiert.");
  ansicht = "lauf";
  lauf = { id: s.id, schritt: "hochladen", start: Date.now(), seiten: s.seiten.length, briefe: new Set(s.seiten.map((x) => x.b)).size };
  speicher.schreib("pk_lauf", lauf);
  zeichne();
  await warteschlange;
  if (sitzung().seiten.some((x) => x.status !== "ok")) {
    lauf = null;
    speicher.weg("pk_lauf");
    ansicht = "aufnahme";
    zeichne();
    return meldung("Nicht alle Seiten wurden hochgeladen – bitte „Erneut versuchen“ oder die Seite löschen.");
  }
  try {
    // Abschluss-Markierung: erst jetzt verarbeitet das Skript diese Sitzung
    await hochladen(new File(["fertig"], `Kamera_${s.id}.fertig`, { type: "text/plain" }));
    lauf.schritt = "starten";
    zeichne();
    await verarbeitungStarten(s.id);
    lauf.schritt = "warten";
    lauf.gestartet = Date.now();
    speicher.schreib("pk_lauf", lauf);
    speicher.weg("pk_sitzung");
    zeichne();
    beobachten();
  } catch (e) {
    lauf.schritt = "fehler";
    lauf.fehler = e.message;
    speicher.schreib("pk_lauf", lauf);
    zeichne();
  }
}

// ---------- Verarbeitung beobachten ----------
let lauf = speicher.lies("pk_lauf");
let beobachtet = false;
async function beobachten() {
  if (beobachtet || !lauf) return;
  beobachtet = true;
  let runde = 0;
  while (lauf && lauf.schritt === "warten") {
    runde++;
    try {
      const ergebnis = await liesJson(pfad(`_system/laeufe/${lauf.id}.json`));
      lauf.schritt = "fertig";
      lauf.ergebnis = ergebnis;
      speicher.schreib("pk_lauf", lauf);
      stand = null;
      ladeStand();
      break;
    } catch {
      // noch nicht da
    }
    if (runde % 3 === 1) {
      try {
        const r = await laufStatus(lauf.gestartet || lauf.start);
        if (r) {
          lauf.github = { status: r.status, conclusion: r.conclusion, url: r.html_url };
          if (r.status === "completed" && r.conclusion !== "success" && (lauf.fehlversuche = (lauf.fehlversuche || 0) + 1) >= 2) {
            lauf.schritt = "fehler";
            lauf.fehler = `Die Verarbeitung ist fehlgeschlagen (${r.conclusion}). Details im GitHub-Protokoll.`;
          }
        }
      } catch (e) {
        lauf.github = { status: "unbekannt", fehler: e.message };
      }
    }
    if (Date.now() - (lauf.gestartet || lauf.start) > 25 * 60000) {
      lauf.schritt = "fehler";
      lauf.fehler = "Nach 25 Minuten kam kein Ergebnis. Im GitHub-Protokoll nachsehen – die Fotos liegen sicher im Eingang und werden beim nächsten Lauf verarbeitet.";
    }
    speicher.schreib("pk_lauf", lauf);
    zeichne();
    if (lauf.schritt === "warten") await pause(8000);
  }
  beobachtet = false;
  zeichne();
}

// ---------- Startseite: Stand aus dem Archiv ----------
let stand = null;
let standFehler = null;
async function ladeStand() {
  try {
    stand = await liesJson(pfad("_system/app.json"));
    standFehler = null;
  } catch (e) {
    standFehler = /not found|ENOENT|does not exist/i.test(e.message) ? "Noch keine Daten – nach dem ersten Lauf erscheinen hier deine Fristen." : e.message;
  }
  zeichne();
}

// ---------- Darstellung ----------
let ansicht = speicher.lies("pk_filen") && einst().github?.token ? (speicher.lies("pk_lauf") ? "lauf" : sitzung() ? "aufnahme" : "start") : "einrichtung";
let meldungText = "";
let meldungTimer;
function meldung(t) {
  meldungText = t;
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => { meldungText = ""; zeichne(); }, 6000);
  zeichne();
}

const deDatum = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");
const euro = (b) => (b ? `${b.art}: ${Number(b.wert).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : "");
const tageBis = (iso) => Math.round((new Date(iso + "T12:00:00") - new Date(new Date().toDateString() + " 12:00")) / 86400000);
function fristBadge(f) {
  const t = tageBis(f.datum);
  const dringend = ["zahlung", "einreichen", "termin", "rueckmeldung", "kuendigung"].includes(f.art);
  const klasse = t < 0 ? "rot" : dringend && t <= 7 ? "rot" : dringend ? "gelb" : "grau";
  const wann = t < 0 ? `seit ${-t} Tg. abgelaufen` : t === 0 ? "heute" : t === 1 ? "morgen" : `in ${t} Tg.`;
  return `<span class="badge ${klasse}">${esc(deDatum(f.datum))}${f.berechnet ? " ca." : ""} · ${wann}</span>`;
}

function dokKarte(d) {
  const fristen = (d.fristen || []).map((f) => `<li>${fristBadge(f)} ${esc(f.was)}</li>`).join("");
  return `<article class="karte">
    <div class="kopf"><strong>${esc(d.absender)}</strong><span class="typ">${esc(d.typ)}</span></div>
    <div class="klein">${d.briefdatum ? `Brief vom ${esc(deDatum(d.briefdatum))} · ` : ""}${esc(d.kategorie)}${d.seiten ? ` · ${d.seiten} Seite${d.seiten === 1 ? "" : "n"}` : ""}</div>
    ${d.zusammenfassung ? `<p>${esc(d.zusammenfassung)}</p>` : ""}
    ${d.betrag ? `<div class="betrag">${esc(euro(d.betrag))}</div>` : ""}
    ${fristen ? `<ul class="fristen">${fristen}</ul>` : ""}
    ${d.handlung?.length ? `<div class="todo">⚠️ ${d.handlung.map(esc).join("<br>⚠️ ")}</div>` : `<div class="ok">✓ Nichts zu tun</div>`}
    <div class="datei">📄 ${esc(d.datei)}</div>
  </article>`;
}

function ansichtEinrichtung() {
  const e = einst();
  const angemeldet = !!speicher.lies("pk_filen");
  return `<header><h1>Post-Kamera</h1><p class="klein">Einmalige Einrichtung</p></header>
  <section class="karte">
    <h2>1 · Filen ${angemeldet ? '<span class="badge gruen">angemeldet</span>' : ""}</h2>
    ${angemeldet ? `<p class="klein">Angemeldet als ${esc(speicher.lies("pk_filen").email)}</p><button class="zweit" data-a="filen-ab">Bei Filen abmelden</button>` : `
    <label>E-Mail<input id="f-mail" type="email" autocomplete="username"></label>
    <label>Passwort<input id="f-pw" type="password" autocomplete="current-password"></label>
    <label>2FA-Code (nur falls aktiv)<input id="f-2fa" inputmode="numeric"></label>
    <button data-a="filen-an">Bei Filen anmelden</button>
    <p class="klein">Das Passwort wird nicht gespeichert, nur die Sitzungsschlüssel auf diesem Handy.</p>`}
    <label>Hauptordner in Filen<input id="f-ordner" value="${esc(e.ordner)}"></label>
  </section>
  <section class="karte">
    <h2>2 · GitHub</h2>
    <label>GitHub-Benutzername<input id="g-owner" value="${esc(e.github?.owner || "")}" autocapitalize="off"></label>
    <label>Repository<input id="g-repo" value="${esc(e.github?.repo || "post-archiv")}" autocapitalize="off"></label>
    <label>Zugangs-Token<input id="g-token" type="password" value="${esc(e.github?.token || "")}" placeholder="github_pat_…"></label>
    <p class="klein">Fine-grained Token, nur für dieses Repo, Berechtigung „Actions: Read and write“.</p>
    <button data-a="speichern">Speichern & testen</button>
  </section>
  <section class="karte">
    <h2>3 · Scanner</h2>
    <label class="schalter"><input type="checkbox" id="sc-an" ${scanEinst().an ? "checked" : ""}> Live-Scanner mit Seitenerkennung verwenden</label>
    <label class="schalter"><input type="checkbox" id="sc-auto" ${scanEinst().auto ? "checked" : ""}> Automatisch auslösen, wenn die Seite ruhig liegt</label>
    <label class="schalter"><input type="checkbox" id="sc-scan" ${scanEinst().scan ? "checked" : ""}> Scan-Look (Schatten entfernen, weißes Papier)</label>
    <p class="klein">Beim ersten Öffnen lädt der Scanner einmalig ca. 10 MB. Aus: normale Handy-Kamera.</p>
  </section>
  ${e.github?.token && angemeldet ? `<button class="zweit" data-a="zurueck">Zurück</button>` : ""}
  <p class="klein mitte">Version ${VERSION}</p>`;
}

function ansichtStart() {
  const s = stand;
  const fristen = s?.fristen?.length
    ? `<ul class="liste">${s.fristen.map((f) => `<li class="frist">${fristBadge(f)}<div><strong>${esc(f.was)}</strong><div class="klein">${esc(f.absender)}</div></div></li>`).join("")}</ul>`
    : `<p class="klein">${s ? "Keine offenen Fristen 🎉" : esc(standFehler || "Lädt …")}</p>`;
  const todo = s?.zuErledigen?.length
    ? `<ul class="liste">${s.zuErledigen.map((d) => `<li><span>⚠️</span><div><strong>${esc(d.absender)}</strong> · ${esc(d.typ)}<div class="klein">${d.handlung.map(esc).join("; ")}</div></div></li>`).join("")}</ul>`
    : "";
  return `<header><h1>Post-Kamera</h1><button class="icon" data-a="einrichtung" aria-label="Einstellungen">⚙️</button></header>
  <button class="gross" data-a="kamera">📷<span>Brief fotografieren</span></button>
  <button class="zweit" data-a="datei">📎 Foto oder PDF auswählen</button>
  ${lauf ? `<button class="zweit" data-a="zum-lauf">⏳ Laufende Verarbeitung ansehen</button>` : ""}
  <section><h2>Fristen</h2>${fristen}</section>
  ${todo ? `<section><h2>Zu erledigen</h2>${todo}</section>` : ""}
  ${s?.neueste?.length ? `<section><h2>Zuletzt archiviert</h2>${s.neueste.slice(0, 5).map(dokKarte).join("")}</section>` : ""}
  ${s ? `<p class="klein mitte">${s.anzahl} Dokumente · Stand ${new Date(s.stand).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} <button class="link" data-a="neu-laden">aktualisieren</button></p>` : ""}`;
}

function ansichtAufnahme() {
  const s = sitzung();
  if (!s) { ansicht = "start"; return ansichtStart(); }
  const briefe = [...new Set(s.seiten.map((x) => x.b).concat(s.brief))].sort((a, b) => a - b);
  const offen = s.seiten.filter((x) => x.status === "wartet" || x.status === "laedt").length;
  const fehler = s.seiten.filter((x) => x.status === "fehler").length;
  return `<header><h1>Brief ${s.brief}</h1><span class="klein">${s.seiten.length} Seite${s.seiten.length === 1 ? "" : "n"}${offen ? ` · lädt ${offen} …` : " · alles hochgeladen"}</span></header>
  ${briefe.map((b) => {
    const seiten = s.seiten.filter((x) => x.b === b);
    return `<section class="brief ${b === s.brief ? "aktiv" : ""}"><h2>Brief ${b}${b === s.brief ? " (aktuell)" : ""}</h2>
      <div class="seiten">${seiten.map((x, i) => `<button class="seite ${x.status}" data-a="loeschen" data-name="${esc(x.name)}">
        ${x.vorschau ? `<img src="${x.vorschau}" alt="Seite ${i + 1}">` : `<span class="pdf">PDF</span>`}
        <span class="status">${x.status === "ok" ? "✓" : x.status === "fehler" ? "!" : "…"}</span></button>`).join("") || `<p class="klein">Noch keine Seite</p>`}</div></section>`;
  }).join("")}
  ${fehler ? `<button class="warn" data-a="erneut">${fehler} Upload(s) fehlgeschlagen – erneut versuchen</button>` : ""}
  <div class="aktionen">
    <button class="gross" data-a="kamera">📷<span>${s.seiten.some((x) => x.b === s.brief) ? "Nächste Seite" : "Erste Seite"}</span></button>
    <div class="reihe">
      <button class="zweit" data-a="naechster">➕ Nächster Brief</button>
      <button class="zweit" data-a="datei">📎 Datei</button>
    </div>
    <div class="reihe">
      <button class="zweit" data-a="handykamera">📱 Handy-Kamera</button>
    </div>
    <button class="fertig" data-a="fertig" ${s.seiten.length ? "" : "disabled"}>✅ Fertig – verarbeiten</button>
    <button class="link" data-a="abbrechen">Aufnahme verwerfen</button>
  </div>
  <p class="klein mitte">Tipp: Seite antippen zum Löschen. Mit „Nächster Brief“ trennst du Briefe sicher.</p>`;
}

function ansichtLauf() {
  if (!lauf) { ansicht = "start"; return ansichtStart(); }
  const sek = Math.round((Date.now() - (lauf.gestartet || lauf.start)) / 1000);
  const zeit = `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, "0")}`;
  const schritte = [
    ["hochladen", `Fotos hochladen (${lauf.seiten} Seite${lauf.seiten === 1 ? "" : "n"}, ${lauf.briefe} Brief${lauf.briefe === 1 ? "" : "e"})`],
    ["starten", "Verarbeitung starten"],
    ["warten", `Texterkennung & Auswertung${lauf.schritt === "warten" ? ` · ${zeit}${lauf.github?.status === "queued" ? " · wartet auf GitHub" : lauf.github?.status === "in_progress" ? " · läuft" : ""}` : ""}`],
  ];
  const reihenfolge = ["hochladen", "starten", "warten", "fertig"];
  const jetzt = reihenfolge.indexOf(lauf.schritt === "fehler" ? "warten" : lauf.schritt);
  const liste = schritte.map(([k, t], i) => {
    const zustand = lauf.schritt === "fehler" && i === jetzt ? "✗" : i < jetzt || lauf.schritt === "fertig" ? "✓" : i === jetzt ? '<span class="dreh"></span>' : "○";
    return `<li><span class="punkt">${zustand}</span>${esc(t)}</li>`;
  }).join("");
  let unten = "";
  if (lauf.schritt === "fehler") {
    unten = `<div class="karte fehler"><strong>Das hat nicht geklappt</strong><p>${esc(lauf.fehler)}</p>${lauf.github?.url ? `<a href="${esc(lauf.github.url)}" target="_blank" rel="noopener">GitHub-Protokoll öffnen</a>` : ""}</div>
      <button data-a="erneut-starten">Verarbeitung erneut starten</button><button class="zweit" data-a="lauf-schliessen">Schließen</button>`;
  } else if (lauf.schritt === "fertig") {
    const e = lauf.ergebnis;
    const n = e.neu?.length || 0;
    const mitFrist = (e.neu || []).filter((d) => d.fristen?.length || d.handlung?.length).length;
    unten = `<div class="zusammen"><strong>${n ? `${n} Dokument${n === 1 ? "" : "e"} archiviert` : "Keine neuen Dokumente"}</strong>${n ? `<span>${mitFrist ? `${mitFrist}× Fristen oder To-dos` : "nichts zu tun"}</span>` : ""}</div>
      ${e.hinweis ? `<p class="klein">${esc(e.hinweis)}</p>` : ""}
      ${(e.neu || []).map(dokKarte).join("")}
      ${e.fehler?.length ? `<div class="karte fehler"><strong>Nicht verarbeitet</strong><ul>${e.fehler.map((f) => `<li>${esc(f.name)}: ${esc(f.grund)}</li>`).join("")}</ul><p class="klein">Liegt im Ordner _Fehler.</p></div>` : ""}
      <button class="gross klein-gross" data-a="kamera-neu">📷<span>Weiteren Brief fotografieren</span></button>
      <button class="zweit" data-a="lauf-schliessen">Zur Übersicht</button>`;
  } else {
    unten = `<p class="klein">Du kannst die App schließen – die Verarbeitung läuft weiter, das Ergebnis erscheint beim nächsten Öffnen.</p>`;
  }
  return `<header><h1>${lauf.schritt === "fertig" ? "Erledigt" : lauf.schritt === "fehler" ? "Problem" : "Wird verarbeitet …"}</h1></header>
  <ol class="schritte">${liste}</ol>${unten}`;
}

function zeichne() {
  const inhalt = { einrichtung: ansichtEinrichtung, start: ansichtStart, aufnahme: ansichtAufnahme, lauf: ansichtLauf }[ansicht]();
  $("#app").innerHTML = inhalt + (meldungText ? `<div class="meldung" role="status">${esc(meldungText)}</div>` : "");
}

// ---------- Aktionen ----------
const kameraInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment", hidden: true });
const dateiInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*,application/pdf", multiple: true, hidden: true });
document.body.append(kameraInput, dateiInput);
for (const inp of [kameraInput, dateiInput]) {
  inp.addEventListener("change", async () => {
    const dateien = [...inp.files];
    inp.value = "";
    if (!dateien.length) return;
    ansicht = "aufnahme";
    await fotoAufgenommen(dateien);
    zeichne();
  });
}

// ---------- Scanner ----------
let scanner = null;
async function kameraOeffnen() {
  if (!scanEinst().an || !navigator.mediaDevices?.getUserMedia) return kameraInput.click();
  if (scanner) return;
  meldung("Scanner wird geladen …");
  try {
    const { cv } = await ladeOpenCV();
    scanner = new Scanner({
      cv,
      einstellungen: scanEinst,
      speichereEinstellungen: scanEinstSpeichern,
      status: () => { const s = sitzung(); return { brief: s?.brief || 1, seitenImBrief: s ? s.seiten.filter((x) => x.b === s.brief).length : 0 }; },
      onSeite: async (blob) => { ansicht = "aufnahme"; await fotoAufgenommen([new File([blob], "scan.jpg", { type: "image/jpeg", lastModified: Date.now() })]); },
      onNaechsterBrief: () => { const s = sitzung(); if (!s || !s.seiten.some((x) => x.b === s.brief)) { scanner.hinweis("Erst eine Seite aufnehmen"); return false; } naechsterBrief(); return true; },
      onSchliessen: () => { scanner = null; if (sitzung()) ansicht = "aufnahme"; zeichne(); },
    });
    meldungText = "";
    await scanner.starten();
  } catch (e) {
    scanner?.beenden();
    scanner = null;
    const grund = /Permission|NotAllowed/i.test(e.name + e.message) ? "Kamera-Zugriff wurde nicht erlaubt" : e.message;
    meldung(`Scanner nicht verfügbar (${grund}) – normale Kamera wird geöffnet.`);
    kameraInput.click();
  }
}
// Scanner-Bibliothek im Hintergrund vorladen, damit der erste Start schnell geht (nicht im Datensparmodus)
function vorladen() {
  if (!scanEinst().an || navigator.connection?.saveData) return;
  const los = () => fetch("opencv.js").catch(() => {});
  "requestIdleCallback" in window ? requestIdleCallback(los, { timeout: 5000 }) : setTimeout(los, 3000);
}

const aktionen = {
  kamera: () => kameraOeffnen(),
  handykamera: () => kameraInput.click(),
  "kamera-neu": () => { lauf = null; speicher.weg("pk_lauf"); kameraOeffnen(); },
  datei: () => dateiInput.click(),
  naechster: naechsterBrief,
  loeschen: (el) => seiteLoeschen(el.dataset.name),
  erneut: erneutVersuchen,
  abbrechen,
  fertig,
  einrichtung: () => { ansicht = "einrichtung"; zeichne(); },
  zurueck: () => { ansicht = "start"; zeichne(); ladeStand(); },
  "neu-laden": ladeStand,
  "zum-lauf": () => { ansicht = "lauf"; zeichne(); beobachten(); },
  "lauf-schliessen": () => { lauf = null; speicher.weg("pk_lauf"); ansicht = "start"; zeichne(); ladeStand(); },
  "erneut-starten": async () => {
    try {
      lauf.schritt = "starten"; lauf.fehler = null; lauf.fehlversuche = 0; zeichne();
      await verarbeitungStarten(lauf.id);
      lauf.schritt = "warten"; lauf.gestartet = Date.now(); speicher.schreib("pk_lauf", lauf); zeichne(); beobachten();
    } catch (e) { lauf.schritt = "fehler"; lauf.fehler = e.message; zeichne(); }
  },
  "filen-an": async (el) => {
    el.disabled = true; el.textContent = "Melde an …";
    try {
      await filenAnmelden($("#f-mail").value.trim(), $("#f-pw").value, $("#f-2fa").value.trim());
      meldung("Bei Filen angemeldet ✓");
    } catch (e) {
      meldung(`Filen-Anmeldung fehlgeschlagen: ${e.message}`);
    }
    zeichne();
  },
  "filen-ab": () => { if (confirm("Bei Filen abmelden?")) { speicher.weg("pk_filen"); _sdk = null; zeichne(); } },
  speichern: async (el) => {
    const e = einst();
    e.ordner = $("#f-ordner").value.trim() || "/Dokumente";
    if (!e.ordner.startsWith("/")) e.ordner = "/" + e.ordner;
    scanEinstSpeichern({ ...scanEinst(), an: $("#sc-an").checked, auto: $("#sc-auto").checked, scan: $("#sc-scan").checked });
    e.github = { owner: $("#g-owner").value.trim(), repo: $("#g-repo").value.trim() || "post-archiv", token: $("#g-token").value.trim() };
    speicher.schreib("pk_einstellungen", e);
    _eingangUuid = null;
    el.disabled = true; el.textContent = "Teste …";
    const probleme = [];
    try {
      const repo = await github("");
      e.github.branch = repo.default_branch || "main";
      speicher.schreib("pk_einstellungen", e);
      await github(`/actions/workflows/${WORKFLOW}`);
    } catch (x) { probleme.push(x.message); }
    if (!speicher.lies("pk_filen")) probleme.push("Filen: noch nicht angemeldet");
    else {
      try { if (!TEST) await sdk().fs().readdir({ path: e.ordner }); } catch (x) { probleme.push(`Filen-Ordner ${e.ordner}: ${x.message}`); }
    }
    if (probleme.length) { meldung(probleme.join(" · ")); zeichne(); return; }
    meldung("Alles eingerichtet ✓");
    ansicht = "start";
    zeichne();
    ladeStand();
  },
};
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-a]");
  if (!el || el.disabled) return;
  const f = aktionen[el.dataset.a];
  if (f) f(el);
});

// ---------- Start ----------
zeichne();
if (ansicht !== "einrichtung") ladeStand();
if (lauf?.schritt === "warten") beobachten();
setInterval(() => { if (ansicht === "lauf" && lauf?.schritt === "warten") zeichne(); }, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && ansicht === "start") ladeStand(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(vorladen, () => {});
