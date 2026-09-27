# Post-Kamera

Fotografiere Briefe direkt ins Post-Archiv: Symbol auf dem Homescreen antippen, Seiten fotografieren, **Fertig** tippen. Die App lädt die Fotos verschlüsselt in `Dokumente/Eingang` hoch, startet die Verarbeitung auf GitHub und zeigt dir danach:

- welche Dokumente entstanden sind (Absender, Typ, Datum, Ablageort)
- Beträge, **Fristen** und was zu tun ist
- auf der Startseite deine offenen Fristen und To-dos aus dem ganzen Archiv

**Nächster Brief** trennt Briefe sicher voneinander. Ohne diese Taste erkennt das Skript selbst, wo ein neuer Brief beginnt.

---

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Post-Archiv auf v3.0 bringen

Die App braucht das Post-Archiv ab **v3.0**. Lade aus `post-archiv_v3.0.zip` den Ordner `src`, `package.json` **und** die Workflow-Datei `.github/workflows/post-archiv.yml` neu ins Repo `post-archiv`. Der Workflow hat eine neue Eingabe für die App.

### 2. App veröffentlichen (GitHub Pages)

Die App ist eine Webseite ohne Geheimnisse im Code. Deine Zugangsdaten gibst du erst auf dem Handy ein, und sie bleiben dort.

1. Auf github.com ein **neues Repository** anlegen, z. B. `post-kamera`, **Public**. Kostenlose GitHub Pages gibt es nur für öffentliche Repos.
2. **uploading an existing file** wählen und den **Inhalt** dieses Ordners hineinziehen (`index.html`, `app.js`, `manifest.webmanifest`, `sw.js`, die `icon-…png` und optional `quelltext`) → **Commit changes**.
3. **Settings → Pages** → „Source: Deploy from a branch“ → Branch **main**, Ordner **/ (root)** → **Save**.
4. Nach ca. 1 Minute ist die App erreichbar unter `https://DEIN-NAME.github.io/post-kamera/`.

### 3. GitHub-Token für die App erstellen

Damit die App die Verarbeitung starten darf:

1. github.com → Profilbild → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. Name: `Post-Kamera`, Ablaufdatum nach Wunsch. Nach Ablauf trägst du in der App einfach einen neuen ein.
3. **Repository access:** „Only select repositories“ → `post-archiv`
4. **Permissions → Repository permissions → Actions: Read and write**. Alles andere bleibt aus.
5. **Generate token** und den Token (`github_pat_…`) kopieren.

Der Token darf nur Workflows in `post-archiv` starten und ansehen, sonst nichts.

### 4. Auf dem Handy installieren

1. Die Adresse aus Schritt 2 in **Chrome** öffnen.
2. Menü (⋮) → **App installieren** bzw. **Zum Startbildschirm hinzufügen**.
3. App öffnen und einrichten:
   - **Filen:** E-Mail und Passwort (und 2FA-Code, falls aktiv) → **Bei Filen anmelden**
   - **GitHub:** Benutzername, Repository `post-archiv`, Token → **Speichern & testen**

Fertig. Ab jetzt reicht: **Symbol → 📷 → Fertig**.

---

## Benutzung

| Taste | Was passiert |
|---|---|
| 📷 **Brief fotografieren / Nächste Seite** | Kamera öffnet sich, das Foto wird verkleinert und sofort hochgeladen (✓ am Vorschaubild) |
| ➕ **Nächster Brief** | Alle folgenden Fotos gehören zu einem neuen Brief |
| 📎 **Datei** | Vorhandenes Foto oder PDF auswählen |
| Vorschaubild antippen | Seite löschen (z. B. verwackelt) |
| ✅ **Fertig – verarbeiten** | Startet die Verarbeitung und zeigt nach 2–4 Minuten das Ergebnis |

Du kannst die App während der Verarbeitung schließen. Das Ergebnis erscheint beim nächsten Öffnen. Tippst du nie auf „Fertig“, verarbeitet der normale Zeitplan die Fotos nach spätestens 2 Stunden trotzdem.

## Datenschutz

- Deine Fotos werden **auf dem Handy verschlüsselt** und gehen direkt an Filen, wie in der Filen-App.
- Die App speichert auf dem Handy: die Filen-Sitzungsschlüssel (**nicht** dein Passwort) und den GitHub-Token. Wer dein **entsperrtes** Handy hat, käme damit an dein Filen-Konto. Unter ⚙️ kannst du dich jederzeit abmelden.
- Der Code der App ist öffentlich (GitHub Pages), enthält aber keine Zugangsdaten.

## Wenn etwas nicht klappt

- **Filen-Anmeldung schlägt mit „Network Error“ o. ä. fehl:** Möglicherweise lässt Filen Anfragen von fremden Webseiten nicht zu. Das konnte ich vorab nicht testen. Schick mir die Meldung.
- **„GitHub 401/403“:** Token falsch, abgelaufen oder ohne „Actions: Read and write“.
- **„GitHub 404“:** Benutzername/Repo falsch, oder die Workflow-Datei im Repo `post-archiv` ist noch nicht v3.0.
- **Ergebnis kommt nicht:** Über den Link „GitHub-Protokoll öffnen“ siehst du den Lauf. Die Fotos liegen sicher im Eingang.

## Versionen

- **v1.0**: Erste Version (braucht Post-Archiv ab v3.0).

Der Ordner `quelltext` enthält den Quellcode. Nach Änderungen an `quelltext/src/app.js` baust du die App mit `npm install && node build.mjs src/app.js ../app.js` neu. Für die Benutzung brauchst du ihn nicht.
