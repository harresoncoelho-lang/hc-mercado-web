"""Fixtures exclusivamente sintéticas; reutiliza tipografia/layout do corpus local existente."""
from pathlib import Path
import importlib.util
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parent
source = ROOT.parent / "ai-studio-leitura-20261030" / "gerar_corpus.py"
spec = importlib.util.spec_from_file_location("corpus_existente", source)
corpus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(corpus)
out = ROOT / "pdfs-identificacao"
out.mkdir(exist_ok=True)
manifest = []
for suffix, cnpj in [("A", "11.222.333/0001-81"), ("B", "12.345.678/0001-95")]:
    target = out / f"identificacao-qa-ui-{suffix.lower()}-ficticia.pdf"
    if target.exists():
        raise SystemExit("Preservar saídas: arquivo já existe.")
    fields = {
        "razaoSocial": f"QA UI {suffix} FICTÍCIA",
        "cnpj": cnpj,
        "endereco": f"Rua Ficticia {suffix}, 100 - Cidade Exemplo",
        "representante": f"Pessoa Ficticia {suffix}",
        "cargo": "Representante de Teste",
    }
    c = corpus.canvas.Canvas(str(target), pagesize=corpus.A4)
    c.setTitle(f"Fixture QA {suffix} - FICTÍCIO / TESTE SEM VALIDADE")
    c.setAuthor("LicitaPlena QA - dados sintéticos")
    y = corpus.page_header(c, f"Identificação sintética - QA {suffix}", 1, 1)
    y = corpus.paragraph(c, "FICTÍCIO / TESTE SEM VALIDADE", y, bold=True)
    y = corpus.paragraph(c, "Todos os dados abaixo foram inventados para homologação. Não é cartão CNPJ, contrato social ou documento oficial. Não comprova poderes, habilitação ou regularidade.", y)
    y -= 14
    for label, key in [("NOME EMPRESARIAL", "razaoSocial"), ("CNPJ", "cnpj"), ("ENDERECO", "endereco"), ("REPRESENTANTE LEGAL", "representante"), ("CARGO", "cargo")]:
        y = corpus.paragraph(c, f"{label}: {fields[key]}", y, size=11)
    y -= 18
    corpus.paragraph(c, "Sem assinatura, selo, CPF, telefone, e-mail ou dados bancários. Uso exclusivo como fixture de leitura e isolamento por empresa. Não protocolar nem enviar a terceiros.", y)
    c.save()
    subprocess.run([str(corpus.POPPLER), "-png", "-r", "110", "-singlefile", str(target), str(target.with_suffix(""))], check=True)
    manifest.append({"arquivo": str(target.resolve()), "bytes": target.stat().st_size,
                     "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "campos": fields})
(out / "manifesto.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False))
