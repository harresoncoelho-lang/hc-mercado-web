from pathlib import Path
import hashlib,json,shutil
base=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v39-20261030\revisao_pecas_salvas_kitproposta_v39')
prior=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v38-evidencias-corrigidas-20261030\revisao_pacote_kitproposta_v38_evidencias_corrigidas\7_readback_final\project')
qa=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\design-modulo-um\docs\qa\kit-persistente-20261030\ds-v39-independente')
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=base/'6_hashes/MANIFESTO_SHA256.txt'
rows=[]
for line in manifest.read_text().splitlines():
    expected,rel=line.split(None,1); rel=rel.strip().removeprefix('./'); p=(base/rel).resolve()
    assert p.is_relative_to(base.resolve())
    actual=h(p) if p.exists() else None
    rows.append(dict(path=rel,expected=expected,actual=actual,match=expected==actual))
listed={r['path'] for r in rows}
files={p.relative_to(base).as_posix():h(p) for p in base.rglob('*') if p.is_file()}
extra=sorted(set(files)-listed-{'6_hashes/MANIFESTO_SHA256.txt'})
comparisons=[]
for p in sorted((base/'1_baseline_v38/project').rglob('*')):
    if p.is_file():
        rel=p.relative_to(base/'1_baseline_v38/project')
        pp=prior/rel; ff=base/'2_final_v39/project'/rel
        comparisons.append(dict(path=rel.as_posix(),prior=h(pp) if pp.exists() else None,baseline=h(p),final=h(ff),baseline_matches_prior=pp.exists() and h(pp)==h(p),protected='KitProposta' not in rel.parts,final_matches_prior=pp.exists() and h(pp)==h(ff)))
report=dict(manifest_count=len(rows),manifest_matches=sum(r['match'] for r in rows),extra=extra,missing=[r['path'] for r in rows if r['actual'] is None],comparisons=comparisons,manifest_rows=rows)
(qa/'hash-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(qa/'original-tree-before.json').write_text(json.dumps(files,indent=2),encoding='utf-8')
for folder in ['original-tests','adapted-tests','logs','extra','docs','negative','pacote']:(qa/folder).mkdir(exist_ok=True)
for name in ['t_docs.js','t_pacote.js','harness_tokens_live.css','run_tests.sh']:
    shutil.copyfile(base/'4_testes'/name,qa/'original-tests'/name)
for name in ['t_docs.js','t_pacote.js']:
    src=(base/'4_testes'/name).read_text(encoding='utf-8')
    src=src.replace("require('playwright')", "require('./isolated-playwright.cjs')")
    src=src.replace("'file://'+C+'/KitProposta/preview.html'", "require('url').pathToFileURL(require('path').join(C,'KitProposta','preview.html')).href")
    (qa/'adapted-tests'/name).write_text(src,encoding='utf-8')
shutil.copyfile(base/'4_testes/harness_tokens_live.css',qa/'adapted-tests/harness_tokens_live.css')
print(json.dumps({k:report[k] for k in ['manifest_count','manifest_matches','extra','missing']}))
print(json.dumps(comparisons,ensure_ascii=False))
