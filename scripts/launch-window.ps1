param([ValidateSet('claude','codex')][string]$Client, [string]$Root, [string]$Node)
$ErrorActionPreference = 'Stop'
function Quote-Literal([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$scriptPath = Join-Path $Root 'scripts/client.mjs'
if (!(Test-Path -LiteralPath $scriptPath) -or !(Test-Path -LiteralPath $Node)) { throw 'launcher_missing' }
$command = '$Host.UI.RawUI.WindowTitle = ' + (Quote-Literal ('Astra1 - ' + $Client)) + '; & ' +
  (Quote-Literal $Node) + ' ' + (Quote-Literal $scriptPath) + ' ' + (Quote-Literal $Client)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
# This is the interactive terminal explicitly requested by the user.
$terminal = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand',$encoded) -WorkingDirectory $Root -WindowStyle Normal -PassThru
$terminal.Id
