<#
  OpenSignage — Kiosk-Installer (silent, fuer Empirum/Matrix42, SYSTEM-Kontext)
  Richtet einen ECHTEN Windows-Kiosk ein: Assigned Access sperrt das Geraet auf
  Microsoft Edge im Vollbild (kein Desktop/Taskleiste, Alt+Tab/Win/Ctrl+Esc gesperrt)
  inkl. AUTO-LOGON. Idempotent.

  WICHTIG: Dieses Skript wird von der Setup.inf per
     powershell -Command "iex (Get-Content -Raw '<Paket>\Install-OpenSignageKiosk.ps1')"
  ausgefuehrt. Grund: So greift die PowerShell-ExecutionPolicy (auch per GPO/EgoSecure
  auf .ps1-DATEIEN gesetzt) NICHT — der Inhalt wird wie interaktiv eingegeben ausgefuehrt.
  Zertifikat + Assigned-Access-Konfig sind eingebettet -> keine Nebendateien noetig.

  Protokoll (auch ohne Admin lesbar):  C:\ProgramData\OpenSignage\install.log
#>

$PlayerUrl     = 'https://signage.example.local/player'
$KioskAccount  = 'kiosk'
# Wird beim Bauen ersetzt. Reist als &v= mit, damit im CMS sichtbar ist, welche Paketfassung
# auf welchem Display laeuft - im Edge-Kiosk gibt es keine andere Moeglichkeit, das zu melden.
$PackageVersion = '__VERSION__'

# --- Betriebszeiten des Bildschirms ------------------------------------------------------
# Der Fernseher soll abends aus und morgens wieder an sein. Unter Windows gibt es KEIN
# HDMI-CEC (anders als beim frueheren Raspberry-Pi-Wallboard) - der verlaessliche Weg ist,
# das BILDSIGNAL abzuschalten: die meisten Fernseher gehen dann von selbst in Standby.
# Der Rechner laeuft weiter und bleibt im CMS erreichbar (Updates, Fernsteuerung).
# Leer lassen ('') schaltet die Zeitsteuerung fuer dieses Geraet ab.
$DisplayOffTime = '18:00'
$DisplayOnTime  = '06:00'

# --- Kiosk-Passwort: bei JEDER Installation neu und zufaellig ---------------------------
# Frueher stand hier ein festes Passwort. Diese Datei ist ueber die Anleitung herunterladbar,
# damit kannte jeder im Netz das Kiosk-Konto ALLER Geraete. Jetzt kennt es niemand: der
# Autologon speichert es lokal, ein Mensch braucht es nie.
function New-RandomPassword {
  $bytes = New-Object byte[] 30
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  # Base64 ohne Sonderzeichen (die stoeren net.exe/Winlogon), plus feste Klassen fuer die
  # Windows-Kennwortrichtlinie (Gross/Klein/Ziffer/Sonderzeichen).
  $core = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '')
  return ($core.Substring(0, 24) + 'aZ7#')
}
$KioskPassword = New-RandomPassword

# --- Geraete-Geheimnis: weist die Identitaet des Displays nach --------------------------
# Der Rechnername allein ist KEIN Nachweis (im AD aufzaehlbar) - sonst koennte jeder Browser
# im Netz sich als dieses Display ausgeben, fremde Inhalte lesen und der Wall einen falschen
# Zustand melden. Das Geheimnis wird EINMAL je Geraet erzeugt und bleibt liegen, damit die
# Kopplung eine Neuinstallation ueberlebt.
$stvDir  = 'C:\ProgramData\OpenSignage'
$keyFile = Join-Path $stvDir 'device.key'
try { New-Item -ItemType Directory -Force -Path $stvDir -ErrorAction SilentlyContinue | Out-Null } catch {}
$DeviceKey = $null
if (Test-Path $keyFile) { $DeviceKey = (Get-Content -Raw $keyFile).Trim() }
if (-not $DeviceKey -or $DeviceKey.Length -lt 32) {
  $kb = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($kb)
  $DeviceKey = ([System.BitConverter]::ToString($kb) -replace '-', '').ToLower()
  Set-Content -Path $keyFile -Value $DeviceKey -Encoding ASCII -NoNewline
  # Nur SYSTEM und Administratoren duerfen die Datei lesen (nicht das Kiosk-Konto).
  try {
    $acl = Get-Acl $keyFile
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($who in @('SYSTEM', 'Administratoren', 'Administrators')) {
      try {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
      } catch {}
    }
    Set-Acl -Path $keyFile -AclObject $acl
  } catch {}
}

# Stabile Display-Identitaet: Rechnername als ?id anhaengen -> Kopplung ueberlebt Reboots/Profil-Resets
# (Assigned Access wischt sonst das Edge-localStorage -> bei jedem Boot neuer Zufalls-Key -> Re-Pairing).
if ($PlayerUrl -notmatch '[?&]id=') {
  $sep = if ($PlayerUrl -match '\?') { '&' } else { '?' }
  $PlayerUrl = "$PlayerUrl$sep" + "id=$env:COMPUTERNAME"
}
# Geraete-Geheimnis anhaengen (Nachweis der Identitaet gegenueber dem CMS)
if ($PlayerUrl -notmatch '[?&]k=') { $PlayerUrl = "$PlayerUrl&k=$DeviceKey" }
if ($PackageVersion -notmatch '^__' -and $PlayerUrl -notmatch '[?&]v=') { $PlayerUrl = "$PlayerUrl&v=$PackageVersion" }

# --- Protokoll an einen fuer alle lesbaren Ort (ProgramData) ---
$logDir = 'C:\ProgramData\OpenSignage'
try { New-Item -ItemType Directory -Force -Path $logDir -ErrorAction SilentlyContinue | Out-Null } catch {}
$log = Join-Path $logDir 'install.log'
function Log($m) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  try { Add-Content -Path $log -Value "$ts  $m" -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
}

$who = '?';    try { $who   = [Security.Principal.WindowsIdentity]::GetCurrent().Name }     catch {}
$isSys = $false; try { $isSys = [Security.Principal.WindowsIdentity]::GetCurrent().IsSystem } catch {}
Log '=================================================================='
Log "START Kiosk-Installer  (User=$who  SYSTEM=$isSys  PSv=$($PSVersionTable.PSVersion)  CLM=$($ExecutionContext.SessionState.LanguageMode))"
try { Log ('ExecutionPolicy: ' + ((Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" }) -join ', ')) } catch {}

# CLM-feste XML-Maskierung (kein [System.Net.WebUtility] -> laeuft auch im Constrained Language Mode)
function HtmlEnc([string]$s) {
  ($s -replace '&','&amp;') -replace '<','&lt;' -replace '>','&gt;' -replace '"','&quot;' -replace "'",'&apos;'
}

$certPem = @'
-----BEGIN CERTIFICATE-----
MIIDNDCCAhygAwIBAgIUUSAKChkh22SnWG3GIJq/A42vqfwwDQYJKoZIhvcNAQEL
BQAwGTEXMBUGA1UEAwwOc2NodWx6dHZuZW9jbXMwHhcNMjYwNzIyMDU1NzA2WhcN
MzYwNzE5MDU1NzA2WjAZMRcwFQYDVQQDDA5zY2h1bHp0dm5lb2NtczCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBAJN0Q2qXaW66qoXar0/cEMtrG1o+vEMq
mMW+L6V6ASXZvthKGwKLHAy85jiRvhl90FRitseGf57X3+Fol4ZMpgs8LIJEu8b7
OVKSsUfYRXDEhgcR2b3pEzXiUr8tgLGdRTsw7OGpg/wubCoWCoFLtnzPD9vlkzD5
LUpiR3/ebJQcAVOtsGAygvG2G/1g2PYWErnpU6ynAZ6Hf9fWdCCTu1RwASjlV/uh
nZ0UwIn2jj9bUlnAlxFSpbStYTZFmrYzh6vTl4liGyWZ/dykxUWRlza7FC+DE8/1
diwnJo6M4nPbo5YxcWhEOE2clKfkZDjIHZChzaGNBOc5hDBkvrhEk98CAwEAAaN0
MHIwHQYDVR0OBBYEFA1hD8FxCEqX3/XS3P+deEDM1Za5MB8GA1UdIwQYMBaAFA1h
D8FxCEqX3/XS3P+deEDM1Za5MA8GA1UdEwEB/wQFMAMBAf8wHwYDVR0RBBgwFocE
rBEyFIIOc2NodWx6dHZuZW9jbXMwDQYJKoZIhvcNAQELBQADggEBAEDEbWESQq1y
AizpvRgb9+tqfhwm1+PD0O6blEIvBe0dcgSL14HZs6/vvjidtoHcsvIWf4BBlwaq
ymv3QONJyC9ACYFZJdnruvnf7NXvdtTlFX33CVik/6E6gO77MyfIL1cn1yS3cXD1
ySPqwKRTnXjfhEc3+HX8wWiEpa0Wm9XOqzBvnMkGQXgTzmrFd5J4YjVKIZtUFVLQ
AEiRoOTNTs3ZZeSKQuSTYRfcmxq3557roffKyZY+akRofjEtKTbmqWjWhGYZev31
30sTkcFrFHxEiMUO3sJFxFksvhyE5rjOZPCzmnuLgfb1XwdzxM5b0yvLEQhoLh/7
LVYcM+1kQ8M=
-----END CERTIFICATE-----
'@

$aaXml = @'
<?xml version="1.0" encoding="utf-8"?>
<AssignedAccessConfiguration
    xmlns="http://schemas.microsoft.com/AssignedAccess/2017/config"
    xmlns:rs5="http://schemas.microsoft.com/AssignedAccess/201810/config"
    xmlns:v5="http://schemas.microsoft.com/AssignedAccess/2022/config">
  <Profiles>
    <Profile Id="{AFF9DA33-AE89-4039-B646-3603D4225218}">
      <AllAppsList>
        <AllowedApps>
          <App DesktopAppPath="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
               rs5:AutoLaunch="true"
               rs5:AutoLaunchArguments="--kiosk __PLAYER_URL__ --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check --disable-translate --disable-sync --disable-features=msEdgeWelcomePage,TranslateUI,Translate --edge-kiosk-idle-timeout-minutes=0 --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-pinch" />
        </AllowedApps>
      </AllAppsList>
      <v5:StartPins>{"pinnedList":[]}</v5:StartPins>
      <Taskbar ShowTaskbar="false" />
    </Profile>
  </Profiles>
  <Configs>
    <Config>
      <Account>__KIOSK_ACCOUNT__</Account>
      <DefaultProfile Id="{AFF9DA33-AE89-4039-B646-3603D4225218}" />
    </Config>
  </Configs>
</AssignedAccessConfiguration>
'@

try {
  $ErrorActionPreference = 'Stop'

  # 1) CMS-Zertifikat aus eingebettetem PEM importieren
  $certFile = Join-Path $logDir 'opensignage-ca.crt'
  Set-Content -Path $certFile -Value $certPem -Encoding Ascii
  Import-Certificate -FilePath $certFile -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
  Log 'OK   Zertifikat importiert (Trusted Root)'

  # 2+3) Kiosk-Konto und Auto-Logon - BEWUSST verzahnt.
  #
  #  Das Passwort ist zufaellig und niemand kennt es. Wuerde erst das Kontopasswort geaendert
  #  und danach das Schreiben des Auto-Logons scheitern, haette das Geraet ein unbekanntes
  #  Passwort UND keinen automatischen Login -> Kiosk tot, nur vor Ort zu retten.
  #  Deshalb: erst nachweisen, dass der Winlogon-Zweig beschreibbar ist, dann das Passwort
  #  aendern, sofort hinterlegen und zum Schluss gegenlesen.
  $win = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  Set-ItemProperty $win 'AutoAdminLogon'    '1'
  Set-ItemProperty $win 'DefaultUserName'   $KioskAccount
  Set-ItemProperty $win 'DefaultDomainName' $env:COMPUTERNAME
  if ((Get-ItemProperty $win).DefaultUserName -ne $KioskAccount) {
    throw 'Auto-Logon-Zweig nicht beschreibbar - Kontopasswort wurde NICHT geaendert.'
  }

  $sec = ConvertTo-SecureString $KioskPassword -AsPlainText -Force
  if (-not (Get-LocalUser -Name $KioskAccount -ErrorAction SilentlyContinue)) {
    New-LocalUser -Name $KioskAccount -Password $sec -AccountNeverExpires -PasswordNeverExpires -Description 'OpenSignage Kiosk' | Out-Null
    Add-LocalGroupMember -Group 'Users' -Member $KioskAccount -ErrorAction SilentlyContinue
    Log "OK   Kiosk-Konto '$KioskAccount' angelegt"
  } else {
    Set-LocalUser -Name $KioskAccount -Password $sec -PasswordNeverExpires $true
    Log "OK   Kiosk-Konto '$KioskAccount' aktualisiert"
  }

  Set-ItemProperty $win 'DefaultPassword' $KioskPassword
  if ((Get-ItemProperty $win).DefaultPassword -ne $KioskPassword) {
    throw 'Auto-Logon-Passwort konnte nicht hinterlegt werden - Geraet wuerde sich nicht anmelden!'
  }
  Log "OK   Auto-Logon aktiviert fuer '$KioskAccount' (Zufallspasswort, gegengelesen, nicht protokolliert)"
  Log "OK   Geraete-Geheimnis aktiv (Datei: $keyFile)"

  # 4) Assigned Access anwenden (Edge-Vollbild-Kiosk) — braucht SYSTEM-Kontext
  #
  #  ACHTUNG doppelte Kodierung: Die URL steht als XML-ATTRIBUT in der Konfiguration
  #  (rs5:AutoLaunchArguments="--kiosk <URL> ..."). Die ganze Konfiguration wird unten per
  #  HtmlEnc verpackt, Windows packt sie wieder aus - danach stuende ein nacktes '&' aus
  #  "?id=...&k=..." im Attribut und das XML waere ungueltig. Set-CimInstance meldet dann nur
  #  "A general error occurred that is not covered by a more specific error code."
  #  Deshalb das '&' HIER schon maskieren: nach dem Auspacken bleibt "&amp;" stehen und ist gueltig.
  $PlayerUrlXml = $PlayerUrl -replace '&', '&amp;'
  $cfg = $aaXml.Replace('__PLAYER_URL__', $PlayerUrlXml).Replace('__KIOSK_ACCOUNT__', $KioskAccount)
  $ns  = 'root\cimv2\mdm\dmmap'
  $obj = Get-CimInstance -Namespace $ns -ClassName 'MDM_AssignedAccess'
  $obj.Configuration = HtmlEnc $cfg
  Set-CimInstance -CimInstance $obj
  # Das Geraete-Geheimnis NIEMALS ins Protokoll: install.log ist bewusst fuer alle lesbar,
  # sonst koennte jeder Benutzer am Geraet die Display-Identitaet uebernehmen.
  $urlLog = $PlayerUrl -replace '([?&]k=)[^&]*', '$1<verborgen>'
  Log "OK   Assigned Access aktiv (Edge-Kiosk auf $urlLog)"

  # 5) Bildschirm-Zeitsteuerung — BEWUSST ZULETZT und gekapselt.
  #    Der Kiosk ist die Hauptsache, die Zeitsteuerung ist Komfort. Wuerde sie scheitern
  #    (z.B. fehlt das ScheduledTasks-Modul auf einer schlanken LTSC-Installation), darf das
  #    NIEMALS verhindern, dass Konto, Auto-Logon und Assigned Access eingerichtet sind.
  #    Deshalb steht sie NACH dem Kiosk und ihr Fehler wird hier abgefangen.
  try {
  # 3b) Bildschirm-Zeitsteuerung (abends aus, morgens an)
  #
  #  Entwurfsentscheidung - bewusst zweigeteilt:
  #   AUS (abends): Bildsignal abschalten aus der SITZUNG des Kiosk-Kontos. Nur von dort ist der
  #     Bildschirm erreichbar (eine SYSTEM-Aufgabe laeuft in Sitzung 0). Schlaegt das fehl - im
  #     Assigned-Access-Kiosk koennen App-Sperren greifen, und ein laufendes Video haelt den
  #     Bildschirm ohnehin wach - bleibt der Fernseher an. Das ist harmlos.
  #   AN (morgens): NEUSTART als SYSTEM. Der schaltet den Bildschirm garantiert ein, bringt den
  #     Kiosk frisch hoch und braucht weder Sitzung noch Weckzeitgeber. Ein taeglicher Neustart
  #     ist fuer ein Wallboard ohnehin gesunde Hygiene (das Pi-Wallboard machte es genauso).
  #  KEIN Schlafmodus mit Weckzeitgeber: schlaegt der fehl, bliebe der Fernseher den ganzen Tag
  #  dunkel - der schlechteste denkbare Ausfall fuer eine Anzeigetafel.
  if ($DisplayOffTime -and $DisplayOnTime) {
    $offPs = Join-Path $stvDir 'display-off.ps1'
    Set-Content -Path $offPs -Encoding ASCII -Value @'
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int hWnd,int hMsg,int wParam,int lParam);' -Name U -Namespace Stv
# WM_SYSCOMMAND / SC_MONITORPOWER, 2 = aus, HWND_BROADCAST = 0xFFFF
[Stv.U]::SendMessage(0xFFFF, 0x0112, 0xF170, 2) | Out-Null
'@

    # --- AUS: in der Sitzung des Kiosk-Kontos ---
    Unregister-ScheduledTask -TaskName 'OpenSignage Bildschirm aus' -Confirm:$false -ErrorAction SilentlyContinue
    $actOff = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File "{0}"' -f $offPs)
    $trgOff = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($DisplayOffTime, 'HH:mm', $null))
    $prcOff = New-ScheduledTaskPrincipal -UserId $KioskAccount -LogonType Interactive -RunLevel Limited
    $setOff = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName 'OpenSignage Bildschirm aus' -Action $actOff -Trigger $trgOff -Principal $prcOff -Settings $setOff | Out-Null
    Log "OK   Aufgabe 'OpenSignage Bildschirm aus' um $DisplayOffTime Uhr eingerichtet"

    # --- AN: Neustart als SYSTEM (garantiert Bild) ---
    Unregister-ScheduledTask -TaskName 'OpenSignage Bildschirm an' -Confirm:$false -ErrorAction SilentlyContinue
    $actOn = New-ScheduledTaskAction -Execute 'shutdown.exe' -Argument '/r /t 30 /c "OpenSignage: taeglicher Start der Anzeige"'
    $trgOn = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($DisplayOnTime, 'HH:mm', $null))
    $prcOn = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $setOn = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName 'OpenSignage Bildschirm an' -Action $actOn -Trigger $trgOn -Principal $prcOn -Settings $setOn | Out-Null
    Log "OK   Aufgabe 'OpenSignage Bildschirm an' um $DisplayOnTime Uhr eingerichtet (Neustart)"
    Log "OK   Bildschirm-Zeitsteuerung aktiv: aus $DisplayOffTime, an $DisplayOnTime"
  } else {
    Unregister-ScheduledTask -TaskName 'OpenSignage Bildschirm aus' -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'OpenSignage Bildschirm an'  -Confirm:$false -ErrorAction SilentlyContinue
    Log 'OK   Bildschirm-Zeitsteuerung ausgeschaltet (keine Zeiten gesetzt)'
  }
  }
  catch {
    Log "WARNUNG Bildschirm-Zeitsteuerung konnte nicht eingerichtet werden: $($_.Exception.Message)"
    Log "        Der Kiosk laeuft trotzdem - der Fernseher bleibt dann nur durchgehend an."
  }

  # 6) Geraeteagent einrichten — ebenfalls gekapselt, er ist Zusatznutzen.
  #    Er holt jede Minute offene Befehle (Neustart/Herunterfahren) aus dem CMS ab.
  #    Die Webseite im Kiosk kann das nicht; sie kann sich nur selbst neu laden.
  try {
    $agentSrc = Join-Path $PSScriptRoot 'OpenSignage-Agent.ps1'
    if (-not (Test-Path $agentSrc)) { $agentSrc = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'OpenSignage-Agent.ps1' }
    if (Test-Path $agentSrc) {
      $agentDst = Join-Path $stvDir 'OpenSignage-Agent.ps1'
      Copy-Item -Path $agentSrc -Destination $agentDst -Force
      Unregister-ScheduledTask -TaskName 'OpenSignage Geraeteagent' -Confirm:$false -ErrorAction SilentlyContinue
      $aAct = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File "{0}"' -f $agentDst)
      # Ab Systemstart, danach jede Minute - eine kurze Aufgabe, kein Dauerprozess.
      $aTrg = New-ScheduledTaskTrigger -AtStartup
      $aTrg.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::MaxValue)).Repetition
      $aPrc = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
      $aSet = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
      Register-ScheduledTask -TaskName 'OpenSignage Geraeteagent' -Action $aAct -Trigger $aTrg -Principal $aPrc -Settings $aSet | Out-Null
      Start-ScheduledTask -TaskName 'OpenSignage Geraeteagent' -ErrorAction SilentlyContinue
      Log 'OK   Geraeteagent eingerichtet (holt Fernbefehle jede Minute ab)'
    } else {
      Log 'WARNUNG OpenSignage-Agent.ps1 nicht im Paket gefunden - Fernbefehle (Neustart) bleiben wirkungslos.'
    }
  }
  catch {
    Log "WARNUNG Geraeteagent konnte nicht eingerichtet werden: $($_.Exception.Message)"
    Log "        Kiosk laeuft trotzdem - nur Neustart/Herunterfahren aus dem CMS gehen dann nicht."
  }

  Log 'FERTIG  Nach dem Neustart: Auto-Logon -> Edge-Kiosk.'
  exit 0
}
catch {
  Log "FEHLER [OPENSIGNAGE-KIOSK] $($_.Exception.Message)"
  Log "       @ $($_.InvocationInfo.PositionMessage)"
  exit 1
}
