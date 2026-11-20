from pathlib import Path
import hashlib,json,difflib
qa=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\design-modulo-um\docs\qa\kit-persistente-20261030\ds-v39-independente')
base=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v39-20261030\revisao_pecas_salvas_kitproposta_v39')
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before=json.loads((qa/'original-tree-before.json').read_text())
after={p.relative_to(base).as_posix():h(p) for p in base.rglob('*') if p.is_file()}
check={'files_before':len(before),'files_after':len(after),'unchanged':before==after,'changed':[k for k in before.keys()|after.keys() if before.get(k)!=after.get(k)]}
(qa/'original-tree-after-verification.json').write_text(json.dumps(check,indent=2),encoding='utf-8')
for name in ['t_docs.js','t_pacote.js']:
    a=(qa/'original-tests'/name).read_text(encoding='utf-8').splitlines(True)
    b=(qa/'adapted-tests'/name).read_text(encoding='utf-8-sig').splitlines(True)
    (qa/(name+'.windows-adaptation.patch')).write_text(''.join(difflib.unified_diff(a,b,fromfile='original-tests/'+name,tofile='adapted-tests/'+name)),encoding='utf-8')
nets=[json.loads(p.read_text()) for p in (qa/'logs').glob('network-*.json')]
summary={'runs':len(nets),'browser_versions':sorted({n['browser'] for n in nets}),'requests':sum(len(n['requests']) for n in nets),'external_requests':sum(len([u for u in n['requests'] if not u.startswith(('file:','data:','blob:'))]) for n in nets),'blocked_requests':sum(len(n['blocked']) for n in nets),'page_errors':[e for n in nets for e in n['errors']]}
(qa/'network-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(check)); print(json.dumps(summary))
