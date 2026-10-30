# All checks use isolated fixtures. Native desktop checks intentionally run one at a time.
param([switch]$FinalRecheck)
$ErrorActionPreference = 'Continue'
$validationRoot = Join-Path (Get-Location) 'docs/design/system-premium/validation'
New-Item -ItemType Directory -Force -Path $validationRoot | Out-Null
$verificationSteps = @(
  @{Name='lint'; Program='pnpm'; Arguments=@('lint')},
  @{Name='typecheck'; Program='pnpm'; Arguments=@('typecheck')},
  @{Name='test'; Program='pnpm'; Arguments=@('test')},
  @{Name='build'; Program='pnpm'; Arguments=@('build')},
  @{Name='desktop-e2e'; Program='node'; Arguments=@('scripts/e2e.mjs')},
  @{Name='agent-e2e'; Program='node'; Arguments=@('scripts/agent-e2e.mjs')},
  @{Name='v12-e2e'; Program='node'; Arguments=@('scripts/v12-e2e.mjs')},
  @{Name='v13-e2e'; Program='node'; Arguments=@('scripts/v13-e2e.mjs')},
  @{Name='premium-lab'; Program='node'; Arguments=@('scripts/premium-lab-e2e.mjs')},
  @{Name='premium-usability'; Program='node'; Arguments=@('scripts/premium-usability-e2e.mjs')},
  @{Name='premium-readiness'; Program='node'; Arguments=@('scripts/premium-readiness-e2e.mjs')},
  @{Name='premium-system'; Program='node'; Arguments=@('scripts/premium-system-ui.mjs')},
  @{Name='premium-overlays'; Program='node'; Arguments=@('scripts/premium-overlays-e2e.mjs')},
  @{Name='premium-walkthrough'; Program='node'; Arguments=@('scripts/premium-walkthrough.mjs')},
  @{Name='package-dir'; Program='pnpm'; Arguments=@('package:dir')},
  @{Name='package-smoke'; Program='pnpm'; Arguments=@('test:package')}
)
if ($FinalRecheck) {
  $verificationSteps = $verificationSteps | Where-Object { $_.Name -notin @('desktop-e2e', 'agent-e2e', 'v12-e2e') }
  $verificationSteps = $verificationSteps | ForEach-Object {
    if ($_.Name -eq 'premium-system') { $_.Arguments = @('scripts/premium-system-ui.mjs', '--route=approvals,overview,agents,knowledge', '--settings=0', '--update-evidence') }
    $_
  }
}
$verificationResults = @()
foreach ($verificationStep in $verificationSteps) {
  $verificationStart = Get-Date
  $verificationLogName = $(if ($FinalRecheck) {'final-'}) + $verificationStep.Name + '.txt'
  $verificationLog = Join-Path $validationRoot $verificationLogName
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
  $verificationResults | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $validationRoot $(if ($FinalRecheck) {'rechecks.json'} else {'checks.json'})) -Encoding utf8
  Write-Output ('END ' + $verificationStep.Name + ' ' + $verificationExit)
}
if (@($verificationResults | Where-Object status -eq 'FAIL').Count -gt 0) { exit 1 }
