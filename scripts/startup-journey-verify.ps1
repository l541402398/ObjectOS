# Preserve this task's evidence separately from the approved previous UI sweep.
param([switch]$VisualRecheck)
$ErrorActionPreference = 'Continue'
$verificationRoot = Join-Path (Get-Location) 'docs/design/startup-journey/validation'
New-Item -ItemType Directory -Force -Path $verificationRoot | Out-Null
$verificationSteps = @(
  @{Name='lint'; Program='pnpm'; Arguments=@('lint')},
  @{Name='typecheck'; Program='pnpm'; Arguments=@('typecheck')},
  @{Name='test'; Program='pnpm'; Arguments=@('test')},
  @{Name='build'; Program='pnpm'; Arguments=@('build')},
  @{Name='desktop-e2e'; Program='node'; Arguments=@('scripts/e2e.mjs')},
  @{Name='agent-e2e'; Program='node'; Arguments=@('scripts/agent-e2e.mjs')},
  @{Name='v12-e2e'; Program='node'; Arguments=@('scripts/v12-e2e.mjs')},
  @{Name='v13-e2e'; Program='node'; Arguments=@('scripts/v13-e2e.mjs')},
  @{Name='startup-journey'; Program='node'; Arguments=@('scripts/startup-journey-e2e.mjs')},
  @{Name='startup-recording'; Program='node'; Arguments=@('scripts/startup-journey-recording.mjs')},
  @{Name='package-dir'; Program='pnpm'; Arguments=@('package:dir')},
  @{Name='package-smoke'; Program='pnpm'; Arguments=@('test:package')}
)
if ($VisualRecheck) {
  $verificationSteps = @(
    @{Name='package-dir'; Program='pnpm'; Arguments=@('package:dir')},
    @{Name='startup-journey'; Program='node'; Arguments=@('scripts/startup-journey-e2e.mjs')},
    @{Name='startup-recording'; Program='node'; Arguments=@('scripts/startup-journey-recording.mjs')},
    @{Name='package-smoke'; Program='pnpm'; Arguments=@('test:package')}
  )
}
$verificationResults = @()
foreach ($verificationStep in $verificationSteps) {
  $verificationStart = Get-Date
  $verificationLogName = $(if ($VisualRecheck) {'final-'}) + $verificationStep.Name + '.txt'
  $verificationLog = Join-Path $verificationRoot $verificationLogName
  Write-Output ('START ' + $verificationStep.Name)
  $verificationProgram = $verificationStep.Program
  $verificationArguments = $verificationStep.Arguments
  & $verificationProgram @verificationArguments *> $verificationLog
  $verificationExit = $LASTEXITCODE
  $verificationResults += [pscustomobject]@{
    name=$verificationStep.Name
    command=($verificationProgram + ' ' + ($verificationArguments -join ' '))
    status=$(if ($verificationExit -eq 0) {'PASS'} else {'FAIL'})
    exitCode=$verificationExit
    startedAt=$verificationStart.ToUniversalTime().ToString('o')
    durationSeconds=[math]::Round(((Get-Date)-$verificationStart).TotalSeconds,2)
    log=$verificationLogName
  }
  $verificationResults | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $verificationRoot $(if ($VisualRecheck) {'rechecks.json'} else {'checks.json'})) -Encoding utf8
  Write-Output ('END ' + $verificationStep.Name + ' ' + $verificationExit)
}
if (@($verificationResults | Where-Object status -eq 'FAIL').Count -gt 0) { exit 1 }
