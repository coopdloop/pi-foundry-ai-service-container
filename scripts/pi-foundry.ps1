# pi-foundry launcher for Windows (Windows PowerShell 5.1 or PowerShell 7+).
# Usually started through pi-foundry.cmd in the repo root, so execution
# policy never gets in the way. Run it from any project directory; that
# directory becomes /workspace in the container.
#
#   pi-foundry [pi args]       start pi (or doctor, login, models, shell, ...)
#   pi-foundry build           build the image with the newest pi
#   pi-foundry rebuild         rebuild everything from scratch
#   pi-foundry update          git pull this repo, then build
#   pi-foundry install         add pi-foundry to your user PATH

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Compose = Join-Path $Repo 'compose.yaml'
$Package = '@earendil-works/pi-coding-agent'

function Get-LatestPiVersion {
    try {
        (Invoke-RestMethod -Uri 'https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/latest' -TimeoutSec 30).version
    } catch {
        Write-Warning "Could not resolve the latest $Package; building with 'latest'."
        'latest'
    }
}

function Set-GitConfigHost {
    if (-not $env:GIT_CONFIG_HOST) {
        $gc = Join-Path $HOME '.gitconfig'
        if (Test-Path -LiteralPath $gc -PathType Leaf) { $env:GIT_CONFIG_HOST = $gc }
        else { $env:GIT_CONFIG_HOST = Join-Path $Repo 'config\empty.gitconfig' }
    }
}

function Invoke-Build([string[]] $Extra) {
    $version = $env:PI_VERSION
    if (-not $version -or $version -eq 'latest') { $version = Get-LatestPiVersion }
    Write-Host "Building pi-foundry with $Package@$version"
    $env:PI_VERSION = $version
    Set-GitConfigHost
    & docker compose --project-directory $Repo -f $Compose build @Extra pi
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $env:FOUNDRY_QUIET = '1'
    & docker compose --project-directory $Repo -f $Compose run --rm -T --no-deps pi version
    exit $LASTEXITCODE
}

$command = if ($args.Count -gt 0) { [string]$args[0] } else { '' }
$rest = @()
if ($args.Count -gt 1) { $rest = @($args[1..($args.Count - 1)]) }

switch ($command) {
    'build'   { Invoke-Build $rest }
    'rebuild' { Invoke-Build (@('--pull', '--no-cache') + $rest) }
    'update'  {
        & git -C $Repo pull --ff-only
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Invoke-Build $rest
    }
    'install' {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $parts = @()
        if ($userPath) { $parts = $userPath -split ';' | Where-Object { $_ } }
        if ($parts -contains $Repo) {
            Write-Host "$Repo is already on your user PATH."
        } else {
            [Environment]::SetEnvironmentVariable('Path', (($parts + $Repo) -join ';'), 'User')
            Write-Host "Added $Repo to your user PATH. Open a new terminal, then run: pi-foundry"
        }
        exit 0
    }
}

# Run pi in the current directory.
$env:PI_WORKSPACE = (Get-Location).ProviderPath
$env:HOST_OS = 'windows'
Set-GitConfigHost

$ttyArgs = @()
if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { $ttyArgs = @('-T') }

& docker compose --project-directory $Repo -f $Compose run --rm @ttyArgs pi @args
exit $LASTEXITCODE
