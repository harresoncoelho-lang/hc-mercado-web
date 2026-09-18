# Diagnóstico read-only: replica o pipeline do boletim pro pool["AM"] com dados reais do PNCP.
# Não envia e-mail, não escreve em lugar nenhum.
import sys, collections, re
import os; sys.path.insert(0, os.path.join(os.getcwd(), "scripts"))
import boletim_editais as b

pool_am = b.buscar_todos_editais("AM")
print("total pool[AM]:", len(pool_am))

def uf(e):
    return ((e.get("unidadeOrgao") or {}).get("ufSigla"))

print("ufSigla (unidadeOrgao) no pool AM:", collections.Counter(uf(e) for e in pool_am))
sem_unidade = [e for e in pool_am if not isinstance(e.get("unidadeOrgao"), dict)]
print("sem unidadeOrgao dict:", len(sem_unidade))
print("chaves de topo distintas com 'uf' no nome:", sorted({k for e in pool_am for k in e if "uf" in k.lower()}))
print("chaves de unidadeOrgao:", sorted({k for e in pool_am if isinstance(e.get("unidadeOrgao"), dict) for k in e["unidadeOrgao"]}))

recentes = b.filtrar_por_publicacao_recente(pool_am)
exatos = b.filtrar_por_uf_exata(recentes, ["AM"])
print("recentes:", len(recentes), "| após filtro UF exata:", len(exatos))

# Palavras-chave reais do cliente (segmentos configurados)
segs = ["ASSESSORIAS", "DIDÁTICO", "EMBALAGENS E LACRES", "ESCRITÓRIO E GRÁFICA", "EVENTOS", "PRODUTOS DE LIMPEZA"]
palavras = []
for s in segs:
    palavras.extend(b.SEGMENTO_PARA_PALAVRAS_CHAVE.get(s, []))
final = b.filtrar_por_palavra_chave(exatos, list(dict.fromkeys(palavras)))
print("finais (o que o e-mail teria):", len(final))
for e in final:
    obj = (e.get("objetoCompra") or "")
    org = (e.get("orgaoEntidade") or {}).get("razaoSocial")
    un = e.get("unidadeOrgao") or {}
    flag = "  <<< menciona RR/Roraima/Boa Vista" if re.search(r"\bRR\b|RORAIMA|BOA VISTA", (obj + " " + str(org) + " " + str(un.get("municipioNome"))).upper()) else ""
    print(" -", uf(e), "|", un.get("municipioNome"), "|", org, "|", obj[:90].replace("\n", " "), flag)
