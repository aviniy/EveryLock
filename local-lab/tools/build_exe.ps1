$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $projectRoot "release"
$workRoot = Join-Path $projectRoot ".pyinstaller"

python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --windowed `
  --name EveryLock `
  --distpath $outputRoot `
  --workpath (Join-Path $workRoot "build") `
  --specpath $workRoot `
  (Join-Path $PSScriptRoot "everylock_gui.py")

Write-Host "Built: $(Join-Path $outputRoot 'EveryLock.exe')"
