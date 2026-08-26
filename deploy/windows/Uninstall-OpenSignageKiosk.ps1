<#
  OpenSignage — Kiosk entfernen (silent). Hebt Assigned Access auf und entfernt das Kiosk-Konto.
#>
param([string]$KioskAccount = 'kiosk')
$ErrorActionPreference = 'SilentlyContinue'

# Assigned Access zurücksetzen
$ns = 'root\cimv2\mdm\dmmap'
$obj = Get-CimInstance -Namespace $ns -ClassName 'MDM_AssignedAccess'
if ($obj) { $obj.Configuration = ''; Set-CimInstance -CimInstance $obj }

# Alternativ per eingebautem Cmdlet (je nach Build)
Clear-AssignedAccess -ErrorAction SilentlyContinue

# Auto-Logon zurücksetzen
$win = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty $win 'AutoAdminLogon' '0' -ErrorAction SilentlyContinue
Remove-ItemProperty $win 'DefaultPassword' -ErrorAction SilentlyContinue

# Kiosk-Konto entfernen
Remove-LocalUser -Name $KioskAccount -ErrorAction SilentlyContinue

Write-Host 'OpenSignage Kiosk entfernt. Neustart empfohlen.'
