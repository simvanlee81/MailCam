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

## Update auf v2.5

Im Repo `MailCam` die Dateien `app.js`, `index.html` und `manifest.webmanifest` neu hochladen (von v1.3 oder älter zusätzlich `sw.js`). Wer von v2.3 oder älter kommt, braucht außerdem Post-Archiv v3.4.

## Update von v1.0 auf v1.1

Im Repo `post-kamera` per **Add file → Upload files** diese Dateien neu hochladen: `app.js`, `index.html`, `sw.js` und die neue **`opencv.js`**. Danach die App auf dem Handy einmal schließen und neu öffnen, beim zweiten Start ist die neue Version aktiv. Am Post-Archiv ändert sich nichts.

## Kamera & Zuschneiden

📷 öffnet immer die **Kamera-App des Handys**, also volle Foto-Qualität. Nach dem Foto erkennt MailCam das Blatt, schneidet es zu, zieht es gerade und macht es auf Wunsch weiß wie einen Scan. Die Seite wird **automatisch richtig herum gedreht** (erkannt an der Schrift: Zeilenrichtung, linksbündiger Rand sowie Ober- und Unterlängen). Die Drehung gilt für Farbe und Scan-Look gleichermaßen. Die Prüfansicht bleibt offen, bis du auf **✓ Seite übernehmen** tippst.

| In der Prüfansicht | Funktion |
|---|---|
| ↺ Neu | Foto verwerfen |
| ⬚ Ecken anpassen | Die vier Ecken per Finger auf die Blattkanten ziehen |
| ⟳ Drehen | Seite um 90° drehen (falls die automatische Ausrichtung einmal danebenliegt) |
| 🎨 Farbe / 📄 Scan | Scan: Schatten und Knicke aufgehellt, Papier weiß (am besten für die Texterkennung). Farbe: nur gerade gezogen. |
| ✓ Seite übernehmen | Seite speichern und hochladen |

**Die Erkennung kommt zurecht mit:** schrägen und gedrehten Blättern, starker Perspektive, hellen Tischen, Holz- und Stoffmaserung, weiteren Gegenständen im Bild, Knickfalten, einer vom Finger verdeckten Ecke und Briefen, die das Foto fast ganz ausfüllen.

**Tipps:** Alle vier Ecken möglichst im Bild und nicht zu schräg von der Seite fotografieren. Das Zuschneiden lädt beim ersten Mal einmalig ca. 10 MB (`opencv.js`), das erste Foto dauert deshalb etwas länger.

**Einstellungen (⚙️ → Kamera):** automatisches Zuschneiden an/aus, Scan-Look an/aus. Die Schalter gelten sofort.

## Benutzung

| Taste | Was passiert |
|---|---|
| 📷 **Brief fotografieren / Nächste Seite** | Kamera-App des Handys öffnet sich, danach zuschneiden, jede übernommene Seite wird sofort hochgeladen (✓ am Vorschaubild) |
| 📱 **Handy-Kamera** | Normale Kamera statt Scanner |
| ➕ **Nächster Brief** | Alle folgenden Fotos gehören zu einem neuen Brief |
| 📎 **Datei** | Vorhandenes Foto oder PDF auswählen |
| Vorschaubild antippen | Seite löschen (z. B. verwackelt) |
| ✅ **Fertig – verarbeiten** | Startet die Verarbeitung und zeigt nach 2–4 Minuten das Ergebnis |
| ◯ neben einem To-do | Als erledigt markieren. Es wandert in die aufklappbare Liste **Erledigt**, dort holt ↩︎ es zurück. |

Du kannst die App während der Verarbeitung schließen. Das Ergebnis erscheint beim nächsten Öffnen. Tippst du nie auf „Fertig“, verarbeitet der normale Zeitplan die Fotos nach spätestens 2 Stunden trotzdem.

## To-dos abhaken

Unter **Zu erledigen** hat jeder Eintrag rechts einen Kreis. Antippen = erledigt. Der Haken gilt sofort in der App und wird in Filen gespeichert (`Dokumente/_system/erledigt`), also auch auf anderen Geräten sichtbar. Beim nächsten Lauf des Post-Archivs (spätestens nach ein paar Stunden) wird er fest übernommen: `Übersicht.md` und `Dokumente-Index.md` zeigen das To-do dann als erledigt, die Fristen des Dokuments verschwinden (App, Übersicht, Kalender) und es kommen keine Frist-Erinnerungen per Mail mehr. Die Liste **Erledigt** zeigt die letzten 10.

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

- **v2.5**: Android-Navigationsleiste in der installierten App schwarz statt weiß (schwarzer Streifen hinter der Leiste, schwarze Hintergrundfarbe im Manifest).
- **v2.4**: Abhaken eines To-dos blendet auch die zugehörigen Fristen aus (braucht Post-Archiv v3.4 für die dauerhafte Übernahme).
- **v2.3**: Neuer Bereich ⚙️ → „4 · Als App installieren“: Installations-Knopf in Chrome/Edge/Samsung Internet, Anleitung für iPhone/Safari und Firefox, Anzeige „läuft als installierte App“. Zusätzliche Meta-Tags für Homescreen-Symbol und Titel; feste App-ID im Manifest.
- **v2.2**: „Zuletzt archiviert“ als kleine Karten (Absender, Typ, Datum, Kategorie, Betrag), antippen zeigt Zusammenfassung und Datei; keine Warn-/To-do-Kästen mehr in dieser Liste; 8 statt 5 Einträge; Hinweis, wenn die KI nicht verfügbar ist (z. B. Guthaben leer). Braucht Post-Archiv v3.3.
- **v2.1**: Stammt die To-do-Liste noch von einem älteren Post-Archiv, startet die App beim Abhaken selbst einen kurzen Lauf, der sie erneuert (statt nur einen Hinweis zu zeigen). Braucht Post-Archiv v3.2.
- **v2.0**: To-dos abhaken und wieder öffnen (braucht Post-Archiv v3.1).
- **v1.9**: Prüfansicht schließt sich nicht mehr von selbst (kein automatisches Übernehmen). Ausrichtung deutlich zuverlässiger: zusätzlich wird der linksbündige Textrand ausgewertet, und die Erkennung läuft auf einer größeren Fassung der Seite; im Test auch bei unscharfen, kleinen Fotos 158 von 160 richtig (v1.8: 134 von 160). Absicherung für Browser, die die Drehangabe im Foto (EXIF) nicht anwenden.
- **v1.8**: Automatische Ausrichtung (0°/90°/180°/270°) anhand der Schrift, im Test 70 von 70 Seiten richtig; neuer Knopf „⟳ Drehen“ in der Prüfansicht.
- **v1.7**: Kamera-Schalter (Zuschneiden, Scan-Look) werden sofort gespeichert – „Zurück“ setzt sie nicht mehr zurück.
- **v1.6**: 📷 öffnet immer die Kamera-App des Handys (App-Kamera entfernt). Zuschneiden grundlegend verbessert: mehrere Erkennungswege (Helligkeit, Papierfarbe, Kanten, Struktur), Bewertung nach Papieranteil, verdeckte Ecken werden rekonstruiert, Kanten werden fein nachjustiert, Blatt am Bildrand wird korrekt behandelt, A4-Proportion, Knickschatten werden aufgehellt. Im Test: 8 von 8 schwierigen Fotos exakt (v1.5: 4 von 8). Schnellere Vorschau.
- **v1.5**: Kamera ohne Live-Erkennung: selbst auslösen, danach erkennt die App das Blatt im Foto und schneidet es zu (Übernahme nach 2 s). Auch Fotos aus Handy-Kamera und Galerie werden zugeschnitten. Foto in voller Kamera-Auflösung, wo das Handy es erlaubt.
- **v1.4**: Updates kommen sofort an (kein veralteter Zwischenspeicher mehr); im Verarbeitungs-Bildschirm gibt es immer einen Ausweg („Nicht warten – zur Übersicht“); Versionsanzeige.
- **v1.3**: Knopf „Abbrechen“ beim Hochladen; „Aufnahme verwerfen“ geht auch bei hängendem Upload; nach einem Neustart landet die App nicht mehr im Hochlade-Bildschirm; Notausgang `?reset`.
- **v1.2**: Uploads mit Zeitlimit, automatischer Wiederholung und Fortschrittsanzeige; nicht hochgeladene Seiten bleiben auf dem Handy gespeichert und werden nach einem Neustart weiter hochgeladen; die Seitenerkennung im Scanner passt sich der Geschwindigkeit des Handys an und lässt Rechenzeit für den Upload frei.
- **v1.1**: Live-Scanner mit Seitenerkennung, automatischer Aufnahme und Übernahme, Entzerrung, Scan-Look, Ecken-Korrektur und Taschenlampe. Verständliche Meldung, wenn die Workflow-Datei im Post-Archiv veraltet ist.
- **v1.0**: Erste Version (braucht Post-Archiv ab v3.0).

Der Ordner `quelltext` enthält den Quellcode. Nach Änderungen an `quelltext/src/app.js` baust du die App mit `npm install && node build.mjs src/app.js ../app.js` neu. Für die Benutzung brauchst du ihn nicht.
