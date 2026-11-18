from pathlib import Path
import ast,hashlib,json,re,shutil,difflib
qa=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\design-modulo-um\docs\qa\kit-persistente-20261030\ds-v40-independente')
oldqa=qa.parent/'ds-v39-independente'
base=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v39-20261030\revisao_pecas_salvas_kitproposta_v39')
iso=Path(r'C:\Users\harre\AppData\Local\LicitaPlena\revisao-kitproposta-v40-20261030')
assert not iso.exists(), 'Do not overwrite an existing reconstruction'
iso.mkdir()
for d in ['original-generator','patched-generator']:shutil.copytree(base/'3_gerador',iso/d)
shutil.copytree(base/'2_final_v39/project',iso/'project')
for d in ['logs','original-tests','adapted-tests','extra','docs','pacote','fixes']: (qa/d).mkdir(exist_ok=True)
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(qa/'v39-original-tree-before.json').write_text(json.dumps({p.relative_to(base).as_posix():h(p) for p in base.rglob('*') if p.is_file()},indent=2),encoding='utf-8')
blocks=json.loads((qa/'blocos-claude-observados.json').read_text(encoding='utf-8-sig'))
assert len(blocks)==4

def apply_strict(original,patch):
    src=original.splitlines(); lines=patch.splitlines(); result=[]; pos=0; i=2; hunks=[]
    while i<len(lines):
        header=lines[i]; m=re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*',header); assert m,header
        start=int(m[1])-1; oldcount=int(m[2] or '1'); newcount=int(m[4] or '1'); assert start>=pos
        result.extend(src[pos:start]); pos=start; i+=1; oc=nc=0
        while i<len(lines) and not lines[i].startswith('@@ '):
            l=lines[i]; assert l and l[0] in ' +-','Unsupported patch line '+repr(l)
            if l[0] in ' -':
                assert src[pos]==l[1:],f'Context mismatch at {pos+1}: {src[pos]!r} != {l[1:]!r}'
                pos+=1; oc+=1
            if l[0] in ' +':result.append(l[1:]);nc+=1
            i+=1
        assert (oc,nc)==(oldcount,newcount),(header,oc,nc)
        hunks.append({'header':header,'old_lines':oc,'new_lines':nc})
    result.extend(src[pos:])
    return '\n'.join(result)+ ('\n' if original.endswith('\n') else ''),hunks

applied=[]
for name,block in [('pk_logic.js',blocks[0]),('cadastro.py',blocks[1])]:
    (qa/(name+'.observed.patch')).write_text(block,encoding='utf-8')
    old=(iso/'original-generator'/name).read_bytes().decode('utf-8')
    assert '\r' not in old,'Unexpected original line ending'
    new,hunks=apply_strict(old,block)
    (iso/'patched-generator'/name).write_bytes(new.encode('utf-8'))
    applied.append({'file':name,'hunks':hunks,'original_sha256':hashlib.sha256(old.encode()).hexdigest(),'patched_sha256':hashlib.sha256(new.encode()).hexdigest(),'terminal_newline_preserved':old.endswith('\n')})

def jslogic(p):
    tree=ast.parse(p.read_bytes().decode('utf-8'))
    matches=[n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='JS_LOGIC' for t in n.targets)]
    assert len(matches)==1
    return ast.literal_eval(matches[0].value)

oldjs=jslogic(iso/'original-generator/cadastro.py').replace('/*@PKFLAG*/false','true').replace('/*@PKLOGIC*/',(iso/'original-generator/pk_logic.js').read_bytes().decode())
newjs=jslogic(iso/'patched-generator/cadastro.py').replace('/*@PKFLAG*/false','true').replace('/*@PKLOGIC*/',(iso/'patched-generator/pk_logic.js').read_bytes().decode())
p=iso/'project/components/KitProposta/preview.html'; html=p.read_bytes().decode('utf-8'); assert html.count(oldjs)==1,'Exact embedded JS block not unique/found'
rebuilt=html.replace(oldjs,newjs,1); p.write_bytes(rebuilt.encode('utf-8'))
expected='c8f44a4de6c4dbb1b94854a050d21c15a8260dd92ff379579a942ab13744cb47'
actual=h(p)
protected=[]
for op in sorted((base/'2_final_v39/project').rglob('*')):
    if op.is_file():
        rel=op.relative_to(base/'2_final_v39/project'); np=iso/'project'/rel
        protected.append({'path':rel.as_posix(),'baseline':h(op),'reconstructed':h(np),'same':h(op)==h(np)})
report={'method':'Exact replacement of JS_LOGIC composed with PK_LOGIC in baseline HTML; full generator dependencies missing','expected':expected,'actual':actual,'matches':expected==actual,'source_patches':applied,'project_comparison':protected,'perfil_documentos_available':False}
(qa/'reconstruction.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(qa/'preview.v39-v40.patch').write_text(''.join(difflib.unified_diff(html.splitlines(True),rebuilt.splitlines(True),fromfile='v39/KitProposta/preview.html',tofile='v40/KitProposta/preview.html')),encoding='utf-8')
for name in ['t_docs.js','t_pacote.js','harness_tokens_live.css']: shutil.copyfile(base/'4_testes'/name,qa/'original-tests'/name)
(qa/'original-tests/t_fixes_v40.js').write_text(blocks[2],encoding='utf-8')
(qa/'hashes-declared.txt').write_text(blocks[3],encoding='utf-8')
for name in ['t_docs.js','t_pacote.js','t_fixes_v40.js']:
    s=(qa/'original-tests'/name).read_bytes().decode('utf-8').replace("require('playwright')","require('./isolated-playwright.cjs')")
    s=s.replace("'file://'+C+'/KitProposta/preview.html'","require('url').pathToFileURL(require('path').join(C,'KitProposta','preview.html')).href")
    (qa/'adapted-tests'/name).write_bytes(s.encode('utf-8'))
for name in ['isolated-playwright.cjs','harness_tokens_live.css']: shutil.copyfile(oldqa/'adapted-tests'/name,qa/'adapted-tests'/name)
s=(oldqa/'adapted-tests/independent-checks.js').read_bytes().decode('utf-8-sig')
s=s.replace('C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v39-20261030/revisao_pecas_salvas_kitproposta_v39/2_final_v39/project/components/KitProposta/preview.html',(iso/'project/components/KitProposta/preview.html').as_posix())
(qa/'adapted-tests/independent-checks.js').write_bytes(s.encode('utf-8'))
print(json.dumps({'expected':expected,'actual':actual,'matches':expected==actual,'strict_patch_hunks':sum(len(a['hunks']) for a in applied),'unchanged_project_files':sum(x['same'] for x in protected),'total_project_files':len(protected)},indent=2))
assert actual==expected,'Hash mismatch: preserve candidate and diagnose without normalizing'
