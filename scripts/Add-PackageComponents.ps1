param(
    [string]$TargetOrg = "LogicLearn",
    [string]$PackageName = "LogicLearn",
    [int]$WaitMinutes = 30
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$metadataRoot = Join-Path $repositoryRoot "force-app\main\default"
$excludedDirectories = @("email", "settings")

if (-not (Test-Path -LiteralPath $metadataRoot)) {
    throw "Metadata root not found: $metadataRoot"
}

$sourceDirectories = Get-ChildItem -LiteralPath $metadataRoot -Directory |
    Where-Object { $_.Name -notin $excludedDirectories } |
    Select-Object -ExpandProperty FullName

if (@($sourceDirectories).Count -eq 0) {
    throw "No package source directories were found."
}

$buildDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("logiclearn-package-" + [guid]::NewGuid().ToString("N"))
$verifyDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("logiclearn-package-verify-" + [guid]::NewGuid().ToString("N"))

$convertArguments = @(
    "project", "convert", "source",
    "--output-dir", $buildDirectory,
    "--package-name", $PackageName
)

foreach ($sourceDirectory in $sourceDirectories) {
    $convertArguments += @("--source-dir", $sourceDirectory)
}

Write-Host "Building package metadata without email templates, email folders, or org settings..."
& sf @convertArguments
if ($LASTEXITCODE -ne 0) {
    throw "Source conversion failed."
}

$buildManifest = Join-Path $buildDirectory "package.xml"
[xml]$buildXml = Get-Content -Raw -LiteralPath $buildManifest
$buildNamespace = [System.Xml.XmlNamespaceManager]::new($buildXml.NameTable)
$buildNamespace.AddNamespace("m", "http://soap.sforce.com/2006/04/metadata")
if ($null -ne $buildXml.SelectSingleNode("//m:types[m:name='EmailTemplate']", $buildNamespace)) {
    throw "The generated package unexpectedly contains EmailTemplate metadata."
}

Write-Host "Adding or updating components in managed 1GP package '$PackageName'..."
& sf project deploy start `
    --metadata-dir $buildDirectory `
    --target-org $TargetOrg `
    --wait $WaitMinutes
if ($LASTEXITCODE -ne 0) {
    throw "Package component deployment failed. Build retained at $buildDirectory"
}

Write-Host "Retrieving the named package to verify membership..."
& sf project retrieve start `
    --package-name $PackageName `
    --target-org $TargetOrg `
    --target-metadata-dir $verifyDirectory `
    --unzip `
    --wait $WaitMinutes
if ($LASTEXITCODE -ne 0) {
    throw "Named-package verification retrieve failed."
}

$retrievedManifest = Get-ChildItem -LiteralPath $verifyDirectory -Recurse -Filter package.xml |
    Where-Object { $_.DirectoryName -like "*$PackageName" } |
    Select-Object -First 1
if ($null -eq $retrievedManifest) {
    throw "The retrieved named-package manifest wasn't found under $verifyDirectory"
}

[xml]$retrievedXml = Get-Content -Raw -LiteralPath $retrievedManifest.FullName
$retrievedNamespace = [System.Xml.XmlNamespaceManager]::new($retrievedXml.NameTable)
$retrievedNamespace.AddNamespace("m", "http://soap.sforce.com/2006/04/metadata")
$emailType = $retrievedXml.SelectSingleNode("//m:types[m:name='EmailTemplate']", $retrievedNamespace)
if ($null -ne $emailType) {
    throw "Verification failed: the managed package contains email templates or an email folder."
}

Write-Host "Package components updated and verified."
Write-Host "Build: $buildDirectory"
Write-Host "Verification: $($retrievedManifest.FullName)"
