# Weekly copy of the live database to E: (plan 11.82).
#
#   powershell -ExecutionPolicy Bypass -File scripts\backup_db.ps1
#
# Supabase's free plan keeps no backups you can download, so this saves one:
# the structure, every table's rows (the app's own schemas and accounts), and
# the roles, into E:\sunday-line-backups\<date>\. Keeps the newest 8.
# Uses the Supabase CLI's login on this computer: no password is stored here.
# Photos in Storage aren't included (only their rows).
# Run weekly by the Windows task "Sunday Line database backup".

# The CLI writes progress to stderr; PowerShell 5.1 would treat that as an error.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$root = "E:\sunday-line-backups"
$dir = Join-Path $root (Get-Date -Format "yyyy-MM-dd")
New-Item -ItemType Directory -Force $dir | Out-Null
$log = Join-Path $root "backup.log"

function Write-Log($msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Out-File -Append -Encoding utf8 $log
}

Set-Location $repo
$steps = @(
  @{ name = "schema.sql"; args = @() },
  @{ name = "data.sql"; args = @("--data-only", "--use-copy", "--schema", "public,private") },
  @{ name = "auth-data.sql"; args = @("--data-only", "--use-copy", "--schema", "auth") },
  @{ name = "roles.sql"; args = @("--role-only") }
)
$failed = $false
foreach ($s in $steps) {
  $file = Join-Path $dir $s.name
  $out = Join-Path $dir "$($s.name).log"
  cmd /c "npx supabase db dump --remote -f `"$file`" $($s.args -join ' ') > `"$out`" 2>&1"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $file) -or (Get-Item $file).Length -eq 0) {
    Write-Log "FAILED: $($s.name) (see $dir\$($s.name).log)"
    $failed = $true
  } else {
    Remove-Item (Join-Path $dir "$($s.name).log")
    Write-Log "saved $($s.name), $([math]::Round((Get-Item $file).Length / 1KB)) KB"
  }
}

# Keep the newest 8 dated folders.
Get-ChildItem $root -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } |
  Sort-Object Name -Descending | Select-Object -Skip 8 | Remove-Item -Recurse -Force

if ($failed) { exit 1 }
Write-Log "backup done: $dir"
