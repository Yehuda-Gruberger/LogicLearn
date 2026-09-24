param(
    [string]$TargetOrg = "LogicLearn",
    [string]$ExpectedNamespace = "logiclearn"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$projectFile = Join-Path $repositoryRoot "sfdx-project.json"
$packageConfigFile = Join-Path $repositoryRoot "config\package1.json"
$manifestFile = Join-Path $repositoryRoot "manifest\package.xml"
$sourceRoot = Join-Path $repositoryRoot "force-app"
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

if (-not (Test-Path -LiteralPath $projectFile)) {
    throw "sfdx-project.json was not found at $projectFile"
}

$project = Get-Content -Raw -LiteralPath $projectFile | ConvertFrom-Json
$packageConfig = Get-Content -Raw -LiteralPath $packageConfigFile | ConvertFrom-Json
$packageDirectory = @($project.packageDirectories) | Where-Object { $_.path -eq "force-app" } | Select-Object -First 1

if ($null -eq $packageDirectory) {
    $failures.Add("The force-app package source directory is missing from sfdx-project.json.")
}

if ([string]::IsNullOrWhiteSpace([string]$project.namespace)) {
    $failures.Add("The project namespace is blank. Register '$ExpectedNamespace' in the packaging org before setting it.")
} elseif ($project.namespace -ne $ExpectedNamespace) {
    $failures.Add("The project namespace is '$($project.namespace)', not '$ExpectedNamespace'.")
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$orgJson = & sf data query --query "SELECT NamespacePrefix FROM Organization" --target-org $TargetOrg --json 2>$null
$orgQueryExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($orgQueryExitCode -ne 0) {
    $failures.Add("The packaging org '$TargetOrg' couldn't be queried.")
} else {
    $orgResult = $orgJson | ConvertFrom-Json
    $orgNamespace = [string]$orgResult.result.records[0].NamespacePrefix
    if ([string]::IsNullOrWhiteSpace($orgNamespace)) {
        $failures.Add("The packaging org has no registered namespace.")
    } elseif ($orgNamespace -ne $ExpectedNamespace) {
        $failures.Add("The packaging org namespace is '$orgNamespace', not '$ExpectedNamespace'.")
    }
}

$ErrorActionPreference = "Continue"
$packageJson = & sf data query --use-tooling-api --query "SELECT Id, Name, NamespacePrefix FROM MetadataPackage WHERE Name = 'LogicLearn'" --target-org $TargetOrg --json 2>$null
$packageQueryExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($packageQueryExitCode -ne 0) {
    $failures.Add("The 1GP package list couldn't be queried from '$TargetOrg'.")
} else {
    $packageResult = $packageJson | ConvertFrom-Json
    $packages = @($packageResult.result.records)
    if ($packages.Count -eq 0) {
        $failures.Add("The LogicLearn 1GP package hasn't been created in Package Manager.")
    } else {
        $orgPackageId = [string]$packages[0].Id
        if ([string]::IsNullOrWhiteSpace([string]$packageConfig.packageId)) {
            $failures.Add("Record the package ID '$orgPackageId' in config/package1.json.")
        } elseif ($packageConfig.packageId -ne $orgPackageId) {
            $failures.Add("config/package1.json contains '$($packageConfig.packageId)', but the org package ID is '$orgPackageId'.")
        }
    }
}

if (-not (Test-Path -LiteralPath $sourceRoot)) {
    $failures.Add("The force-app source directory is missing.")
}

if (-not (Test-Path -LiteralPath $manifestFile)) {
    $failures.Add("manifest/package.xml is missing.")
} else {
    [xml]$packageManifest = Get-Content -Raw -LiteralPath $manifestFile
    $manifestNamespace = [System.Xml.XmlNamespaceManager]::new($packageManifest.NameTable)
    $manifestNamespace.AddNamespace("m", "http://soap.sforce.com/2006/04/metadata")
    $emailTemplateType = $packageManifest.SelectSingleNode("//m:types[m:name='EmailTemplate']", $manifestNamespace)
    if ($null -ne $emailTemplateType) {
        $failures.Add("Email templates and email folders are subscriber-managed and must not be listed in manifest/package.xml.")
    }
}

$sensitivePatterns = @(
    "/lightning/n/Training_Library",
    '"apiName":"Training_Library"',
    'objectApiName: "Training_Video__c"'
)

$sourceFiles = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object {
    $_.Extension -in ".cls", ".trigger", ".js", ".html", ".xml", ".email"
}

foreach ($pattern in $sensitivePatterns) {
    $matches = $sourceFiles | Select-String -SimpleMatch -Pattern $pattern
    foreach ($match in $matches) {
        if ($match.Line.TrimStart().StartsWith("//")) {
            continue
        }
        $relativePath = $match.Path.Substring($repositoryRoot.Length).TrimStart("\", "/")
        $warnings.Add("Namespace-sensitive literal at ${relativePath}:$($match.LineNumber): $($match.Line.Trim())")
    }
}

$gitStatus = & git -C $repositoryRoot status --porcelain
if ($LASTEXITCODE -ne 0) {
    $warnings.Add("Git status couldn't be read.")
} elseif ($gitStatus) {
    $warnings.Add("The worktree is not clean. Upload only a tested, recorded source snapshot.")
}

Write-Host "LogicLearn managed 1GP readiness"
Write-Host "Packaging org: $TargetOrg"
Write-Host "Namespace expected: $ExpectedNamespace"
Write-Host ""

if ($warnings.Count -gt 0) {
    Write-Host "Warnings:"
    foreach ($warning in $warnings) {
        Write-Host "  - $warning"
    }
    Write-Host ""
}

if ($failures.Count -gt 0) {
    Write-Host "Blocking setup items:"
    foreach ($failure in $failures) {
        Write-Host "  - $failure"
    }
    exit 1
}

Write-Host "The repository and packaging org have the minimum managed 1GP configuration. Resolve warnings before upload."
