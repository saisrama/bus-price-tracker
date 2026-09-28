param([string]$TaskName = 'Bus Fare Tracker')

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$entry = Join-Path $projectRoot 'src\index.mjs'
if (-not (Test-Path -LiteralPath $entry)) { throw "Tracker entry file missing: $entry" }

$action = New-ScheduledTaskAction -Execute $nodeCommand.Source -Argument ('"' + $entry + '"') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Collects Bengaluru–Hyderabad Volvo and Scania fares and serves the local graph dashboard.' -Force
Write-Output "Installed task: $TaskName. It starts when $env:USERNAME logs in."
