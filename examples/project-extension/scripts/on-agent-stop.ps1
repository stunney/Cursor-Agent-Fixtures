param(
  [Parameter(ValueFromPipeline = $true)]
  [string]$InputObject
)

$payloadJson = $InputObject
if (-not $payloadJson) {
  $payloadJson = [Console]::In.ReadToEnd()
}

$payload = $null
if ($payloadJson) {
  try { $payload = $payloadJson | ConvertFrom-Json } catch { $payload = $null }
}

$dryRun = $env:AGENT_FIXTURES_DRY_RUN -eq "1" -or ($payload -and $payload.dryRun -eq $true)
$hook = if ($payload) { $payload.hook } else { $null }
$event = if ($hook) { $hook.hook_event_name } else { "unknown" }
$status = if ($hook -and $hook.status) { $hook.status } else { "unknown" }
$conversationId = if ($hook -and $hook.conversation_id) { $hook.conversation_id } elseif ($hook -and $hook.session_id) { $hook.session_id } else { "unknown" }
$subagentId = if ($hook -and $hook.subagent_id) { $hook.subagent_id } else { "parent" }
$subagentType = if ($hook -and $hook.subagent_type) { $hook.subagent_type } else { "parent" }
$modified = if ($hook -and $hook.modified_files) { @($hook.modified_files).Count } else { 0 }
$line = "[on-agent-stop] event=$event status=$status conversation=$conversationId subagent=$subagentId type=$subagentType modifiedFiles=$modified dryRun=$dryRun"

Write-Output $line
Write-Output "workspace=$($payload.workspaceRoot)"

if ($dryRun) {
  Write-Output "Would append this stop event to state/lifecycle.log"
  exit 0
}

$stateDir = Join-Path $payload.projectExtensionDir "state"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
Add-Content -Path (Join-Path $stateDir "lifecycle.log") -Value ("{0} {1}" -f (Get-Date -Format "o"), $line)
Write-Output "Recorded stop event in state/lifecycle.log"
exit 0
