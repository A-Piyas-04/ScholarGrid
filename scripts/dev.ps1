# Start the ScholarGrid API (port 8000) and web app (port 3000) for local development.
#   ./scripts/dev.ps1            # both, each in its own window
#   ./scripts/dev.ps1 -Install   # first run: install Python and Node dependencies first
param([switch]$Install)

$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Creating the Python virtual environment (.venv)..."
    python -m venv (Join-Path $root ".venv")
    $Install = $true
}
if ($Install) {
    & $py -m pip install -r (Join-Path $root "requirements.txt")
    Push-Location (Join-Path $root "web"); npm install; Pop-Location
}

Write-Host "Starting the API on http://127.0.0.1:8000 (loads the research collection; ~40 s)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; & '$py' -m scholargrid.api"
Write-Host "Starting the web app on http://localhost:3000 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\web'; npm run dev"
Start-Sleep -Seconds 6
Start-Process "http://localhost:3000"
