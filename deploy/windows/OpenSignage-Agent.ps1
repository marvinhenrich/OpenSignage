<#
  OpenSignage — Geraeteagent

  ZWECK: Der Player ist eine Webseite. Sie kann sich neu laden, aber den Rechner nicht
  neu starten. Im Edge-Kiosk gibt es keine OS-Bruecke, deshalb verpufften Neustart,
  Herunterfahren und Screenshot aus dem CMS. Dieser Agent holt solche Befehle ab und
  fuehrt sie aus.

  BETRIEB: geplante Aufgabe unter SYSTEM, laeuft jede Minute, beendet sich sofort wieder.
  Kein Dienst, kein Dauerprozess - faellt er aus, passiert schlicht nichts.

  SICHERHEIT (der Agent kann Rechner neu starten - hier wird bewusst konservativ gehandelt):
   - Der Server liefert jeden Befehl GENAU EINMAL aus und verwirft ihn nach 5 Minuten.
   - Zusaetzlich merkt sich der Agent lokal die zuletzt ausgefuehrten Vorgangsnummern.
   - Sperre: hoechstens EIN Neustart/Herunterfahren je 10 Minuten. Selbst wenn Server oder
     Netz Unsinn liefern, kann daraus keine Dauerschleife werden.
   - Ohne Geraete-Geheimnis oder ohne Antwort des CMS wird NICHTS ausgefuehrt.

  Protokoll: C:\ProgramData\OpenSignage\agent.log
#>
$ErrorActionPreference = 'Stop'

$Base    = 'https://signage.example.local'
$stvDir  = 'C:\ProgramData\OpenSignage'
$log     = Join-Path $stvDir 'agent.log'
$keyFile = Join-Path $stvDir 'device.key'
$doneFile = Join-Path $stvDir 'agent-done.txt'    # zuletzt ausgefuehrte Vorgaenge
$lockFile = Join-Path $stvDir 'agent-lastboot.txt' # Zeitpunkt des letzten Neustartbefehls

$MIN_SECONDS_BETWEEN_REBOOTS = 600

function Log($m) {
  try {
    Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 -ErrorAction SilentlyContinue
    # Protokoll klein halten
    $fi = Get-Item $log -ErrorAction SilentlyContinue
    if ($fi -and $fi.Length -gt 512000) { Set-Content -Path $log -Value (Get-Content $log -Tail 500) -Encoding UTF8 }
  } catch {}
}

<#
  Neustart/Herunterfahren mit harter Sperre.
  Selbst wenn Server, Netz oder eine kuenftige Aenderung Unsinn liefern, kann daraus keine
  Dauerschleife werden: hoechstens EIN Vorgang je 10 Minuten. Der Zeitstempel liegt auf der
  Platte, ueberlebt also auch den Neustart selbst.
#>
function Invoke-PowerAction {
  param([string]$Kind, [string]$Id)
  $now = [int64]([DateTimeOffset]::UtcNow).ToUnixTimeSeconds()
  if (Test-Path $lockFile) {
    $last = 0
    try { $last = [int64]((Get-Content -Raw $lockFile).Trim()) } catch { $last = 0 }
    $age = $now - $last
    if ($age -ge 0 -and $age -lt $MIN_SECONDS_BETWEEN_REBOOTS) {
      throw "Gesperrt: letzter Neustart vor $age s, Mindestabstand $MIN_SECONDS_BETWEEN_REBOOTS s."
    }
  }
  Set-Content -Path $lockFile -Value $now -Encoding ASCII
  $arg = if ($Kind -eq 'r') { '/r' } else { '/s' }
  # 20 s Vorlauf: die Rueckmeldung ans CMS geht noch raus, bevor der Rechner geht.
  Start-Process -FilePath 'shutdown.exe' -ArgumentList "$arg /t 20 /c ""OpenSignage: Fernbefehl aus dem CMS ($Id)""" -NoNewWindow
  return $true
}

try {
  if (-not (Test-Path $keyFile)) { exit 0 }          # kein Geheimnis -> nichts tun
  $deviceKey = (Get-Content -Raw $keyFile).Trim()
  if (-not $deviceKey) { exit 0 }
  $hwKey = $env:COMPUTERNAME.ToLower() -replace '[^a-z0-9_-]', ''

  $url = "$Base/api/player/os-commands?key=$hwKey&k=$deviceKey"
  # -UseBasicParsing: auf LTSC ohne Internet-Explorer-Engine sonst Fehler.
  $res = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 20 -UseBasicParsing
  $cmds = @($res.commands)
  if ($cmds.Count -eq 0) { exit 0 }

  $done = @()
  if (Test-Path $doneFile) { $done = @(Get-Content $doneFile -ErrorAction SilentlyContinue) }

  foreach ($c in $cmds) {
    if (-not $c.id -or ($done -contains $c.id)) { continue }
    $ok = $false; $err = ''

    try {
      switch ($c.code) {
        'REBOOT'   { $ok = Invoke-PowerAction -Kind 'r' -Id $c.id }
        'SHUTDOWN' { $ok = Invoke-PowerAction -Kind 's' -Id $c.id }
        'SCREENSHOT' {
          $err = 'Screenshot ist aus dem Systemkontext nicht moeglich (der Bildschirm gehoert der angemeldeten Sitzung).'
          $ok = $false
        }
        default { $err = "Unbekannter Befehl: $($c.code)"; $ok = $false }
      }
    } catch {
      $ok = $false; $err = $_.Exception.Message
    }

    # Vorgang lokal als erledigt vermerken (auch bei Fehlschlag - nicht endlos wiederholen)
    $done += $c.id
    Set-Content -Path $doneFile -Value ($done | Select-Object -Last 50) -Encoding ASCII

    # Rueckmeldung ans CMS - damit im Display-Protokoll steht, was passiert ist
    try {
      $body = @{ key = $hwKey; deviceKey = $deviceKey; id = $c.id; code = $c.code; ok = $ok }
      if ($err) { $body.error = $err }
      Invoke-RestMethod -Uri "$Base/api/player/os-commands/ack" -Method Post -TimeoutSec 20 -UseBasicParsing `
        -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) | Out-Null
    } catch { Log "Rueckmeldung fehlgeschlagen: $($_.Exception.Message)" }

    Log ("{0} {1} (Vorgang {2}){3}" -f $c.code, $(if ($ok) { 'ausgefuehrt' } else { 'NICHT ausgefuehrt' }), $c.id, $(if ($err) { " - $err" } else { '' }))
  }
}
catch {
  Log "FEHLER $($_.Exception.Message)"
  exit 0   # nie mit Fehler enden - die Aufgabe soll nicht als gestoert gelten
}
