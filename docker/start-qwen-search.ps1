[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$LlamaServer,
    [Parameter(Mandatory)][string]$Model,
    [Parameter(Mandatory)][string]$Projector,
    [Parameter(Mandatory)][string]$LogDirectory,
    [string]$ApiKeyFile,
    [ValidateRange(1024, 65535)][int]$Port = 28083
)

$ErrorActionPreference = 'Stop'
$binaryPath = (Resolve-Path -LiteralPath $LlamaServer).Path
$modelPath = (Resolve-Path -LiteralPath $Model).Path
$projectorPath = (Resolve-Path -LiteralPath $Projector).Path
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use. Stop the existing service or choose another port."
}
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$logPath = (Resolve-Path -LiteralPath $LogDirectory).Path
$launchArguments = @(
    '--model', $modelPath, '--mmproj', $projectorPath,
    '--alias', 'Qwen3-VL-Embedding-2B', '--embedding', '--pooling', 'last',
    '--ctx-size', '2048', '--batch-size', '2048', '--ubatch-size', '2048',
    '--parallel', '1', '--n-gpu-layers', '99', '--flash-attn', 'on',
    '--image-max-tokens', '1024', '--host', '127.0.0.1', '--port', "$Port",
    '--no-webui', '--no-warmup'
)
if ($ApiKeyFile) {
    $launchArguments += @('--api-key-file', (Resolve-Path -LiteralPath $ApiKeyFile).Path)
}
# Start-Process joins arguments on Windows; preserve spaces in file paths.
$quotedArguments = $launchArguments | ForEach-Object { '"{0}"' -f $_ }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$process = Start-Process -FilePath $binaryPath -ArgumentList $quotedArguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logPath "$stamp.stdout.log") `
    -RedirectStandardError (Join-Path $logPath "$stamp.stderr.log")
[pscustomobject]@{ ProcessId = $process.Id; HealthUrl = "http://127.0.0.1:$Port/health"; LogDirectory = $logPath }
