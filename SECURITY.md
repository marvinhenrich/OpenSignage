# Sicherheit / Security

## Schwachstelle melden / Reporting a vulnerability

Bitte **kein** öffentliches Issue anlegen. Nutze die private Meldefunktion von GitHub:
*Please do **not** open a public issue. Use GitHub's private reporting:*

**Security → Report a vulnerability**

Ich melde mich zurück, sobald ich die Meldung gesichtet habe.
*You will get a reply once I have reviewed the report.*

---

## Wofür das Projekt gebaut ist / Intended deployment

OpenSignage ist für den Betrieb **im eigenen Netz** gedacht — typischerweise ein
Serversystem, das nur aus dem internen Netz erreichbar ist. Es ist **nicht** darauf
ausgelegt, ungeschützt aus dem Internet erreichbar zu sein.

*OpenSignage is built to run **inside your own network** — typically a server reachable only
from the internal network. It is **not** designed to be exposed to the open internet.*

## Was eingebaut ist / What is built in

| | |
|---|---|
| **Geräteidentität** | Jedes Display hat ein eigenes Geheimnis; gespeichert wird nur der SHA-256-Abdruck. Beim ersten Kontakt wird es an das Gerät gebunden — danach kann sich kein fremdes Gerät als ein bekanntes ausgeben. Für Gerätetausch gibt es ein Zurücksetzen (nur Administratoren). |
| **Keine Standardkennwörter** | Datenbankkennwort und Sitzungsgeheimnis werden bei der ersten Installation zufällig erzeugt. |
| **Medien-Uploads** | Filterung nach Dateiendung, Auslieferung mit `X-Content-Type-Options: nosniff` und strenger Content-Security-Policy — eine hochgeladene Datei kann kein Skript in der Herkunft des CMS ausführen. |
| **Angriffsfläche** | Datenbank und CMS sind nicht nach außen veröffentlicht; einziger Eingang ist der TLS-Endpunkt. |
| **Nachrichtenbegrenzung** | Die WebSocket-Verbindungen sind in Rate und Nachrichtengröße begrenzt. |
| **Monitoring-Zugangsdaten** | Liegen ausschließlich beim Server, nie auf einem Anzeigegerät. |

## Was Betreiber selbst tun sollten / Operator responsibilities

1. **Eigenes TLS-Zertifikat** hinterlegen, wenn eine interne Zertifizierungsstelle vorhanden
   ist. Das selbst erzeugte Zertifikat ist ein funktionierender Startpunkt, kein Ersatz.
   *Install your own certificate if you run an internal CA.*
2. **Icinga-Zugang nur lesend.** Bitte einen eigenen API-Benutzer anlegen, nicht den
   Root-Zugang verwenden. *Create a read-only API user; never use the root account.*
3. **Den Datenträger `secrets` mitsichern.** Ohne das Datenbankkennwort lässt sich eine
   gesicherte Datenbank nicht mehr öffnen. *Back up the `secrets` volume.*
4. **Zugang zum CMS beschränken.** Wer das CMS bedienen kann, bestimmt, was auf allen
   Bildschirmen erscheint. *Whoever can use the CMS controls every screen.*
