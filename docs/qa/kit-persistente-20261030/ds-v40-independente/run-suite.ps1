param([ValidateSet('fixes','independent','docs','pacote')][string]$Suite)
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
Remove-Item Env:\NEG_CONTROL -ErrorAction SilentlyContinue
$qa=$PSScriptRoot
$components='C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v40-20261030\project\components'
$script=switch($Suite){'fixes' {'t_fixes_v40.js'} 'independent' {'independent-checks.js'} 'docs' {'t_docs.js'} 'pacote' {'t_pacote.js'}}
& node (Join-Path $qa "adapted-tests\$script") $components (Join-Path $qa $Suite) 2>&1 | Tee-Object -FilePath (Join-Path $qa "logs\$Suite.txt")
$rc=$LASTEXITCODE
@{suite=$Suite;exit_code=$rc;timestamp=(Get-Date -Format o)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qa "logs\$Suite-result.json")
Write-Output "OBSERVED_EXIT_CODE=$rc"
exit $rc
