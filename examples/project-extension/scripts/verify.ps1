param(
  [Parameter(ValueFromPipeline = $true)]
  [string]$InputObject
)

$payload = $InputObject
if (-not $payload) {
  $payload = [Console]::In.ReadToEnd()
}

$dryRun = $env:AGENT_FIXTURES_DRY_RUN -eq "1"
Write-Output "[verify.ps1] dryRun=$dryRun"
Write-Output "Received hook payload length: $($payload.Length)"
Write-Output "Would run project-specific verify commands here."
exit 0
