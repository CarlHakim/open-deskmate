# Kill Openwork and related processes
$processes = Get-Process | Where-Object { $_.ProcessName -match 'Openwork|electron|chrome' -and $_.Path -like '*accomplish*' }
if ($processes) {
    $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "Killed processes"
} else {
    Write-Host "No matching processes found"
}
Start-Sleep -Seconds 3
Write-Host "Done"
