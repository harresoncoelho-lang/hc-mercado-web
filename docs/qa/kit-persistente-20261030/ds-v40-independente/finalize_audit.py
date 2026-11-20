from pathlib import Path
import hashlib,json,difflib,re
qa=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\design-modulo-um\docs\qa\kit-persistente-20261030\ds-v40-independente')
base=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v39-20261030\revisao_pecas_salvas_kitproposta_v39')
iso=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v40-20261030')
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
expected={'fixes':29,'independent':9,'docs':41,'pacote':162}
results={}
for suite,count in expected.items():
    result=read(qa/'logs'/f'{suite}-result.json')
    log=(qa/'logs'/f'{suite}.txt').read_text(encoding='utf-8-sig')
    assert result['exit_code']==0,(suite,result)
    assert f'SUMMARY pass={count} fail=0' in log,(suite,'summary mismatch')
    assert not any(l.startswith(('FAIL ','ERR ')) for l in log.splitlines()),suite
    results[suite]={'pass':count,'fail':0,'exit_code':0}
before=read(qa/'v39-original-tree-before.json')
after={p.relative_to(base).as_posix():h(p) for p in base.rglob('*') if p.is_file()}
assert before==after,'Original evidence changed'
actual=h(iso/'project/components/KitProposta/preview.html')
expected_hash='c8f44a4de6c4dbb1b94854a050d21c15a8260dd92ff379579a942ab13744cb47'
assert actual==expected_hash
oldqa=qa.parent/'ds-v39-independente'
assert h(qa/'original-tests/t_docs.js')==h(oldqa/'original-tests/t_docs.js')
negative=read(oldqa/'logs/negative-result.json'); assert negative['exit_code']==1
neglog=(oldqa/'logs/negative.txt').read_text(encoding='utf-8-sig'); assert 'FAIL NEG controle deliberado' in neglog
nets=[read(p) for p in (qa/'logs').glob('network-*.json')]
network={'runs':len(nets),'browser_versions':sorted({n['browser'] for n in nets}),'requests':sum(len(n['requests']) for n in nets),'external_requests':sum(len([u for u in n['requests'] if not u.startswith(('file:','data:','blob:'))]) for n in nets),'blocked':sum(len(n['blocked']) for n in nets),'page_errors':[e for n in nets for e in n['errors']]}
assert network['external_requests']==0 and not network['page_errors']
for name in ['t_docs.js','t_pacote.js','t_fixes_v40.js']:
    a=(qa/'original-tests'/name).read_text(encoding='utf-8-sig').splitlines(True)
    b=(qa/'adapted-tests'/name).read_text(encoding='utf-8-sig').splitlines(True)
    (qa/(name+'.windows-adaptation.patch')).write_text(''.join(difflib.unified_diff(a,b,fromfile='original-tests/'+name,tofile='adapted-tests/'+name)),encoding='utf-8')
summary={'tests':results,'kit_expected_sha256':expected_hash,'kit_actual_sha256':actual,'original_evidence_files':len(before),'original_evidence_unchanged':True,'observed_blocks_sha256':h(qa/'blocos-claude-observados.json'),'negative_reused':{'test_sha256':h(qa/'original-tests/t_docs.js'),'log':str(oldqa/'logs/negative.txt'),'exit_code':1},'network':network,'perfil_documentos':'Hash declared only; independent bytes unavailable','zip_v40':'Not downloaded; no ZIP manifest coverage claimed'}
(qa/'verification-final.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))
