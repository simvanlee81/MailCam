# Post-Kamera

Fotografiere Briefe direkt ins Post-Archiv: Symbol auf dem Homescreen antippen, Seiten fotografieren, **Fertig** tippen. Die App lädt die Fotos verschlüsselt in `Dokumente/Eingang` hoch, startet die Verarbeitung auf GitHub und zeigt dir danach:

- welche Dokumente entstanden sind (Absender, Typ, Datum, Ablageort)
- Beträge, **Fristen** und was zu tun ist
- auf der Startseite deine offenen Fristen und To-dos aus dem ganzen Archiv

Seit v1.1 fotografierst du mit einem **Live-Scanner**: Die App erkennt das Blatt im Kamerabild, löst automatisch aus, sobald es ruhig liegt, zieht die Seite gerade und macht sie weiß wie einen Scan (siehe unten).

**Nächster Brief** trennt Briefe sicher voneinander. Ohne diese Taste erkennt das Skript selbst, wo ein neuer Brief beginnt.

---

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Post-Archiv auf v3.0 bringen

Die App braucht das Post-Archiv ab **v3.0**. Lade aus `post-archiv_v3.0.zip` den Ordner `src`, `package.json` **und** die Workflow-Datei `.github/workflows/post-archiv.yml` neu ins Repo `post-archiv`. Der Workflow hat eine neue Eingabe für die App.

### 2. App veröffentlichen (GitHub Pages)

Die App ist eine Webseite ohne Geheimnisse im Code. Deine Zugangsdaten gibst du erst auf dem Handy ein, und sie bleiben dort.

1. Auf github.com ein **neues Repository** anlegen, z. B. `post-kamera`, **Public**. Kostenlose GitHub Pages gibt es nur für öffentliche Repos.
2. **uploading an existing file** wählen und den **Inhalt** dieses Ordners hineinziehen (`index.html`, `app.js`, `opencv.js`, `manifest.webmanifest`, `sw.js`, die `icon-…png` und optional `quelltext`) → **Commit changes**. `opencv.js` ist ca. 10 MB groß, der Upload dauert einen Moment.
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

## Update auf v1.4

Im Repo `MailCam` die Dateien `app.js`, `index.html` und `sw.js` neu hochladen. `opencv.js` muss nicht erneut hoch. Ab v1.4 kommen Updates beim nächsten Öffnen sofort an. Die installierte Version steht unten im Verarbeitungs-Bildschirm und unter ⚙️. Danach die App zweimal neu öffnen.

## Update von v1.0 auf v1.1

Im Repo `post-kamera` per **Add file → Upload files** diese Dateien neu hochladen: `app.js`, `index.html`, `sw.js` und die neue **`opencv.js`**. Danach die App auf dem Handy einmal schließen und neu öffnen, beim zweiten Start ist die neue Version aktiv. Am Post-Archiv ändert sich nichts.

## Scanner

| Element | Funktion |
|---|---|
| Grüner Rahmen | Erkanntes Blatt. Der Ring am Auslöser füllt sich, solange das Blatt ruhig liegt. |
| **Auto AN/AUS** | AN: löst automatisch aus und übernimmt die Seite nach 3 Sekunden. Tippst du vorher auf „Neu“ oder „Ecken anpassen“, wird nichts übernommen. |
| Auslöser | Manuell aufnehmen, geht auch ohne erkanntes Blatt |
| **Bild: Scan / Farbe** | Scan: Schatten weg, Papier weiß, Schrift kräftig (am besten für die Texterkennung). Farbe: nur gerade gezogen, für Fotos und farbige Formulare. |
| 🔦 Licht | Taschenlampe, falls das Handy das im Browser erlaubt |
| ➕ Nächster Brief | Die folgenden Seiten gehören zu einem neuen Brief |
| Ecken anpassen | Die vier Ecken per Finger auf die Blattkanten ziehen |

Nach einer Aufnahme wartet der Scanner, bis eine **andere** Seite im Bild liegt. So wird dieselbe Seite nicht doppelt aufgenommen.

**Tipps für eine gute Erkennung:** Blatt auf eine dunklere oder gemusterte Unterlage legen, alle vier Ecken im Bild, nicht zu schräg von der Seite fotografieren. Auch Weiß auf hellem Tisch klappt meist. Wenn nicht, hilft „Ecken anpassen“.

Beim ersten Öffnen lädt der Scanner einmalig die Bilderkennung (ca. 10 MB), danach startet er sofort. Unter ⚙️ → Scanner kannst du ihn ausschalten. Dann öffnet sich wieder die normale Handy-Kamera. In der Aufnahme-Ansicht gibt es außerdem immer den Knopf **📱 Handy-Kamera**.

**Hinweis zur Bildqualität:** Der Scanner nutzt das Live-Bild der Kamera, meist 4K. Das ist für Briefe mehr als genug, aber etwas weniger als ein normales Foto. Für sehr kleine Schrift nimmst du die Handy-Kamera.

## Benutzung

| Taste | Was passiert |
|---|---|
| 📷 **Brief fotografieren / Nächste Seite** | Scanner öffnet sich, jede übernommene Seite wird sofort hochgeladen (✓ am Vorschaubild) |
| 📱 **Handy-Kamera** | Normale Kamera statt Scanner |
| ➕ **Nächster Brief** | Alle folgenden Fotos gehören zu einem neuen Brief |
| 📎 **Datei** | Vorhandenes Foto oder PDF auswählen |
| Vorschaubild antippen | Seite löschen (z. B. verwackelt) |
| ✅ **Fertig – verarbeiten** | Startet die Verarbeitung und zeigt nach 2–4 Minuten das Ergebnis |

Du kannst die App während der Verarbeitung schließen. Das Ergebnis erscheint beim nächsten Öffnen. Tippst du nie auf „Fertig“, verarbeitet der normale Zeitplan die Fotos nach spätestens 2 Stunden trotzdem.

## Datenschutz

- Deine Fotos werden **auf dem Handy verschlüsselt** und gehen direkt an Filen, wie in der Filen-App.
- Die App speichert auf dem Handy: die Filen-Sitzungsschlüssel (**nicht** dein Passwort) und den GitHub-Token. Wer dein **entsperrtes** Handy hat, käme damit an dein Filen-Konto. Unter ⚙️ kannst du dich jederzeit abmelden.
- Der Code der App ist öffentlich (GitHub Pages), enthält aber keine Zugangsdaten.

## Hochladen

- Jede Seite wird sofort nach der Aufnahme hochgeladen. Oben steht der Fortschritt, z. B. „lädt 2 … (45 %)“.
- **Hängt eine Verbindung**, bricht die App nach ca. 1 Minute ohne Fortschritt ab und versucht es automatisch noch zweimal.
- **Noch nicht hochgeladene Seiten bleiben auf dem Handy gespeichert.** Wird die App geschlossen, geht der Upload beim nächsten Öffnen weiter.
- Klappt es auch nach 3 Versuchen nicht, erscheint „erneut versuchen“ mit dem Grund.

## Wenn etwas nicht klappt

- **App hängt in einem Bildschirm fest:** `…/MailCam/?reset` im Browser öffnen. Das setzt die aktuelle Aufnahme und Verarbeitung zurück, die Anmeldungen bei Filen und GitHub bleiben erhalten. Schon hochgeladene Fotos liegen weiter im Eingang und werden beim nächsten Lauf verarbeitet.

- **Filen-Anmeldung schlägt mit „Network Error“ o. ä. fehl:** Möglicherweise lässt Filen Anfragen von fremden Webseiten nicht zu. Das konnte ich vorab nicht testen. Schick mir die Meldung.
- **„GitHub 401/403“:** Token falsch, abgelaufen oder ohne „Actions: Read and write“.
- **„GitHub 404“:** Benutzername/Repo falsch, oder die Workflow-Datei im Repo `post-archiv` ist noch nicht v3.0.
- **Ergebnis kommt nicht:** Über den Link „GitHub-Protokoll öffnen“ siehst du den Lauf. Die Fotos liegen sicher im Eingang.

## Versionen

- **v1.4**: Updates kommen sofort an (kein veralteter Zwischenspeicher mehr); im Verarbeitungs-Bildschirm gibt es immer einen Ausweg („Nicht warten – zur Übersicht“); Versionsanzeige.
- **v1.3**: Knopf „Abbrechen“ beim Hochladen; „Aufnahme verwerfen“ geht auch bei hängendem Upload; nach einem Neustart landet die App nicht mehr im Hochlade-Bildschirm; Notausgang `?reset`.
- **v1.2**: Uploads mit Zeitlimit, automatischer Wiederholung und Fortschrittsanzeige; nicht hochgeladene Seiten bleiben auf dem Handy gespeichert und werden nach einem Neustart weiter hochgeladen; die Seitenerkennung im Scanner passt sich der Geschwindigkeit des Handys an und lässt Rechenzeit für den Upload frei.
- **v1.1**: Live-Scanner mit Seitenerkennung, automatischer Aufnahme und Übernahme, Entzerrung, Scan-Look, Ecken-Korrektur und Taschenlampe. Verständliche Meldung, wenn die Workflow-Datei im Post-Archiv veraltet ist.
- **v1.0**: Erste Version (braucht Post-Archiv ab v3.0).

Der Ordner `quelltext` enthält den Quellcode. Nach Änderungen an `quelltext/src/app.js` baust du die App mit `npm install && node build.mjs src/app.js ../app.js` neu. Für die Benutzung brauchst du ihn nicht.
