import { Card, PageHeader, Badge } from '../components/ui'
import { notifyOk } from '../lib/toast'
import { IconDownload, IconWindows } from '../components/icons'

const SECTIONS = [
  ['start', 'Erste Schritte'],
  ['medien', 'Medien'],
  ['layouts', 'Layouts & Widgets'],
  ['kampagnen', 'Kampagnen'],
  ['displays', 'Displays'],
  ['wall', 'Wall'],
  ['gruppen', 'Gruppen'],
  ['zeitplan', 'Zeitplan'],
  ['sofort', 'Sofort-Einblendung'],
  ['module', 'Module'],
  ['benutzer', 'Benutzer & Rollen'],
  ['statistik', 'Statistik & Audit'],
  ['backup', 'Sicherung'],
  ['windows', 'Windows-Player (Empirum)'],
  ['treiber', 'Grafiktreiber (AMD)'],
] as const

export default function Guide() {
  return (
    <div>
      <PageHeader title="Anleitung" subtitle="Cheatsheet: CMS-Bedienung und Player-Einrichtung" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px,1fr]">
        {/* Inhaltsverzeichnis */}
        <nav className="hidden lg:block">
          <div className="sticky top-6 space-y-1">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`}
                onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                className="block rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer">{label}</a>
            ))}
          </div>
        </nav>

        <div className="max-w-3xl space-y-6">
          <Section id="start" title="Erste Schritte">
            <p>Der typische Ablauf — wie in Xibo:</p>
            <Steps items={[
              <> <b>Medien</b> hochladen (Bilder, Videos, PDFs).</>,
              <> Ein <b>Layout</b> anlegen, Regionen platzieren und Inhalte in die Playlists legen.</>,
              <> Layout <b>veröffentlichen</b>.</>,
              <> Einen <b>Player</b> starten → er zeigt einen Pairing-Code → unter <b>Displays</b> freigeben.</>,
              <> Optional per <b>Zeitplan</b> steuern, was wann auf welchem Display/Gruppe läuft.</>,
            ]} />
            <Note>Änderungen (Veröffentlichen, Zeitplan) werden <b>live</b> an die Player gepusht — kein Warten auf ein Abruf-Intervall.</Note>
          </Section>

          <Section id="medien" title="Medien">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Hochladen:</b> Button „Hochladen" oder Dateien einfach ins Fenster <b>ziehen</b> (Drag&amp;Drop, mehrere gleichzeitig).</li>
              <li><b>Suchen/Filtern</b> nach Name und Typ (Bilder/Videos/PDF/Audio).</li>
              <li><b>Vorschau &amp; Umbenennen:</b> Kachel anklicken → Vorschau, Name ändern, löschen.</li>
              <li><b>Löschschutz:</b> Ein Medium, das noch in Layouts verwendet wird, kann nicht gelöscht werden (klare Meldung, „N× genutzt"-Badge).</li>
            </ul>
          </Section>

          <Section id="layouts" title="Layouts & Widgets">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Anlegen:</b> „Neues Layout" (Standard 1920×1080). Öffnen per Klick.</li>
              <li><b>Regionen:</b> „Region" hinzufügen; per <b>Ziehen</b> verschieben, Ecke ziehen zum Skalieren, oder <b>umbenennen &amp; pixelgenau</b> über die X/Y/Breite/Höhe-Felder.</li>
              <li><b>Inhalte (Widgets):</b> Medium, Text, Uhr, Webseite, RSS-Ticker, Wetter. Widget anklicken → <b>bearbeiten</b> (z. B. Text/Farbe/Ausrichtung, Bild-Anpassung, Feed-URL, Wetter-Ort, Uhr-Format, Dauer). Reihenfolge per ▲▼.</li>
              <li><b>Lauftext:</b> Beim Text-Widget die Option „Lauftext (Ticker)" für ein durchlaufendes Band.</li>
              <li>
                <b>Icinga (Monitoring, nur Administratoren):</b> Bausteine für ein Monitoring-Wallboard. Statt einer festen Kachel wählt man je
                Widget eine <b>Ansicht</b> — so baut man sich seine eigene Übersicht zusammen: für jeden Baustein eine eigene Region
                anlegen, frei platzieren und in der Größe ziehen. Verfügbare Ansichten:
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  <li><b>Gesamtübersicht</b> — Urteil, Zahlenband (Dienste, Hosts, bestätigt/Wartung, überfällige Prüfungen,
                    Erholungen), Aufschlüsselung, Meldungsliste und eine Fußzeile mit Icingas Eigenzustand (Standard).
                    Ist die Region breit genug, kommt rechts eine zweite Spalte mit <b>Gruppen-Gesundheit</b> und
                    <b>Verlauf</b> dazu; bei offenen Meldungen steht über der Liste die <b>längste offene Meldung</b>
                    („seit 7 Std") und der <b>Brennpunkt</b> — der Host, auf dem sich die Meldungen häufen.</li>
                  <li><b>Ampel</b> — nur der Gesamtstatus, sehr groß. Ideal für eine kleine Region.</li>
                  <li><b>Einzelzahl</b> — eine Kennzahl groß, wählbar aus 14 Werten (kritische Dienste, Hosts ausgefallen,
                    bestätigt, in Wartung, überfällige Prüfungen, Erholungen der letzten Stunde, Gesamtzahlen …).</li>
                  <li><b>Dienste</b> / <b>Hosts</b> — die Zahlen je Status nebeneinander, mit Gesamtzahl sowie bestätigt/Wartung
                    (hochkant automatisch umgebrochen).</li>
                  <li><b>Problemliste</b> — offene Meldungen mit Host bzw. Dienst und Dauer („seit 18 min").</li>
                  <li><b>Gruppen</b> — Gesundheit je Host-/Servicegruppe mit Füllbalken und „ok/gesamt" („WLAN 100/100"),
                    betroffene Gruppen oben. Breite Regionen zeigen zusätzlich die Spalten Aus/Krit/Warn.</li>
                  <li><b>Zuletzt erholt</b> — was sich in der letzten Stunde von selbst gefangen hat. Zeigt Bewegung,
                    auch wenn gerade nichts brennt.</li>
                  <li><b>Verlauf</b> — offene Meldungen der letzten Stunden als Säulen, mit „jetzt", „Spitze" und der
                    Richtung in Worten („3 weniger als zu Beginn"). Der Verlauf entsteht im Arbeitsspeicher des CMS:
                    nach einem Neustart baut er sich von selbst wieder auf, bis dahin steht das ehrlich auf der Kachel.</li>
                  <li><b>Icinga-Zustand</b> — Prüfrate, Latenz, Ausführungszeit, Laufzeit und Version. Eine <b>kurze Laufzeit</b> wird
                    hervorgehoben: sie verrät einen unbemerkten Neustart.</li>
                </ul>
                <b>Aussehen — einstellbar, gilt für alle Bausteine:</b> Unter „Aussehen" stehen drei Vorgaben: <b>Hell</b> (weiße
                Karte wie die Karten im CMS, Standard), <b>Gedämpft</b> (heller Grauton) und <b>Dunkel</b>. Dazu lässt sich eine
                <b>eigene Hintergrundfarbe</b> wählen; ohne eigene Farbe gilt der Grundton der Vorgabe. Bei eigener Farbe rechnet die
                Kachel den Rest selbst aus: helle Schrift auf dunklem Grund und umgekehrt (nach Relativluminanz), und jede Statusfarbe
                wird so weit auf- oder abgedunkelt, bis sie den Kontrast <b>4,5:1 nach WCAG</b> erreicht — auf dem Grund und auf der
                eingefärbten Zeile. Dunkelblau als Hintergrund macht die Kachel also nicht unlesbar.
                <br />
                Die Statusfarben sind die von <b>Icinga Web 2</b> (grün in Ordnung, gelb Warnung, rot kritisch, violett unbekannt); offene
                Meldungen werden wie dort <b>flächig in ihrer Statusfarbe hinterlegt</b>. Eine Zahl wird nur eingefärbt, wenn sie ein
                <b>offenes</b> Problem meldet — was bestätigt oder in Wartung ist, bleibt neutral. Die Kachel bringt ihr Aussehen
                <b>selbst</b> mit: sie sieht auf jedem Fernseher gleich aus, unabhängig von der Hintergrundfarbe des Layouts und vom
                hellen oder dunklen Design des CMS.
                <br />
                <b>Auch im Ruhezustand bleibt die Gesamtübersicht gefüllt:</b> Sind keine Meldungen offen, treten an die Stelle der
                Liste die Dinge, die es sonst nie auf den Schirm schaffen — seit wann es ruhig ist, was sich <b>zuletzt erholt</b> hat,
                welche Meldungen <b>bestätigt</b> sind (jemand kümmert sich bereits) und wie gesund die einzelnen <b>Gruppen</b> sind.
                <br />
                <b>Ausgefallene Hosts stehen mit in der Liste</b>, gekennzeichnet als „Host" statt „Dienst". Bestätigte Meldungen und
                Wartungsfenster bleiben aus der Liste heraus, werden aber als eigene Zahl ausgewiesen — man sieht also, dass etwas
                bearbeitet wird, statt es gar nicht zu sehen. Ebenso <b>überfällige Prüfungen</b>: prüft Icinga ein Objekt nicht mehr,
                ist das ein stiller Ausfall und gefährlicher als ein rotes Feld. Jeder Zustand trägt immer sein Kurzwort
                (KRIT/WARN/UNBEK/AUS/UNERR) und eine feste Spalte, ist also auch bei Farbfehlsichtigkeit eindeutig.
                Die Bausteine aktualisieren sich alle 30 s und <b>teilen sich einen gemeinsamen Abruf</b> — zehn Bausteine erzeugen
                nicht mehr Last als einer. Ist Icinga nicht erreichbar, steht der Klartext-Grund in der Gesamtübersicht und der
                Problemliste; die kleinen Bausteine zeigen einen knappen Hinweis statt einer Zahl, nie eine leere Fläche.
                <br />
                <b>Wichtig:</b> Die Daten holt <b>der CMS-Server</b> per Icinga-API und reicht sie an das freigegebene Display weiter —
                die Displays brauchen <b>keinen Zugang ins Monitoring-Netz</b>, kein Zertifikat und keine Zugangsdaten. Der Knopf „Icinga"
                erscheint nur für die Rolle <b>Admin</b>; Grafik sieht weder den Knopf noch die Monitoring-Daten.
              </li>
              <li><b>Vorschau:</b> Button „Vorschau" zeigt das Layout live in Vollbild — ohne echtes Display.</li>
              <li><b>Veröffentlichen:</b> macht die aktuelle Version für die Player gültig. <b>Duplizieren</b> (Kopier-Symbol in der Layout-Liste) erstellt eine Variante.</li>
            </ul>
          </Section>

          <Section id="kampagnen" title="Kampagnen">
            <p>Mehrere Layouts zu einer <b>Abfolge</b> bündeln — sie werden nacheinander abgespielt (jedes für seine Dauer, in Schleife). Kampagne anlegen → Layouts hinzufügen und per ▲▼ ordnen. Kampagnen lassen sich im Zeitplan wie Layouts einplanen.</p>
          </Section>

          <Section id="displays" title="Displays">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Koppeln:</b> Der Player zeigt beim Start einen 6-stelligen Pairing-Code und taucht unter Displays als „wartet auf Freigabe" auf (Badge in der Navigation).</li>
              <li><b>Freigeben:</b> Display öffnen → „Jetzt freigeben".</li>
              <li><b>Standard-Layout</b> setzen (läuft, wenn kein Zeitplan greift).</li>
              <li><b>Fernsteuerung</b> (bei Online-Displays): Inhalt neu laden, Screenshot, Player-Neustart, Reboot.</li>
              <li><b>Verfügbarkeit (24 h)</b> und Online/Offline-Ereignisse je Display.</li>
            </ul>
          </Section>

          <Section id="wall" title="Wall">
            <p>Die <b>Wall</b> zeigt <b>alle Displays gleichzeitig</b> als kleine Miniplayer — ein Blick genügt,
              um zu sehen, was gerade wo läuft. Klick auf eine Kachel öffnet die Großansicht (mit ← / → durchblättern).</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b>Kein Bildschirmfoto:</b> Jedes Gerät meldet im Sekundentakt über seine Dauerverbindung, welches
                Layout und welches Widget es in welcher Region abspielt. Das CMS baut daraus mit <b>demselben Renderer</b> nach,
                den auch der Player benutzt. Echte Pixel-Screenshots bräuchten den OpenSignage-Geräteagenten; die Kiosk-Geräte
                (Edge/Assigned Access) können keine liefern.</li>
              <li><b>„gemeldet vor X s"</b> (grüner Punkt): das Gerät meldet aktuell.</li>
              <li><b>„meldet seit X s nichts"</b> (bernstein): das Gerät ist verbunden, meldet aber seit über 30 s nichts mehr —
                typisch für ein hängendes Gerät.</li>
              <li><b>Ausgegraut + „Offline seit …":</b> das Gerät ist getrennt; gezeigt wird der <b>letzte bekannte Stand</b>,
                kein Livebild.</li>
              <li><b>Rotes Fehler-Abzeichen:</b> das Gerät meldet Wiedergabefehler (z. B. Video lädt nicht). Dieselben Fehler
                stehen im Display-Protokoll unter <b>Displays</b>.</li>
              <li><b>„Gerät zeigt noch eine ältere Fassung":</b> die gemeldete Inhaltsversion weicht vom aktuellen Stand im
                CMS ab — dann hilft „Inhalt neu laden" in der Großansicht.</li>
              <li><b>Schonend gebaut:</b> in den Kacheln laufen keine Videos und keine Webseiten (Standbild bzw. beschriftete
                Fläche); erst die Großansicht rendert alles live und video-zeitsynchron.</li>
            </ul>
          </Section>

          <Section id="gruppen" title="Gruppen">
            <p>Displays zu <b>Anzeigegruppen</b> bündeln, um sie gemeinsam zu bespielen. Ein Zeitplan-Termin auf eine Gruppe erreicht automatisch alle Displays der Gruppe.</p>
          </Section>

          <Section id="zeitplan" title="Zeitplan">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Kalender</b> (Monatsansicht). „Termin anlegen" oder auf einen Tag klicken.</li>
              <li>Termin = <b>Layout oder Kampagne</b> → auf <b>Display oder Gruppe</b>, mit Zeitraum (von/bis).</li>
              <li><b>Priorität:</b> höhere Priorität gewinnt bei Überschneidung.</li>
              <li><b>Dayparting:</b> optional auf bestimmte Wochentage und ein Uhrzeit-Fenster begrenzen.</li>
            </ul>
          </Section>

          <Section id="sofort" title="Sofort-Einblendung">
            <p>Über <b>Sofort-Einblendung</b> schiebst du eine Vollbild-Meldung (z. B. „Gebäude räumen") sofort auf
              <b> alle</b>, eine <b>Gruppe</b> oder ein <b>einzelnes Display</b> — sie hat <b>Vorrang vor Zeitplan
              und Standard-Layout</b>. Meldung + Zusatztext eingeben, Farbe wählen, Ziel bestimmen, „Jetzt einblenden".
              Beenden über <b>„Alle beenden"</b> — der geplante Inhalt läuft danach automatisch weiter.</p>
          </Section>

          <Section id="module" title="Module">
            <p>Das nackte System ist bewusst klein: <b>Displays, Layouts, Medien, Player, Benutzer</b>.
              Alles darüber hinaus ist ein Modul, das ein Administrator unter <b>Module</b> abschaltet —
              Kampagnen, Zeitplan, Gruppen, Wall, Sofort-Einblendung, Statistik, Änderungsprotokoll,
              Wetter, Nachrichtenticker, Webseiten und Monitoring.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Standard ist an.</b> Eine frische Installation ist vollständig; erst ein bewusstes
                Abschalten ändert etwas.</li>
              <li><b>Abgeschaltet heißt gesperrt</b>, nicht nur ausgeblendet: Der Bereich verschwindet aus
                dem Menü, der Inhaltstyp aus der Widget-Auswahl, und die Schnittstelle antwortet mit einer
                klaren Meldung statt mit Daten.</li>
              <li><b>Vorhandene Inhalte bleiben.</b> Ein bereits eingerichtetes Widget verschwindet nicht
                aus einem Layout — es lässt sich nur nicht neu hinzufügen.</li>
            </ul>
            <Note>Nur Administratoren sehen diesen Bereich. Wer ein Modul abschaltet, bekommt gesagt,
              was dadurch ebenfalls stillsteht.</Note>
          </Section>

          <Section id="benutzer" title="Benutzer & Rollen">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Grafik:</b> kümmert sich um Inhalte (Medien, Layouts, Kampagnen, Displays, Zeitplan).</li>
              <li><b>Admin:</b> alles davon plus Benutzerverwaltung, Audit-Log und Einstellungen.</li>
              <li><b>Anmeldung:</b> „Active Directory" (Windows-Passwort, zentral verwaltet) oder lokales Passwort. AD-Nutzer werden hier nur mit AD-Anmeldenamen + Rolle angelegt.</li>
            </ul>
          </Section>

          <Section id="statistik" title="Statistik & Audit">
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Statistik:</b> Wiedergaben (Proof-of-Play), Top-Medien/Layouts, Displays online, Speicherbelegung.</li>
              <li><b>Audit-Log</b> (Admin): lückenlose Protokollierung aller Aktionen und Anmeldungen.</li>
            </ul>
          </Section>

          <Section id="backup" title="Sicherung & Wiederherstellung">
            <p>Der Server sichert <b>täglich um 03:00</b> automatisch Datenbank + Medien (rotierend, die letzten 14
              Sicherungen bleiben erhalten). Ablage auf dem Server unter <code>~/opensignage-backups</code>.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Sicherung manuell:</b> <code>sudo bash ~/opensignage/deploy/backup.sh</code></li>
              <li><b>Wiederherstellen:</b> <code>sudo bash ~/opensignage/deploy/restore.sh ~/opensignage-backups/&lt;archiv&gt;.tar.gz</code> (überschreibt DB + Medien nach Rückfrage).</li>
            </ul>
            <Note>Für zusätzliche Sicherheit die Backup-Dateien regelmäßig auf ein separates Ziel kopieren (z. B. Netzlaufwerk).</Note>
          </Section>

          <Section id="windows" title={<span className="inline-flex items-center gap-2"><IconWindows className="h-5 w-5" />Windows-Player einrichten (Empirum / Matrix42)</span>}>
            <p>Die MiniPCs werden per <b>echtem Windows-Kiosk (Assigned Access)</b> auf Edge im Vollbild gesperrt —
              kein Desktop, keine Taskleiste, <b>Alt+Tab / Win / Tab-Wechsel gesperrt</b>. Ein <b>Empirum-Paket</b>,
              einmal importiert und einer Gerätegruppe zugewiesen — jeder MiniPC wird damit identisch und von Grund
              auf neu aufgesetzt, egal in welchem Zustand er vorher war. Kein Handgriff am Gerät.</p>

            <h4 className="mt-4 font-semibold">1. Kiosk-Paket herunterladen</h4>
            <div className="mt-2">
              <Download file="OpenSignageKiosk-Empirum-Paket.zip" desc="Fertiges Empirum-Softwarepaket — in Empirum importieren" big />
            </div>
            <p className="mt-2 text-xs text-slate-400">Richtet das Gerät komplett ein: CMS-Zertifikat, Kiosk-Konto, Auto-Logon und den Edge-Vollbild-Kiosk — überwiegend mit nativen Windows-Tools, damit nichts von Sicherheitssoftware blockiert wird.</p>

            <h4 className="mt-4 font-semibold">2. In Empirum importieren</h4>
            <Steps items={[
              <> <b>ZIP entpacken</b> → Ordner <code>OpenSignageKiosk</code> (Struktur beibehalten).</>,
              <> <b>Empirum Management Console</b> öffnen → <b>Konfiguration → Software → Depot</b> → Rechtsklick auf die Zielkategorie → <b>Import/Export → „Paket importieren…"</b> → die <code>EmpirumPackageData.xml</code> im Ordner <code>OpenSignageKiosk</code> wählen.</>,
              <> Danach erscheint <b>„OpenSignage Kiosk"</b> im Depot. Erst der Import kopiert die Dateien physisch ins Depot.</>,
            ]} />
            <Callout tone="warn" title={'Wichtig: „Import/Export → Paket importieren" verwenden — nicht „Paket einfügen"'}>
              <b>„Paket einfügen"</b> schreibt nur einen Verweis auf die <code>.inf</code> in die Datenbank, ohne die Dateien ins Depot zu kopieren →
              Fehler <b>„Check File is not available"</b>. Der richtige Weg ist <b>Import/Export → Paket importieren</b>, das die Dateien
              tatsächlich ins Depot legt.
            </Callout>

            <h4 className="mt-4 font-semibold">3. Zuweisen & ausrollen</h4>
            <Steps items={[
              <> <b>Zielgeräte bündeln:</b> unter <b>Verwaltung → Computer</b> eine Gruppe (z. B. „Digital Signage") anlegen und die MiniPCs hineinziehen — oder ein einzelnes Gerät wählen.</>,
              <> <b>Paket zuweisen:</b> Gruppe/Gerät markieren → Reiter <b>Software</b> → <b>Softwarepaket zuweisen</b> → „OpenSignage Kiosk" → Modus <b>Installieren</b> (erforderlich).</>,
              <> <b>Verteilen:</b> der <b>Empirum-Agent</b> installiert beim nächsten <b>Software-Sync</b> im <b>SYSTEM-Kontext</b> (silent) — sofort anstoßen per Rechtsklick Gerät → <b>Software-Sync jetzt</b>.</>,
              <> <b>Neustart:</b> automatische Anmeldung am Kiosk-Konto → Edge-Kiosk startet und zeigt den <b>Pairing-Code</b>.</>,
              <> <b>Freigeben:</b> im CMS unter <b>Displays</b> koppeln → geplanter Inhalt läuft, Updates kommen live.</>,
            ]} />
            <Note>Idempotent — bei jeder (Neu-)Installation wird das Gerät auf denselben Kiosk-Zustand gezogen. Die
              <b> Kopplung bleibt über Neustarts erhalten</b>: das Display wird über den <b>Rechnernamen</b> identifiziert
              (nicht über einen Zufalls-Schlüssel), sodass es nach jedem Reboot dasselbe bleibt.
              Protokoll am Client: <code>C:\ProgramData\OpenSignage\install.log</code> (auch ohne Admin lesbar).</Note>

            <h4 className="mt-6 font-semibold border-t border-slate-200 pt-4 dark:border-slate-800">Einzeldateien & Notfall</h4>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Download file="Install-OpenSignageKiosk.ps1" desc="Kiosk-Installer-Skript einzeln" />
              <Download file="kiosk-assignedaccess.xml" desc="Assigned-Access-Konfig" />
              <Download file="opensignage-ca.crt" desc="CMS-Zertifikat" />
            </div>
            <Note>Notfall-Fallback am Gerät (falls je nötig): <b>Einstellungen → Konten → Kiosk einrichten →
              Microsoft Edge → Vollbild → URL</b> <code>{location.origin}/player</code>.</Note>
          </Section>

          <Section id="treiber" title={<span className="inline-flex items-center gap-2"><IconWindows className="h-5 w-5" />Grafiktreiber (AMD)</span>}>
            <p>Ein eigenständiges, <b>winziges</b> Empirum-Paket, das den <b>AMD-Grafiktreiber</b> installiert. Nötig, wenn ein
              MiniPC nur in <b>800×600 / 4:3</b> statt Vollbild anzeigt — dann läuft die GPU auf dem Windows-Basis-Anzeigetreiber.</p>

            <Note>Betroffen sind Geräte mit <b>AMD Ryzen Embedded R2544</b> (z. B. NiPoGi P2) (GPU <code>DEV_15D8</code>, Revision <code>REV_75</code>).
              Das ist ein <b>Embedded-Stepping</b>, das die normalen AMD-/OEM-Treiber nicht kennen — deshalb blieb es bisher beim
              Basis-Treiber. Dieses Paket bringt den <b>passenden, WHQL-signierten AMD-Embedded-R2000-Treiber</b> (31.0.21923.1000).</Note>

            <h4 className="mt-4 font-semibold">1. Paket herunterladen</h4>
            <div className="mt-2">
              <Download file="OpenSignage-Grafiktreiber-Empirum.zip" desc="Grafiktreiber-Paket (winzig, ~12 KB)" />
            </div>
            <p className="mt-2 text-xs text-slate-400">Das Paket enthält <b>keinen</b> Treiber, sondern lädt ihn beim Ausrollen automatisch
              vom CMS-Server übers Netz (≈600 MB, einmalig pro Gerät), prüft die Prüfsumme, installiert per <code>pnputil</code> und
              bindet die GPU. Deshalb ist es nur ein paar KB groß und rollt zuverlässig aus.</p>

            <h4 className="mt-4 font-semibold">Fernsteuerung: Neustart &amp; Herunterfahren</h4>
            <p className="mt-1 text-slate-300">Der Player ist eine Webseite — sie kann sich neu laden, aber den Rechner nicht
              neu starten. Deshalb bringt das Paket einen kleinen <b>Geräteagenten</b> mit: eine geplante Aufgabe unter SYSTEM,
              die jede Minute nachsieht, ob im CMS ein Befehl für dieses Display liegt.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              <li><b>Neustart / Herunterfahren</b> aus der Display-Ansicht wirken damit auch, wenn die Anzeige hängt —
                der Agent läuft unabhängig vom Browser. Er erreicht das Gerät sogar, wenn es im CMS als offline gilt.</li>
              <li><b>Bis zu einer Minute Verzögerung</b> ist normal, der Agent fragt im Minutentakt nach.</li>
              <li><b>Was passiert ist, steht im Protokoll</b> des Displays: <code>COMMAND_QUEUED</code> beim Absenden,
                danach <code>COMMAND_OK</code> oder <code>COMMAND_FAILED</code> mit Begründung.</li>
              <li><b>Schutz gegen Endlosschleifen:</b> jeder Befehl wird genau einmal ausgeliefert, verfällt nach 5 Minuten,
                und das Gerät führt höchstens einen Neustart je 10 Minuten aus.</li>
              <li><b>Screenshot</b> geht weiterhin nicht: das Bild gehört der angemeldeten Sitzung, ein Systemdienst
                kommt nicht heran. Der Agent meldet das ehrlich zurück, statt es stillschweigend zu verwerfen.</li>
            </ul>

            <h4 className="mt-4 font-semibold">Eigene Gerätegruppe (damit Laptops das Paket nicht bekommen)</h4>
            <p className="mt-1 text-slate-300">Das Paket soll nur auf die Signage-MiniPCs, nicht auf normale Arbeitsplätze.
              Dafür bekommen die Displays in Empirum eine <b>eigene Gruppe in der Verwaltungsstruktur</b> — zugewiesen wird
              dann ausschließlich dieser Gruppe.</p>
            <Steps items={[
              <> In der <b>Empirum Management Console</b> → <b>Konfiguration → Verwaltung</b> (die Baumstruktur mit den Rechnern).</>,
              <> Rechtsklick auf die passende Ebene → <b>Neu → Gruppe</b>, Name z. B. <b>„OpenSignage Displays"</b>.</>,
              <> Die MiniPCs per <b>Ziehen &amp; Ablegen</b> (oder Rechtsklick → Verschieben) in diese Gruppe holen.</>,
              <> Gruppe anklicken → Reiter <b>Software</b> → das Paket <b>„OpenSignage Kiosk"</b> auf
                <b> Installieren</b> setzen. Alle Rechner in der Gruppe erben die Zuweisung.</>,
              <> Auf den Geräten einen <b>Software-Sync</b> auslösen.</>,
            ]} />
            <Note><b>Der wichtigste Punkt:</b> Zuweisungen <b>vererben sich nach unten</b>. Ist das Paket versehentlich
              weiter oben zugewiesen (z. B. an der Wurzel oder an „Alle Computer"), landet es trotz eigener Gruppe auf
              <b> allen</b> Rechnern — dort also die Zuweisung entfernen, nicht nur unten neu setzen.
              <br /><br />
              Im <b>Depot</b> bleibt das Paket immer sichtbar — das ist die Bibliothek, keine Zuweisung. „Nicht bei den
              Laptops" heißt also: keine <b>Zuweisung</b> für die Laptops, nicht etwa das Paket löschen.
              <br /><br />
              Nebeneffekt: Mit einer eigenen Gruppe lassen sich später auch <b>unterschiedliche Bildschirm-Zeiten</b> je
              Bereich fahren — dafür ein zweites Paket mit anderen Zeiten bauen
              und der jeweiligen Gruppe zuweisen.</Note>

            <h4 className="mt-4 font-semibold">Bildschirm-Zeiten (18:00 aus / 06:00 an)</h4>
            <p className="mt-1 text-slate-300">Das Paket richtet zwei geplante Aufgaben ein: <b>18:00 Bildschirm aus</b>
              (das Bildsignal wird abgeschaltet, der Fernseher geht in Standby) und <b>06:00 an</b> (das Gerät startet neu,
              dadurch ist das Bild garantiert wieder da und der Kiosk läuft frisch).</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              <li>Der <b>Rechner läuft nachts weiter</b> — er bleibt im CMS erreichbar und holt Updates.</li>
              <li><b>Warum ein Neustart am Morgen?</b> Ein Weckzeitgeber aus dem Schlafmodus kann fehlschlagen —
                dann bliebe der Fernseher den ganzen Tag dunkel. Der Neustart schaltet das Bild sicher ein.</li>
              <li><b>Andere Zeiten oder ausschalten:</b> im Paket in <code>Install-OpenSignageKiosk.ps1</code> oben
                <code>$DisplayOffTime</code> / <code>$DisplayOnTime</code> ändern (leer = keine Zeitsteuerung), neu bauen und ausrollen.</li>
              <li><b>Falls der Fernseher nicht in Standby geht:</b> manche Geräte zeigen bei fehlendem Signal nur
                „kein Signal". Dann am Fernseher den eigenen Ein-/Ausschalt-Timer nutzen — das ist zuverlässiger als jede Software.</li>
            </ul>

            <h4 className="mt-4 font-semibold">2. Importieren, zuweisen, ausrollen</h4>
            <Steps items={[
              <> <b>ZIP entpacken</b> → Ordner <code>OpenSignageGraphics</code>.</>,
              <> <b>Genauso importieren</b> wie das Kiosk-Paket: EMC → <b>Konfiguration → Software → Depot</b> → <b>Import/Export → „Paket importieren…"</b> → die <code>EmpirumPackageData.xml</code> wählen → erscheint als <b>„OpenSignage Grafiktreiber"</b>.</>,
              <> Der Gruppe/dem Gerät <b>zuweisen</b> (Modus Installieren) → <b>Software-Sync</b> → danach einmal <b>neu starten</b>.</>,
              <> Nach dem Neustart läuft das Gerät in <b>1920×1080</b>, der Kiosk füllt den ganzen Bildschirm.</>,
            ]} />

            <p className="mt-3 text-xs text-slate-400">Kontrolle bei Problemen: Protokoll auf dem Gerät unter <code>C:\ProgramData\OpenSignage\driver.log</code>
              (zeigt Download, Prüfsumme, Installation und den GPU-Status vorher/nachher). Import-Hinweis wie beim Kiosk:
              <b> „Import/Export → Paket importieren"</b>, nicht „Paket einfügen".</p>
          </Section>
        </div>
      </div>
    </div>
  )
}

// --- Bausteine -------------------------------------------------------------
function Section({ id, title, children }: { id: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="scroll-mt-6 p-6" >
      <h3 id={id} className="mb-3 scroll-mt-6 text-lg font-semibold">{title}</h3>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{children}</div>
    </Card>
  )
}
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{i + 1}</span>
          <span className="pt-0.5">{it}</span>
        </li>
      ))}
    </ol>
  )
}
function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-200">{children}</div>
}
function Callout({ title, children, tone = 'warn' }: { title: string; children: React.ReactNode; tone?: 'warn' }) {
  void tone
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <IconWarn className="h-4 w-4 shrink-0" />{title}
      </div>
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}
function IconWarn(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function Code({ text }: { text: string }) {
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 pr-12 text-xs text-slate-100 dark:bg-slate-950"><code>{text}</code></pre>
      <button onClick={() => { navigator.clipboard?.writeText(text); notifyOk('Kopiert') }}
        className="absolute right-2 top-2 rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 cursor-pointer">Kopieren</button>
    </div>
  )
}
function Download({ file, desc, big }: { file: string; desc: string; big?: boolean }) {
  return (
    <a href={`/downloads/${file}`} download
      className={big
        ? 'flex items-center gap-3 rounded-lg border-2 border-brand-500 bg-brand-50 p-4 hover:bg-brand-100 dark:bg-brand-900/20 dark:hover:bg-brand-900/40'
        : 'flex items-center gap-3 rounded-md border border-slate-200 p-3 hover:border-brand-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'}>
      <IconDownload className={big ? 'h-6 w-6 shrink-0 text-brand-600 dark:text-brand-300' : 'h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400'} />
      <div className="min-w-0">
        <div className={big ? 'truncate font-mono text-sm font-semibold' : 'truncate font-mono text-sm'}>{file}</div>
        <div className="text-xs text-slate-400">{desc}</div>
      </div>
    </a>
  )
}
