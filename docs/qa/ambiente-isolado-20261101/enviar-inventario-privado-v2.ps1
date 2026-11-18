# Preparado para revisao. Nao executa workflow, nao publica site e nao altera o login global do gh.
# Envia somente os cinco payloads aprovados; o workflow deve existir, criado pela UI, com hash exato.
$ErrorActionPreference = 'Stop'
$repoName = 'harresoncoelho-lang/licitaplena-homologacao'
$accountName = 'harresoncoelho-lang'
$packageRoot = Join-Path $PSScriptRoot 'executor'
$expectedHeadSha = 'e850f39c9a52bd74f5b31906b03803ea8478539b'
$workflowPath = '.github/workflows/inventario.yml'
$expected = [ordered]@{
    '.github/workflows/inventario.yml' = 'a5ae9a0d9f4ec7347aa13a4fcccc22433700bbb44cccd9f382faace31fc95720'
    'inventory.py' = '2f935197b884a938b3bba9043fb403d9777e53c8c29c889ad5ea14ab5b1142e5'
    'test_inventory.py' = 'a9bb6dd73fa155bcedc8ea6d1f1800909df50ada0653ae3e8c5048f1265d98ce'
    'README.md' = '3daa259cb5cd808b17343348d2dc74727fc4427b71569fcaf975061c84b15df2'
    'package-manifest.json' = '0ef9542dc690dda39184e4dd9e23cef6ebc4bc1b4bb300e89d183e2c6a864994'
    'input/ficticio.dump' = '30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c'
}
$payloads = @($expected.Keys | Where-Object { $_ -cne $workflowPath })
$hadToken = Test-Path Env:GH_TOKEN
$priorToken = [Environment]::GetEnvironmentVariable('GH_TOKEN', 'Process')
$phase = 'local_validation'
$evidence = [ordered]@{ started_utc = [DateTime]::UtcNow.ToString('o'); repository = $repoName; status = 'preparing'; payload_sha256 = $expected; uploaded_blobs = @() }
$evidencePath = Join-Path $PSScriptRoot ('envio-inventario-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.json')

function Invoke-GitHub([string]$Method, [string]$Endpoint, $Body = $null) {
    $arguments = @('api', '--hostname', 'github.com', '-X', $Method, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', $Endpoint)
    if ($null -ne $Body) {
        $text = ($Body | ConvertTo-Json -Depth 12 -Compress) | & gh @arguments --input - 2>$null
    } else {
        $text = & gh @arguments 2>$null
    }
    if ($LASTEXITCODE -ne 0) { throw "GitHub API failed during $phase" }
    return (($text -join "`n") | ConvertFrom-Json)
}

function Get-CheckedTree([string]$TreeSha) {
    $tree = Invoke-GitHub 'GET' "repos/$repoName/git/trees/${TreeSha}?recursive=1"
    if ($tree.truncated -ne $false) { throw 'Truncated tree' }
    foreach ($entry in $tree.tree) {
        if ($entry.type -ceq 'tree') {
            if (@('.github', '.github/workflows', 'input') -cnotcontains $entry.path) { throw 'Unexpected remote directory' }
        } elseif ($entry.type -ceq 'blob') {
            if ($expected.Keys -cnotcontains $entry.path -or $entry.mode -cne '100644') { throw 'Unexpected remote file or mode' }
        } else { throw 'Unexpected remote object' }
    }
    return @($tree.tree | Where-Object { $_.type -ceq 'blob' })
}

function Get-GitBlobSha([byte[]]$Bytes) {
    $header = [Text.Encoding]::ASCII.GetBytes("blob $($Bytes.Length)" + [char]0)
    $hash = [Security.Cryptography.SHA1]::Create()
    try { return [Convert]::ToHexString($hash.ComputeHash([byte[]]($header + $Bytes))).ToLowerInvariant() }
    finally { $hash.Dispose() }
}

try {
    $contents = @{}
    foreach ($name in $expected.Keys) {
        $source = Join-Path $packageRoot $name
        $item = Get-Item -LiteralPath $source
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected local file type' }
        $bytes = [IO.File]::ReadAllBytes($item.FullName)
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $actual = [Convert]::ToHexString($hash.ComputeHash($bytes)).ToLowerInvariant() } finally { $hash.Dispose() }
        if ($actual -cne $expected[$name]) { throw 'Local hash mismatch' }
        $contents[$name] = $bytes
    }
    if ($contents['input/ficticio.dump'].Length -ne 505274) { throw 'Dump size mismatch' }
    $manifest = [Text.Encoding]::UTF8.GetString($contents['package-manifest.json']) | ConvertFrom-Json
    if (@(Compare-Object -CaseSensitive @($manifest.files.PSObject.Properties.Name) @($expected.Keys | Where-Object { $_ -cne 'package-manifest.json' })).Count -ne 0) { throw 'Manifest allowlist mismatch' }
    foreach ($property in $manifest.files.PSObject.Properties) {
        if ($property.Value -cne $expected[$property.Name]) { throw 'Manifest hash mismatch' }
    }

    $phase = 'identity_and_private_repository'
    # Ignore a preexisting process token only while selecting the explicitly named stored account.
    Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
    $selectedToken = (& gh auth token --hostname github.com --user $accountName 2>$null) -join ''
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($selectedToken)) { throw 'Stored account token unavailable' }
    $env:GH_TOKEN = $selectedToken.Trim()
    $identity = Invoke-GitHub 'GET' 'user'
    $repository = Invoke-GitHub 'GET' "repos/$repoName"
    if ($identity.login -cne $accountName -or $repository.full_name -cne $repoName -or $repository.private -ne $true -or $repository.permissions.admin -ne $true) { throw 'Private ADMIN repository guard failed' }
    $branch = $repository.default_branch
    if ([string]::IsNullOrWhiteSpace($branch)) { throw 'Missing default branch' }
    $branchUrl = [Uri]::EscapeDataString($branch)
    $refPath = "repos/$repoName/git/refs/heads/$branchUrl"
    $head = Invoke-GitHub 'GET' "repos/$repoName/git/ref/heads/$branchUrl"
    $headSha = $head.object.sha
    if ($headSha -cne $expectedHeadSha) { throw 'HEAD differs from the UI-reviewed baseline' }
    $baseCommit = Invoke-GitHub 'GET' "repos/$repoName/git/commits/$headSha"
    $remoteFiles = @(Get-CheckedTree $baseCommit.tree.sha)
    $workflow = @($remoteFiles | Where-Object { $_.path -ceq $workflowPath })
    if ($workflow.Count -ne 1) { throw 'Workflow must already exist' }
    $workflowBlob = Invoke-GitHub 'GET' "repos/$repoName/git/blobs/$($workflow[0].sha)"
    if ($workflowBlob.encoding -cne 'base64') { throw 'Unexpected workflow encoding' }
    $workflowBytes = [Convert]::FromBase64String($workflowBlob.content)
    $workflowHasher = [Security.Cryptography.SHA256]::Create()
    try { $workflowHash = [Convert]::ToHexString($workflowHasher.ComputeHash($workflowBytes)).ToLowerInvariant() } finally { $workflowHasher.Dispose() }
    if ($workflowHash -cne $expected[$workflowPath]) { throw 'Remote workflow hash mismatch' }
    $evidence.base_commit = $headSha
    $evidence.branch = $branch

    $phase = 'five_payload_blobs'
    $entries = @()
    foreach ($name in $payloads) {
        $blob = Invoke-GitHub 'POST' "repos/$repoName/git/blobs" @{ encoding = 'base64'; content = [Convert]::ToBase64String($contents[$name]) }
        if ($blob.sha -cne (Get-GitBlobSha $contents[$name])) { throw 'Remote blob identity mismatch' }
        $entries += @{ path = $name; mode = '100644'; type = 'blob'; sha = $blob.sha }
        $evidence.uploaded_blobs += @{ path = $name; git_sha = $blob.sha; sha256 = $expected[$name] }
    }
    $phase = 'tree_and_commit'
    $tree = Invoke-GitHub 'POST' "repos/$repoName/git/trees" @{ base_tree = $baseCommit.tree.sha; tree = $entries }
    $finalFiles = @(Get-CheckedTree $tree.sha)
    if (@(Compare-Object -CaseSensitive @($finalFiles.path) @($expected.Keys)).Count -ne 0) { throw 'Final six-file allowlist failed' }
    foreach ($entry in $finalFiles) {
        if ($entry.sha -cne (Get-GitBlobSha $contents[$entry.path])) { throw 'Final tree payload mismatch' }
    }
    $commit = Invoke-GitHub 'POST' "repos/$repoName/git/commits" @{ message = 'Prepare private fictitious backup inventory'; tree = $tree.sha; parents = @($headSha) }
    $evidence.prepared_commit = $commit.sha
    $evidence.tree_sha = $tree.sha
    $phase = 'head_recheck_and_nonforce_update'
    $currentHead = Invoke-GitHub 'GET' "repos/$repoName/git/ref/heads/$branchUrl"
    if ($currentHead.object.sha -cne $headSha) { throw 'HEAD changed; prepared commit preserved without ref update' }
    $updated = Invoke-GitHub 'PATCH' $refPath @{ sha = $commit.sha; force = $false }
    if ($updated.object.sha -cne $commit.sha) { throw 'Ref update response mismatch' }
    $verified = Invoke-GitHub 'GET' "repos/$repoName/git/ref/heads/$branchUrl"
    if ($verified.object.sha -cne $commit.sha) { throw 'HEAD changed after update; no automatic retry' }
    $evidence.status = 'uploaded_without_workflow_execution'
    $evidence.commit = $commit.sha
} catch {
    $evidence.status = 'failed_no_automatic_retry'
    $evidence.failure_phase = $phase
    $evidence.failure_type = $_.Exception.GetType().Name
    throw "Private upload stopped in phase '$phase'. Sanitized evidence: $evidencePath"
} finally {
    if ($hadToken) { [Environment]::SetEnvironmentVariable('GH_TOKEN', $priorToken, 'Process') }
    else { Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue }
    $selectedToken = $null
    $priorToken = $null
    $evidence.ended_utc = [DateTime]::UtcNow.ToString('o')
    $evidenceJson = $evidence | ConvertTo-Json -Depth 8
    $stream = [IO.File]::Open($evidencePath, [IO.FileMode]::CreateNew)
    try {
        $data = [Text.UTF8Encoding]::new($false).GetBytes($evidenceJson + "`n")
        $stream.Write($data, 0, $data.Length)
    } finally { $stream.Dispose() }
}
Write-Output ([pscustomobject]@{ status = $evidence.status; repository = $repoName; commit = $evidence.commit; evidence = $evidencePath })
