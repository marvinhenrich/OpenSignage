#!/usr/bin/env bash
# Baut das Empirum-Paket versioniert aus den Templates + aktueller Payload.
#   build-package.sh          -> baut die aktuelle Version (Datei VERSION)
#   build-package.sh bump     -> erhöht die Patch-Version (x.y.Z+1) und baut
set -euo pipefail
cd "$(dirname "$0")"               # deploy/windows/empirum
WIN=..                             # deploy/windows
PKG=OpenSignageKiosk

# Version bestimmen (optional hochzählen)
if [ "${1:-}" = "bump" ]; then
  IFS=. read -r a b c < VERSION
  echo "$a.$b.$((c + 1))" > VERSION
fi
VER=$(cat VERSION)
UUID=$(cat UUID)

# Beschriftung des Pakets. Aus der Umgebung, damit derselbe Quelltext unter beliebigem
# Namen ausgerollt werden kann - und damit kein Klarname im Repository steht.
VENDOR="${BRAND_VENDOR:-OpenSignage}"
PRODUCT="${BRAND_NAME:-OpenSignage}"
AUTHOR="${BRAND_AUTHOR:-$VENDOR}"
echo "== Baue Empirum-Paket Version $VER =="

# Paketordner frisch aufbauen
rm -rf "$PKG"
mkdir -p "$PKG/Data/Install"
for f in Install-OpenSignageKiosk.ps1 Uninstall-OpenSignageKiosk.ps1 kiosk-assignedaccess.xml opensignage-ca.crt OpenSignage-Agent.ps1; do
  cp "$WIN/$f" "$PKG/$f"; cp "$WIN/$f" "$PKG/Data/$f"
done
# Paketversion in den Installer einsetzen -> der Player meldet sie als Client-Version ans CMS.
sed -i '' -e "s/__VERSION__/$VER/g" "$PKG/Install-OpenSignageKiosk.ps1" "$PKG/Data/Install-OpenSignageKiosk.ps1" 2>/dev/null \
  || sed -i -e "s/__VERSION__/$VER/g" "$PKG/Install-OpenSignageKiosk.ps1" "$PKG/Data/Install-OpenSignageKiosk.ps1"
BRANDING=(-e "s/__VERSION__/$VER/g" -e "s/__UUID__/$UUID/g" -e "s/__VENDOR__/$VENDOR/g" -e "s/__PRODUCT__/$PRODUCT/g" -e "s/__AUTHOR__/$AUTHOR/g")
sed "${BRANDING[@]}" templates/EmpirumPackageData.xml.tmpl > "$PKG/EmpirumPackageData.xml"
sed "${BRANDING[@]}" templates/Setup.inf.tmpl        > "$PKG/Data/Install/Setup.inf.tmp"
# WICHTIG: Die Empirum-Setup-Engine erwartet CRLF-Zeilenenden (Windows). Mit LF wird der
# [Set:Product]-Block NICHT ausgefuehrt (Paket meldet trotzdem "installiert"). Template ist ASCII.
perl -pe 's/\r?\n/\r\n/' "$PKG/Data/Install/Setup.inf.tmp" > "$PKG/Data/Install/Setup.inf"
rm -f "$PKG/Data/Install/Setup.inf.tmp"
cp "$PKG/Data/Install/Setup.inf" "$PKG/Data/Install/Setup.org"
touch "$PKG/_OpenSignage_OpenSignage Kiosk_${VER}_"

# ---- Natives PowerShell-Paket (EMPFOHLEN: Packaging Center -> Depot-Import) ----
# Inhalt, den man in den vom Package-Wizard erzeugten PowerShell-Paketordner legt.
PS=OpenSignageKiosk-PS
rm -rf "$PS"; mkdir -p "$PS"
cp "$WIN/empirum-ps/Setup.ps1" "$WIN/kiosk-assignedaccess.xml" "$WIN/opensignage-ca.crt" "$PS/"
cat > "$PS/LIESMICH.txt" <<EOF
OpenSignage — Kiosk  (natives Empirum-PowerShell-Paket)  Version $VER
==================================================================

So kommt der Kiosk sauber ins Empirum-Depot (kein Setup.inf, kein PackageRobot):

1. Auf dem Empirum-Server das PACKAGING CENTER oeffnen -> Package Wizard ->
   Pakettyp "PowerShell" -> Name "OpenSignage Kiosk", Version $VER durchklicken.
   Der Wizard erzeugt einen Paketordner mit Setup.ps1 + Setup.json.
2. Die vom Wizard erzeugte Setup.ps1 durch die HIER beiliegende Setup.ps1 ERSETZEN
   und opensignage-ca.crt + kiosk-assignedaccess.xml in denselben Ordner legen.
3. In den Paket-Eigenschaften ist bei PowerShell-Paketen die CmdLine bereits
   %SetupPS% %SetupPSParms% "%Script%" und das Flag "External installation program"
   gesetzt. Deinstallation nutzt automatisch  -Command Uninstall.
4. EMC -> Konfiguration -> Software -> Depot -> Kontextmenue -> Import/Export ->
   "Paket importieren...". DADURCH landen die Dateien im Depot -> "Check File" ist
   verfuegbar. (Nur die .inf/den Ordner "hinzufuegen" reicht NICHT: dann liegt die
   Pruefdatei nicht im Depot -> Fehler "Check File is not available".)
5. Dem MiniPC/der Gruppe zuweisen (Installieren) -> Software-Sync -> Neustart.

Optionale Parameter (Package-Variablen oder feste Werte in der CmdLine):
  -PlayerUrl "https://signage.example.local/player"  -KioskAccount "kiosk"
EOF
rm -f "$WIN/OpenSignage-Kiosk-PowerShell-Paket.zip"
zip -q -r "$WIN/OpenSignage-Kiosk-PowerShell-Paket.zip" "$PS"

# ---- ZIPs (Legacy-Setup.inf-Paket + reine Skripte) ----
rm -f OpenSignageKiosk-Empirum-Paket.zip
zip -q -r OpenSignageKiosk-Empirum-Paket.zip "$PKG"
rm -f "$WIN/OpenSignage-Kiosk-Empirum.zip"
( cd "$WIN" && zip -q -j OpenSignage-Kiosk-Empirum.zip Install-OpenSignageKiosk.ps1 Uninstall-OpenSignageKiosk.ps1 kiosk-assignedaccess.xml opensignage-ca.crt README.md )

# Downloads in der App
DL=../../../admin/public/downloads
cp "$WIN/OpenSignage-Kiosk-PowerShell-Paket.zip" \
   OpenSignageKiosk-Empirum-Paket.zip "$WIN/OpenSignage-Kiosk-Empirum.zip" \
   "$WIN/Install-OpenSignageKiosk.ps1" "$WIN/Uninstall-OpenSignageKiosk.ps1" \
   "$WIN/kiosk-assignedaccess.xml" "$WIN/opensignage-ca.crt" "$DL/"
rm -rf "$PS"

echo "== Paket $VER gebaut (PowerShell + Setup.inf) und in Downloads aktualisiert =="
