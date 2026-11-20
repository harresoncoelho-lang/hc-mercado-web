# Preparado para revisao. Nao executa workflow, nao publica site e nao altera o login global do gh.
# Candidato V3: atualiza somente tres payloads; conserva os demais oito arquivos remotos.
# Executar somente apos revisao independente; HEAD e todos os onze blobs anteriores sao conferidos.
$ErrorActionPreference = 'Stop'
$repoName = 'harresoncoelho-lang/licitaplena-homologacao'
$accountName = 'harresoncoelho-lang'
$packageRoot = Join-Path $PSScriptRoot 'executor'
$expectedHeadSha = '702663b5af7551896551eef253a7f425d144bc5d'
$workflowPath = '.github/workflows/restauracao.yml'
$expected = [ordered]@{
    '.github/workflows/inventario.yml' = 'a5ae9a0d9f4ec7347aa13a4fcccc22433700bbb44cccd9f382faace31fc95720'
    'inventory.py' = '2f935197b884a938b3bba9043fb403d9777e53c8c29c889ad5ea14ab5b1142e5'
    'test_inventory.py' = 'a9bb6dd73fa155bcedc8ea6d1f1800909df50ada0653ae3e8c5048f1265d98ce'
    'README.md' = '3daa259cb5cd808b17343348d2dc74727fc4427b71569fcaf975061c84b15df2'
    'package-manifest.json' = '0ef9542dc690dda39184e4dd9e23cef6ebc4bc1b4bb300e89d183e2c6a864994'
    'input/ficticio.dump' = '30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c'
    '.github/workflows/restauracao.yml' = '2b2e01c82652e4f5ea868ee688946a42c3c31800621d21605f570f093baef08f'
    'restauracao/restore.py' = '6e6d588d8a9ec0598002f3e4cc76607605f541b850e1a6de1c61cc689ec967f5'
    'restauracao/test_restore.py' = 'e17889fe2cb66f0abf27b037751da8205a8b6cbe0e9dc17db3bfd9810633e78a'
    'restauracao/baseline.json' = '43b87aceb61497dd9f1f28ac8538d7d4e93752f8415c60ea47f3100dca0485e0'
    'restauracao/README.md' = 'ced775f10a668be00351a40080fb2a299ec4cf1a7132acb600306f95521acc3f'
}
$payloads = @('restauracao/restore.py','restauracao/test_restore.py','restauracao/README.md')
$inventoryFiles = @('.github/workflows/inventario.yml','inventory.py','test_inventory.py','README.md','input/ficticio.dump')
$previousSha256 = [ordered]@{}
foreach ($name in $expected.Keys) { $previousSha256[$name] = $expected[$name] }
$previousSha256['restauracao/restore.py'] = '61c63c53a6ba71dfbd2139ab7d5aaecb4474fd0cd0ccb43700b1c6906510678f'
$previousSha256['restauracao/test_restore.py'] = 'acc22af0b0912a04dcafdb0d5d1abded2711dbb3987f70174bf02122a830daad'
$previousSha256['restauracao/README.md'] = 'a0da1b7fe7dee75e8ed1832976eb6816f3e8496ee19149d47423fe1738b3f964'
$previousGitBlobs = [ordered]@{
    '.github/workflows/inventario.yml' = '92ed46c1f96bce2de654a9d8157b648abda038c9'
    'inventory.py' = '444663da8cded7ea39adda233723bcd4169634b2'
    'test_inventory.py' = '0054a3fb1b46050c42940f377e725d088495c91a'
    'README.md' = 'fb45a83e8e934e607d26f2471ef3ac86f1208891'
    'package-manifest.json' = '422943f85459b075bf74360a6d5d9b42b06fcff1'
    'input/ficticio.dump' = '459957061a7e09628c6661c562b5839351dbfbea'
    '.github/workflows/restauracao.yml' = '5606caae9120e07ea942d64a9a72cdb2dd06437c'
    'restauracao/restore.py' = 'ad19f3bdace4793301d67dd8bf6abd6e18b70359'
    'restauracao/test_restore.py' = '7608a3a58347ed01ab59a5e7a7bcccf0f2f19fc8'
    'restauracao/baseline.json' = '0038944322952fab41dba2cead325d17adec5285'
    'restauracao/README.md' = '5d1a8e9fed4d30ea184a310f9ef7d15da2063f29'
}
$hadToken = Test-Path Env:GH_TOKEN
$priorToken = [Environment]::GetEnvironmentVariable('GH_TOKEN', 'Process')
$phase = 'local_validation'
$evidence = [ordered]@{ started_utc = [DateTime]::UtcNow.ToString('o'); repository = $repoName; status = 'preparing'; payload_sha256 = $expected; previous_payload_sha256 = $previousSha256; previous_git_blobs = $previousGitBlobs; uploaded_blobs = @() }
$evidencePath = Join-Path $PSScriptRoot ('envio-restauracao-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.json')

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
            if (@('.github', '.github/workflows', 'input', 'restauracao') -cnotcontains $entry.path) { throw 'Unexpected remote directory' }
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
    if ($expectedHeadSha -cnotmatch '^[0-9a-f]{40}$') { throw 'Pending reviewed workflow UI commit; upload is blocked' }
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
    if (@(Compare-Object -CaseSensitive @($manifest.files.PSObject.Properties.Name) $inventoryFiles).Count -ne 0) { throw 'Manifest allowlist mismatch' }
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
    if (@(Compare-Object -CaseSensitive @($remoteFiles.path) @($previousGitBlobs.Keys)).Count -ne 0) { throw 'Previous eleven-file repository allowlist failed' }
    foreach ($existing in $remoteFiles) {
        if ($existing.sha -cne $previousGitBlobs[$existing.path]) { throw 'Previous remote file identity mismatch' }
    }
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

    $phase = 'three_changed_payload_blobs'
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
    if (@(Compare-Object -CaseSensitive @($finalFiles.path) @($expected.Keys)).Count -ne 0) { throw 'Final eleven-file allowlist failed' }
    foreach ($entry in $finalFiles) {
        if ($entry.sha -cne (Get-GitBlobSha $contents[$entry.path])) { throw 'Final tree payload mismatch' }
    }
    $commit = Invoke-GitHub 'POST' "repos/$repoName/git/commits" @{ message = 'Validate required libraries through PostgreSQL loader'; tree = $tree.sha; parents = @($headSha) }
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
