// Post-Kamera – fotografiert Briefe direkt in den Filen-Eingang, startet die Verarbeitung
// und zeigt, was daraus geworden ist (Dateien, Fristen, To-dos).
import { FilenSDK } from "@filen/sdk";
import { ladeOpenCV, fotoZuschneiden } from "./scanner.js";

const VERSION = "2.4";
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
const scanEinst = () => ({ an: true, zuschneiden: true, scan: true, ...speicher.lies("pk_scanner", {}) });
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
async function hochladen(datei, onProgress, ziel = null) {
  if (TEST) return TEST.hochladen(datei, onProgress);
  const abbruch = new AbortController();
  // Zeitlimit: 60 s + 30 s pro MB, ohne Fortschritt – eine hängende Verbindung blockiert sonst die ganze Warteschlange
  const limit = 60000 + (datei.size / 1048576) * 30000;
  let uebertragen = 0;
  let timer;
  const wache = () => { clearTimeout(timer); timer = setTimeout(() => abbruch.abort(), limit); };
  wache();
  try {
    const parent = ziel || (await eingangUuid());
    const item = await Promise.race([
      sdk().cloud().uploadWebFile({
        file: datei, parent, abortSignal: abbruch.signal,
        onProgress: (n) => { uebertragen += n; wache(); onProgress?.(Math.min(1, uebertragen / datei.size)); },
      }),
      new Promise((_, rej) => abbruch.signal.addEventListener("abort", () => rej(new Error("Zeitüberschreitung beim Hochladen")))),
    ]);
    return item.uuid;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Zwischenspeicher für noch nicht hochgeladene Seiten (übersteht Schließen der App) ----------
const ablage = (() => {
  let db;
  const oeffnen = () => db || (db = new Promise((r, j) => {
    const q = indexedDB.open("mailcam", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("seiten");
    q.onsuccess = () => r(q.result);
    q.onerror = () => j(q.error);
  }));
  const tx = async (modus, f) => { const d = await oeffnen(); return new Promise((r, j) => { const t = d.transaction("seiten", modus); const q = f(t.objectStore("seiten")); t.oncomplete = () => r(q?.result); t.onerror = () => j(t.error); }); };
  return {
    put: (k, blob) => tx("readwrite", (st) => st.put(blob, k)).catch(() => {}),
    get: (k) => tx("readonly", (st) => st.get(k)).catch(() => null),
    del: (k) => tx("readwrite", (st) => st.delete(k)).catch(() => {}),
  };
})();

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
const fortschritt = new Map(); // Seitenname -> 0..1
function eintragSetzen(name, felder) {
  const s = sitzung();
  const x = s?.seiten.find((y) => y.name === name);
  if (!x) return false;
  Object.assign(x, felder);
  sitzungSpeichern(s);
  return true;
}
function seiteHochladen(seite, blob) {
  ablage.put(seite.name, blob);
  warteschlange = warteschlange.then(async () => {
    if (!sitzung()?.seiten.some((y) => y.name === seite.name)) { ablage.del(seite.name); return; }
    let letzterFehler;
    for (let versuch = 1; versuch <= 3; versuch++) {
      eintragSetzen(seite.name, { status: "laedt", versuch });
      fortschritt.set(seite.name, 0);
      zeichne();
      try {
        const datei = new File([blob], seite.name, { type: blob.type || "image/jpeg", lastModified: Date.now() });
        const uuid = await hochladen(datei, (p) => { fortschritt.set(seite.name, p); zeichneStatus(); });
        eintragSetzen(seite.name, { status: "ok", uuid, fehler: null });
        fortschritt.delete(seite.name);
        ablage.del(seite.name);
        zeichne();
        return;
      } catch (e) {
        letzterFehler = e;
        if (versuch < 3) await pause(versuch * 3000);
      }
    }
    eintragSetzen(seite.name, { status: "fehler", fehler: letzterFehler?.message || "Upload fehlgeschlagen" });
    fortschritt.delete(seite.name);
    zeichne();
  });
  return warteschlange;
}
// Nach dem Öffnen der App: unterbrochene Uploads aus dem Zwischenspeicher fortsetzen
async function uploadsFortsetzen() {
  const s = sitzung();
  if (!s) return;
  for (const x of s.seiten.filter((y) => y.status !== "ok")) {
    const blob = await ablage.get(x.name);
    if (blob) seiteHochladen({ name: x.name }, blob);
    else eintragSetzen(x.name, { status: "fehler", fehler: "Foto nicht mehr vorhanden – bitte Seite antippen, löschen und neu fotografieren" });
  }
  zeichne();
}
// Nur die Statuszeile aktualisieren (Fortschritt), ohne die Seite neu aufzubauen
function zeichneStatus() {
  document.querySelectorAll("[data-upload-status]").forEach((el) => (el.textContent = uploadText()));
}
function uploadText() {
  const s = sitzung();
  if (!s) return "";
  const offen = s.seiten.filter((x) => x.status === "wartet" || x.status === "laedt");
  const laufend = s.seiten.find((x) => x.status === "laedt");
  if (!offen.length) return s.seiten.some((x) => x.status === "fehler") ? "Upload-Problem" : "alles hochgeladen";
  const p = laufend ? Math.round((fortschritt.get(laufend.name) || 0) * 100) : 0;
  return `lädt ${offen.length} …${laufend ? ` (${p} %${laufend.versuch > 1 ? `, Versuch ${laufend.versuch}` : ""})` : ""}`;
}

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
  ablage.del(name);
  zeichne();
}

async function erneutVersuchen() {
  const s = sitzung();
  for (const x of s.seiten.filter((y) => y.status === "fehler")) {
    const blob = await ablage.get(x.name);
    if (blob) seiteHochladen({ name: x.name }, blob);
    else meldung(`„${x.name}“ muss neu fotografiert werden.`);
  }
}

async function abbrechen() {
  const s = sitzung();
  if (!s) return;
  if (s.seiten.length && !confirm(`Aufnahme verwerfen? Bereits hochgeladene Seiten kommen in den Filen-Papierkorb.`)) return;
  for (const x of s.seiten) ablage.del(x.name);
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
  const meinLauf = lauf;
  await warteschlange;
  if (lauf !== meinLauf) return; // inzwischen abgebrochen
  if (!sitzung() || sitzung().seiten.some((x) => x.status !== "ok")) {
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
if (/[?&]reset\b/.test(location.search)) {
  speicher.weg("pk_lauf");
  speicher.weg("pk_sitzung");
  history.replaceState(null, "", location.pathname);
}
let lauf = speicher.lies("pk_lauf");
// Ein gespeicherter Lauf im Schritt "hochladen"/"starten" ist nach einem Neustart verwaist (dieser Teil läuft nur in der offenen App):
// zurück zur Aufnahme, die Uploads laufen dort aus dem Zwischenspeicher weiter.
if (lauf && ["hochladen", "starten"].includes(lauf.schritt)) { lauf = null; speicher.weg("pk_lauf"); }
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
  erledigtAbgleichen();
  zeichne();
}

// ---------- „Zu erledigen“ abhaken ----------
// Pro Klick eine kleine Datei in _system/erledigt (<Zeit>_<ID>_<1|0>.json). Das Post-Archiv übernimmt sie beim
// nächsten Lauf in den Index (Übersicht.md, Dokumente-Index, Erinnerungen). Bis dahin merkt sich die App den Klick selbst.
const erledigtLokal = () => speicher.lies("pk_erledigt", {});
let erledigtAuf = false; // Liste „Erledigt“ aufgeklappt?
let erledigtFremd = {}; // Klicks von anderen Geräten, die der Workflow noch nicht übernommen hat
const KLICK = /^(\d{10,})_([0-9a-f]{6,64})_([01])\.json$/;
async function erledigtAbgleichen() {
  // Lokale Klicks vergessen, sobald der Workflow sie in app.json übernommen hat (neuerer Stand)
  if (stand?.stand) {
    const t = new Date(stand.stand).getTime();
    const l = erledigtLokal();
    for (const [id, k] of Object.entries(l)) if (k.zeit < t && k.gesendet) delete l[id];
    speicher.schreib("pk_erledigt", l);
  }
  try {
    const namen = TEST ? (TEST.erledigtListe?.() || []) : await sdk().fs().readdir({ path: pfad("_system/erledigt") });
    const neu = {};
    for (const n of namen) {
      const m = KLICK.exec(n);
      if (!m) continue;
      const k = { zeit: Number(m[1]), erledigt: m[3] === "1", name: n };
      if (!neu[m[2]] || neu[m[2]].zeit < k.zeit) neu[m[2]] = k;
    }
    erledigtFremd = neu;
    zeichne();
  } catch { /* Ordner gibt es noch nicht */ }
}
// Gültiger Zustand je Dokument: der jüngste Klick (lokal oder von einem anderen Gerät)
function klickFuer(id) {
  const a = erledigtLokal()[id], b = erledigtFremd[id];
  if (a && b) return a.zeit >= b.zeit ? a : b;
  return a || b || null;
}
function todoListen() {
  const s = stand || {};
  const offen = [], erledigt = [];
  const gesehen = new Set();
  const alle = [...(s.zuErledigen || []).map((d) => [d, false]), ...(s.erledigt || []).map((d) => [d, true])];
  for (const [id, k] of Object.entries(erledigtLokal())) if (k.eintrag) alle.push([k.eintrag, !k.erledigt]);
  for (const [d, warErledigt] of alle) {
    const key = d.id || d.datei;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    const k = d.id ? klickFuer(d.id) : null;
    const istErledigt = k ? k.erledigt : warErledigt;
    (istErledigt ? erledigt : offen).push(d);
  }
  return { offen, erledigt: erledigt.slice(0, 10), alleErledigt: erledigt };
}
// Der Stand stammt von einem älteren Post-Archiv (To-dos ohne Dokument-ID): kurzen Prüflauf starten, der ihn neu schreibt
let erneuertSeit = 0;
async function standErneuern() {
  if (Date.now() - erneuertSeit < 180000) return meldung("Die Liste wird gerade aktualisiert – in 1–2 Minuten geht das Abhaken.");
  try {
    const g = einst().github;
    await github(`/actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: g.branch || "main", inputs: { modus: "eingang" } }) });
    erneuertSeit = Date.now();
    meldung("Die Liste wird einmalig aktualisiert (Post-Archiv ab v3.2 nötig) – in 1–2 Minuten geht das Abhaken.");
    for (const t of [70000, 110000, 160000]) setTimeout(ladeStand, t);
  } catch (e) {
    meldung(`Liste konnte nicht aktualisiert werden: ${e.message}`);
  }
}
async function erledigtSetzen(el, wert) {
  const id = el.dataset.id;
  if (!id) return standErneuern();
  const { offen, erledigt } = todoListen();
  const eintrag = [...offen, ...erledigt].find((d) => d.id === id);
  const zeit = Date.now();
  const l = erledigtLokal();
  l[id] = { zeit, erledigt: wert, eintrag, gesendet: false };
  speicher.schreib("pk_erledigt", l);
  zeichne();
  meldung(wert ? "✓ Erledigt – rückgängig unter „Erledigt“" : "Wieder offen");
  try {
    const name = `${zeit}_${id}_${wert ? 1 : 0}.json`;
    const inhalt = JSON.stringify({ id, erledigt: wert, zeit: new Date(zeit).toISOString(), absender: eintrag?.absender, typ: eintrag?.typ, handlung: eintrag?.handlung, datei: eintrag?.datei });
    const ordner = TEST ? null : await sdk().fs().mkdir({ path: pfad("_system/erledigt") });
    await hochladen(new File([inhalt], name, { type: "application/json" }), null, ordner);
    const l2 = erledigtLokal();
    if (l2[id]?.zeit === zeit) { l2[id].gesendet = true; speicher.schreib("pk_erledigt", l2); }
  } catch (e) {
    const l2 = erledigtLokal();
    if (l2[id]?.zeit === zeit) { delete l2[id]; speicher.schreib("pk_erledigt", l2); }
    zeichne();
    meldung(`Konnte nicht speichern (${e.message}) – bitte noch einmal tippen.`);
  }
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

// Kompakte Karte für „Zuletzt archiviert“: eine Zeile Absender/Typ, eine Zeile Datum · Kategorie · Betrag; antippen klappt Details auf
function dokKlein(d) {
  const info = [d.typ, d.briefdatum ? deDatum(d.briefdatum) : "", d.kategorie, d.betrag ? `${Number(d.betrag.wert).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : ""].filter(Boolean).map(esc).join(" · ");
  const mehr = [d.zusammenfassung ? `<p>${esc(d.zusammenfassung)}</p>` : "", `<div class="datei">📄 ${esc(d.datei)}</div>`].join("");
  return `<li class="dok-klein"><details><summary><div class="dk-kopf"><strong>${esc(d.absender)}</strong></div><div class="klein">${info}</div></summary>${mehr}</details></li>`;
}

// ---------- Installieren (eigenes Fenster statt Browser-Tab) ----------
// Chrome/Edge/Samsung feuern „beforeinstallprompt“ oft schon vor dem Zeichnen der Einstellungen – daher global abfangen
let installEvent = null;
window.addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); installEvent = ev; if (ansicht === "einrichtung") zeichne(); });
window.addEventListener("appinstalled", () => { installEvent = null; meldung("Installiert ✓ – ab jetzt über das Symbol auf dem Startbildschirm öffnen."); });
const istInstalliert = () => window.matchMedia?.("(display-mode: standalone)").matches || window.matchMedia?.("(display-mode: fullscreen)").matches || navigator.standalone === true;
function installBereich() {
  if (istInstalliert()) return `<p class="ok">✓ Läuft als installierte App im eigenen Fenster.</p>`;
  if (location.protocol === "file:") return `<p class="klein">Als lokale Datei geöffnet – installieren geht nur über die Web-Adresse (GitHub Pages).</p>`;
  if (installEvent) return `<p class="klein">Läuft dann im eigenen Fenster statt als Browser-Tab – kein versehentliches Schließen durch Tab-Aufräumen.</p><button data-a="installieren">📲 App installieren</button>`;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return `<p class="klein">In Safari unten auf <strong>Teilen</strong> (□↑) tippen → <strong>Zum Home-Bildschirm</strong> → <strong>Hinzufügen</strong>.</p>`;
  if (/Firefox|FxiOS/.test(ua)) return `<p class="klein">Im Firefox-Menü (⋮) <strong>Installieren</strong> bzw. <strong>Zum Startbildschirm hinzufügen</strong> wählen. Noch besser läuft die App, wenn du sie in Chrome öffnest und dort installierst.</p>`;
  return `<p class="klein">Im Browser-Menü (⋮) <strong>App installieren</strong> bzw. <strong>Zum Startbildschirm hinzufügen</strong> wählen. Ist sie schon installiert, öffne sie über das Symbol auf dem Startbildschirm.</p>`;
}
async function installieren() {
  if (!installEvent) return zeichne();
  const ev = installEvent;
  installEvent = null;
  ev.prompt();
  try {
    const { outcome } = await ev.userChoice;
    meldung(outcome === "accepted" ? "Wird installiert …" : "Installation abgebrochen – geht jederzeit über das Browser-Menü.");
  } catch { /* ignorieren */ }
  zeichne();
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
    <h2>3 · Kamera</h2>
    <label class="schalter"><input type="checkbox" id="sc-zu" ${scanEinst().zuschneiden ? "checked" : ""}> Blatt im Foto erkennen und automatisch zuschneiden</label>
    <label class="schalter"><input type="checkbox" id="sc-scan" ${scanEinst().scan ? "checked" : ""}> Scan-Look (Schatten entfernen, weißes Papier)</label>
    <p class="klein">Das Zuschneiden lädt beim ersten Mal einmalig ca. 10 MB.</p>
  </section>
  <section class="karte">
    <h2>4 · Als App installieren</h2>
    ${installBereich()}
  </section>
  ${e.github?.token && angemeldet ? `<button class="zweit" data-a="zurueck">Zurück</button>` : ""}
  <p class="klein mitte">Version ${VERSION}</p>`;
}

function ansichtStart() {
  const s = stand;
  // Fristen von abgehakten Dokumenten ausblenden (sofort, auch bevor das Post-Archiv den Haken übernommen hat)
  const { alleErledigt: fertig } = todoListen();
  const fertigIds = new Set(fertig.map((d) => d.id).filter(Boolean)), fertigDateien = new Set(fertig.map((d) => d.datei));
  const offeneFr = (s?.fristen || []).filter((f) => !(f.id ? fertigIds.has(f.id) || klickFuer(f.id)?.erledigt : fertigDateien.has(f.datei)));
  const fristen = offeneFr.length
    ? `<ul class="liste">${offeneFr.map((f) => `<li class="frist">${fristBadge(f)}<div><strong>${esc(f.was)}</strong><div class="klein">${esc(f.absender)}</div></div></li>`).join("")}</ul>`
    : `<p class="klein">${s ? "Keine offenen Fristen 🎉" : esc(standFehler || "Lädt …")}</p>`;
  const { offen, erledigt } = todoListen();
  const todoZeile = (d, fertig) => `<li class="todo-zeile${fertig ? " fertig" : ""}"><div><strong>${esc(d.absender)}</strong> · ${esc(d.typ)}<div class="klein">${(d.handlung || []).map(esc).join("; ")}</div></div><button class="haken" data-a="${fertig ? "wieder-offen" : "erledigt"}" data-id="${esc(d.id || "")}" aria-label="${fertig ? "Wieder öffnen" : "Als erledigt markieren"}">${fertig ? "↩︎" : ""}</button></li>`;
  const todo = offen.length ? `<ul class="liste">${offen.map((d) => todoZeile(d, false)).join("")}</ul>` : erledigt.length ? `<p class="klein">Alles erledigt 🎉</p>` : "";
  const fertigListe = erledigt.length ? `<details class="erledigt"${erledigtAuf ? " open" : ""}><summary>Erledigt (${erledigt.length})</summary><ul class="liste">${erledigt.map((d) => todoZeile(d, true)).join("")}</ul></details>` : "";
  return `<header><h1>Post-Kamera</h1><button class="icon" data-a="einrichtung" aria-label="Einstellungen">⚙️</button></header>
  <button class="gross" data-a="kamera">📷<span>Brief fotografieren</span></button>
  <button class="zweit" data-a="datei">📎 Foto oder PDF auswählen</button>
  ${lauf ? `<button class="zweit" data-a="zum-lauf">⏳ Laufende Verarbeitung ansehen</button>` : ""}
  ${s?.kiFehler ? `<p class="hinweis">${s.kiFehler === "guthaben" ? "🤖 KI-Guthaben aufgebraucht – Briefe werden ohne KI ausgewertet (einfachere Zusammenfassung). Guthaben unter console.anthropic.com aufladen." : `🤖 KI beim letzten Lauf nicht erreichbar – ausgewertet ohne KI. (${esc(s.kiFehler)})`}</p>` : ""}
  <section><h2>Fristen</h2>${fristen}</section>
  ${todo || fertigListe ? `<section><h2>Zu erledigen</h2>${todo}${fertigListe}</section>` : ""}
  ${s?.neueste?.length ? `<section><h2>Zuletzt archiviert</h2><ul class="liste">${s.neueste.slice(0, 8).map(dokKlein).join("")}</ul></section>` : ""}
  ${s ? `<p class="klein mitte">${s.anzahl} Dokumente · Stand ${new Date(s.stand).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} <button class="link" data-a="neu-laden">aktualisieren</button></p>` : ""}`;
}

function ansichtAufnahme() {
  const s = sitzung();
  if (!s) return ansichtStart(); // (noch) keine Aufnahme – Startseite zeigen, Ansicht aber nicht umstellen
  const briefe = [...new Set(s.seiten.map((x) => x.b).concat(s.brief))].sort((a, b) => a - b);
  const fehler = s.seiten.filter((x) => x.status === "fehler").length;
  return `<header><h1>Brief ${s.brief}</h1><span class="klein">${s.seiten.length} Seite${s.seiten.length === 1 ? "" : "n"} · <span data-upload-status>${esc(uploadText())}</span></span></header>
  ${briefe.map((b) => {
    const seiten = s.seiten.filter((x) => x.b === b);
    return `<section class="brief ${b === s.brief ? "aktiv" : ""}"><h2>Brief ${b}${b === s.brief ? " (aktuell)" : ""}</h2>
      <div class="seiten">${seiten.map((x, i) => `<button class="seite ${x.status}" data-a="loeschen" data-name="${esc(x.name)}">
        ${x.vorschau ? `<img src="${x.vorschau}" alt="Seite ${i + 1}">` : `<span class="pdf">PDF</span>`}
        <span class="status">${x.status === "ok" ? "✓" : x.status === "fehler" ? "!" : "…"}</span></button>`).join("") || `<p class="klein">Noch keine Seite</p>`}</div></section>`;
  }).join("")}
  ${fehler ? `<button class="warn" data-a="erneut">${fehler} Upload(s) fehlgeschlagen – erneut versuchen</button><p class="klein">${esc(s.seiten.find((x) => x.status === "fehler")?.fehler || "")}</p>` : ""}
  <div class="aktionen">
    <button class="gross" data-a="kamera">📷<span>${s.seiten.some((x) => x.b === s.brief) ? "Nächste Seite" : "Erste Seite"}</span></button>
    <div class="reihe">
      <button class="zweit" data-a="naechster">➕ Nächster Brief</button>
      <button class="zweit" data-a="datei">📎 Datei</button>
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
  } else if (lauf.schritt === "hochladen") {
    unten = `<div class="karte"><strong data-upload-status>${esc(uploadText())}</strong><p class="klein">Bitte die App offen lassen, bis alle Fotos oben sind. Wird sie geschlossen, geht es beim nächsten Öffnen weiter.</p></div>
      <button class="zweit" data-a="lauf-abbrechen">Abbrechen – zurück zur Aufnahme</button>`;
  } else {
    unten = `<p class="klein">Du kannst die App schließen – die Verarbeitung läuft weiter, das Ergebnis erscheint beim nächsten Öffnen.</p>
      ${lauf.github?.url ? `<a class="klein" href="${esc(lauf.github.url)}" target="_blank" rel="noopener">GitHub-Protokoll öffnen</a>` : ""}
      <button class="zweit" data-a="lauf-schliessen">Nicht warten – zur Übersicht</button>`;
  }
  return `<header><h1>${lauf.schritt === "fertig" ? "Erledigt" : lauf.schritt === "fehler" ? "Problem" : "Wird verarbeitet …"}</h1></header>
  <ol class="schritte">${liste}</ol>${unten}<p class="klein mitte">MailCam ${VERSION}</p>`;
}

function zeichne() {
  const inhalt = { einrichtung: ansichtEinrichtung, start: ansichtStart, aufnahme: ansichtAufnahme, lauf: ansichtLauf }[ansicht]();
  $("#app").innerHTML = inhalt + (meldungText ? `<div class="meldung" role="status">${esc(meldungText)}</div>` : "");
}

// ---------- Aktionen ----------
const kameraInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
kameraInput.setAttribute("capture", "environment"); // öffnet direkt die Rückkamera statt der Dateiauswahl
const dateiInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*,application/pdf", multiple: true, hidden: true });
document.body.append(kameraInput, dateiInput);
for (const inp of [kameraInput, dateiInput]) {
  inp.addEventListener("change", async () => {
    const dateien = [...inp.files];
    inp.value = "";
    if (!dateien.length) return;
    ansicht = "aufnahme";
    zeichne();
    // Fotos zuschneiden (PDFs bleiben unverändert)
    if (scanEinst().zuschneiden && dateien.some((d) => d.type.startsWith("image/"))) {
      let cv = null;
      try { ({ cv } = await ladeOpenCV()); } catch (e) { meldung(`Zuschneiden nicht verfügbar (${e.message}) – Foto wird unverändert übernommen.`); }
      for (const d of dateien) {
        if (!cv || !d.type.startsWith("image/")) { await fotoAufgenommen([d]); continue; }
        try {
          const r = await fotoZuschneiden({ cv, datei: d, einstellungen: scanEinst, speichereEinstellungen: scanEinstSpeichern });
          if (r?.blob) await fotoAufgenommen([new File([r.blob], "scan.jpg", { type: "image/jpeg", lastModified: Date.now() })]);
        } catch (e) {
          meldung(`Zuschneiden fehlgeschlagen (${e.message}) – Foto wird unverändert übernommen.`);
          await fotoAufgenommen([d]);
        }
        zeichne();
      }
    } else {
      await fotoAufgenommen(dateien);
    }
    zeichne();
  });
}

// Scanner-Bibliothek im Hintergrund vorladen, damit der erste Start schnell geht (nicht im Datensparmodus)
function vorladen() {
  if (!scanEinst().zuschneiden || navigator.connection?.saveData) return;
  const los = () => fetch("opencv.js").catch(() => {});
  "requestIdleCallback" in window ? requestIdleCallback(los, { timeout: 5000 }) : setTimeout(los, 3000);
}

const aktionen = {
  kamera: () => kameraInput.click(),
  "kamera-neu": () => { lauf = null; speicher.weg("pk_lauf"); kameraInput.click(); },
  datei: () => dateiInput.click(),
  naechster: naechsterBrief,
  loeschen: (el) => seiteLoeschen(el.dataset.name),
  erneut: erneutVersuchen,
  abbrechen,
  fertig,
  einrichtung: () => { ansicht = "einrichtung"; zeichne(); },
  zurueck: () => { ansicht = "start"; zeichne(); ladeStand(); },
  "neu-laden": ladeStand,
  installieren,
  erledigt: (el) => erledigtSetzen(el, true),
  "wieder-offen": (el) => erledigtSetzen(el, false),
  "zum-lauf": () => { ansicht = "lauf"; zeichne(); beobachten(); },
  "lauf-abbrechen": () => { lauf = null; speicher.weg("pk_lauf"); ansicht = sitzung() ? "aufnahme" : "start"; zeichne(); meldung("Abgebrochen. Du kannst Seiten löschen, neu versuchen oder die Aufnahme verwerfen."); },
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
    scanEinstSpeichern({ ...scanEinst(), zuschneiden: $("#sc-zu").checked, scan: $("#sc-scan").checked });
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
// Kamera-Schalter sofort speichern (unabhängig von „Speichern & testen“)
document.addEventListener("change", (ev) => {
  if (!["sc-zu", "sc-scan"].includes(ev.target.id)) return;
  scanEinstSpeichern({ ...scanEinst(), zuschneiden: $("#sc-zu").checked, scan: $("#sc-scan").checked });
  meldung("Gespeichert ✓");
});
document.addEventListener("toggle", (ev) => { if (ev.target.matches?.("details.erledigt")) erledigtAuf = ev.target.open; }, true);
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-a]");
  if (!el || el.disabled) return;
  const f = aktionen[el.dataset.a];
  if (f) f(el);
});

// ---------- Start ----------
zeichne();
if (ansicht !== "einrichtung") { ladeStand(); uploadsFortsetzen(); }
if (lauf?.schritt === "warten") beobachten();
setInterval(() => { if (ansicht === "lauf" && lauf?.schritt === "warten") zeichne(); }, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && ansicht === "start") ladeStand(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(vorladen, () => {});
