param([ValidateSet('docs','negative','pacote')][string]$Suite)
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
$qa=$PSScriptRoot
$components='C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v39-20261030\revisao_pecas_salvas_kitproposta_v39\2_final_v39\project\components'
$script=if($Suite -eq 'pacote') {'t_pacote.js'} else {'t_docs.js'}
if($Suite -eq 'negative'){$env:NEG_CONTROL='1'}else{Remove-Item Env:\NEG_CONTROL -ErrorAction SilentlyContinue}
& node (Join-Path $qa "adapted-tests\$script") $components (Join-Path $qa $Suite) 2>&1 | Tee-Object -FilePath (Join-Path $qa "logs\$Suite.txt")
$rc=$LASTEXITCODE
@{suite=$Suite;exit_code=$rc;timestamp=(Get-Date -Format o)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qa "logs\$Suite-result.json")
Write-Output "OBSERVED_EXIT_CODE=$rc"
exit $rc
