# -*- coding: utf-8 -*-
# Boletim diario de editais - versao para rodar no GitHub Actions (nuvem),
# em vez de na maquina do usuario. Mesma logica do busca_editais.py original,
# so mudou onde fica o "historico de editais ja vistos": agora vai em
# data/editais_vistos.json, dentro do repositorio, e o proprio workflow
# do GitHub Actions commita esse arquivo de volta a cada execucao - assim
# o historico persiste de um dia para o outro mesmo rodando num runner novo
# toda vez.
import os
import re
import json
import html
import time
import unicodedata
import smtplib
import urllib.request
import urllib.parse
import urllib.error
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from email.header import Header
from datetime import date, datetime

PASTA_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_DADOS = os.path.join(PASTA_REPO, "data")
BASE_URL = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta"
ARQUIVO_HISTORICO = os.path.join(DIR_DADOS, "editais_vistos.json")

NOME_REMETENTE = "HC Licitacoes - Alertas de Editais"

TODAS_UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
             "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]

# ---- DESTINATARIOS (edite aqui para adicionar/remover clientes) ----
# ufs: lista de siglas (ex: ["AM","RR"]) ou None para buscar em todo o Brasil
# palavras_chave: use radicais de palavra (sem plural/genero fixo) para pegar mais variacoes
DESTINATARIOS = [
    {
        "nome": "Harreson",
        "email": "harreson.coelho@gmail.com",
        "ufs": ["AM", "RR"],
        "palavras_chave": [
            "expediente",
            "higiene",
            "limpeza",
            "aliment",
            "veiculo",
            "hospitalar",
            "engenharia",
            "fotovoltaic",
            "eletric",
            "informatica",
        ],
    },
    {
        "nome": "Plug Engenharia",
        "email": "COLOQUE_O_EMAIL_DO_CLIENTE_AQUI@exemplo.com",
        "ufs": None,
        "palavras_chave": [
            "fotovoltaic",
            "solar",
            "geracao distribuida",
            "eletric",
            "subestacao",
            "transmissao",
            "iluminacao",
            "usina",
        ],
    },
]
# ---------------------------------------------------------------------


def log(msg):
    linha = "[" + datetime.now().strftime("%d/%m/%Y %H:%M:%S") + "] " + msg
    print(linha)


def carregar_historico():
    if os.path.exists(ARQUIVO_HISTORICO):
        with open(ARQUIVO_HISTORICO, "r", encoding="utf-8") as f:
            dados = json.load(f)
        if isinstance(dados, list):
            novo = {}
            for d in DESTINATARIOS:
                novo[d["email"]] = list(dados)
            return novo
        return dados
    return {}


def salvar_historico(vistos):
    os.makedirs(DIR_DADOS, exist_ok=True)
    with open(ARQUIVO_HISTORICO, "w", encoding="utf-8") as f:
        json.dump(vistos, f, ensure_ascii=False, indent=2)


def data_final_busca():
    # dataFinal filtra pelo prazo de encerramento da proposta (nao pela data de hoje).
    # Usar so a data de hoje faz a API devolver apenas editais que encerram HOJE.
    # Estendendo a janela pegamos todos os editais com proposta aberta atualmente.
    from datetime import timedelta
    return (date.today() + timedelta(days=365)).strftime("%Y%m%d")


def buscar_pagina(uf, pagina):
    params = {
        "uf": uf,
        "dataFinal": data_final_busca(),
        "pagina": pagina,
        "tamanhoPagina": 50,
    }
    url = BASE_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    tentativas_429 = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                corpo = resp.read().decode("utf-8")
            if not corpo.strip():
                return {"data": [], "totalPaginas": 1}
            return json.loads(corpo)
        except urllib.error.HTTPError as e:
            if e.code == 429 and tentativas_429 < 5:
                tentativas_429 += 1
                time.sleep(3 * tentativas_429)
                continue
            raise


def buscar_todos_editais(uf):
    editais = []
    pagina = 1
    while True:
        try:
            dados = buscar_pagina(uf, pagina)
        except urllib.error.HTTPError as e:
            if e.code == 422:
                break
            raise
        itens = dados.get("data", [])
        if not itens:
            break
        editais.extend(itens)
        total_paginas = dados.get("totalPaginas", 1)
        if pagina >= total_paginas:
            break
        pagina += 1
        time.sleep(0.4)
    return editais


def buscar_pool_por_uf(lista_ufs):
    pool = {}
    for uf in lista_ufs:
        log("Buscando editais em " + uf + "...")
        try:
            pool[uf] = buscar_todos_editais(uf)
        except Exception as e:
            log("ERRO ao buscar UF " + uf + ": " + str(e))
            pool[uf] = []
        time.sleep(1.2)
    return pool


def _normalizar(texto):
    texto = texto or ""
    nfkd = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    return sem_acento.lower()


def filtrar_por_palavra_chave(editais, palavras):
    if not palavras:
        return editais
    resultado = []
    for e in editais:
        objeto = _normalizar(e.get("objetoCompra") or "")
        for p in palavras:
            if _normalizar(p) in objeto:
                resultado.append(e)
                break
    return resultado


def montar_link_pncp(e):
    m = re.match(r"^(\d{14})-\d+-(\d+)/(\d{4})$", e.get("numeroControlePNCP") or "")
    if m:
        cnpj, seq, ano = m.group(1), str(int(m.group(2))), m.group(3)
        return "https://pncp.gov.br/app/editais/" + cnpj + "/" + ano + "/" + seq
    return "https://pncp.gov.br"


def link_pncp(e):
    return montar_link_pncp(e)


def link_origem_valido(e):
    link_origem = e.get("linkSistemaOrigem")
    if not link_origem:
        return None
    link_origem = link_origem.strip()
    if not link_origem or link_origem.lower() in ("http://", "https://"):
        return None
    if not link_origem.startswith("http"):
        link_origem = "https://" + link_origem
    return link_origem


def formatar_valor(v):
    if not v:
        return "Nao informado"
    return "R$ " + "{:,.2f}".format(v).replace(",", "X").replace(".", ",").replace("X", ".")


def montar_card_html(e):
    orgao = html.escape(e.get("orgaoEntidade", {}).get("razaoSocial") or "Orgao nao informado")
    municipio = html.escape((e.get("unidadeOrgao") or {}).get("municipioNome") or "")
    uf = html.escape((e.get("unidadeOrgao") or {}).get("ufSigla") or "")
    objeto = html.escape(e.get("objetoCompra") or "Objeto nao informado")
    modalidade = html.escape(e.get("modalidadeNome") or "")
    valor = formatar_valor(e.get("valorTotalEstimado"))
    encerramento = e.get("dataEncerramentoProposta") or ""
    if encerramento:
        try:
            encerramento = datetime.fromisoformat(encerramento).strftime("%d/%m/%Y")
        except Exception:
            pass

    link1 = link_pncp(e)
    link2 = link_origem_valido(e)

    botoes = (
        '<a href="' + link1 + '" style="display:inline-block;background:#1a73e8;color:#ffffff;'
        'padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;'
        'font-family:Arial,sans-serif;font-size:14px;margin-right:8px;">Ver edital no PNCP &rarr;</a>'
    )
    if link2:
        botoes += (
            '<a href="' + link2 + '" style="display:inline-block;background:#ffffff;color:#1a73e8;'
            'border:1px solid #1a73e8;padding:9px 18px;border-radius:6px;text-decoration:none;'
            'font-weight:bold;font-family:Arial,sans-serif;font-size:14px;">Site do orgao (origem)</a>'
        )

    return (
        '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:18px;margin-bottom:16px;'
        'font-family:Arial,sans-serif;background:#ffffff;">'
        '<div style="font-size:12px;color:#1a73e8;font-weight:bold;text-transform:uppercase;margin-bottom:6px;">'
        + modalidade + " - " + municipio + "/" + uf + '</div>'
        '<div style="font-size:15px;color:#202124;font-weight:bold;margin-bottom:8px;">' + orgao + '</div>'
        '<div style="font-size:14px;color:#3c4043;margin-bottom:10px;line-height:1.5;">' + objeto + '</div>'
        '<div style="font-size:13px;color:#5f6368;margin-bottom:14px;">'
        'Valor estimado: <b>' + valor + '</b> &nbsp;|&nbsp; Encerra em: <b>' + html.escape(str(encerramento)) + '</b>'
        '</div>'
        + botoes +
        '</div>'
    )


def montar_email_html(nome_destinatario, editais_novos):
    cards = "".join(montar_card_html(e) for e in editais_novos)
    return (
        '<html><body style="margin:0;padding:0;background:#f4f4f4;">'
        '<div style="max-width:640px;margin:0 auto;padding:24px 16px;">'
        '<div style="font-family:Arial,sans-serif;font-size:20px;color:#202124;margin-bottom:4px;">'
        'Ola, ' + html.escape(nome_destinatario) + '!</div>'
        '<div style="font-family:Arial,sans-serif;font-size:14px;color:#5f6368;margin-bottom:20px;">'
        'Encontramos <b>' + str(len(editais_novos)) + '</b> nova(s) oportunidade(s) de licitacao para voce hoje.</div>'
        + cards +
        '<div style="font-family:Arial,sans-serif;font-size:12px;color:#9aa0a6;margin-top:20px;">'
        'Alerta automatico gerado por HC Licitacoes com base em dados publicos do PNCP.</div>'
        '</div></body></html>'
    )


def montar_email_texto(nome_destinatario, editais_novos):
    linhas = ["Ola, " + nome_destinatario + "!", "",
              "Encontramos " + str(len(editais_novos)) + " nova(s) oportunidade(s) de licitacao:", ""]
    for e in editais_novos:
        orgao = e.get("orgaoEntidade", {}).get("razaoSocial") or "Orgao nao informado"
        objeto = e.get("objetoCompra") or "Objeto nao informado"
        linhas.append("- " + orgao)
        linhas.append("  Objeto: " + objeto)
        linhas.append("  Link PNCP: " + link_pncp(e))
        link2 = link_origem_valido(e)
        if link2:
            linhas.append("  Link do orgao: " + link2)
        linhas.append("")
    return "\n".join(linhas)


def enviar_email(destino_email, nome_destinatario, editais_novos):
    remetente = os.environ["EMAIL_REMETENTE"]
    senha_app = os.environ["EMAIL_SENHA_APP"]
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Novos editais encontrados (" + str(len(editais_novos)) + ")"
    msg["From"] = formataddr((str(Header(NOME_REMETENTE, "utf-8")), remetente))
    msg["To"] = destino_email
    msg.attach(MIMEText(montar_email_texto(nome_destinatario, editais_novos), "plain", "utf-8"))
    msg.attach(MIMEText(montar_email_html(nome_destinatario, editais_novos), "html", "utf-8"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as servidor:
        servidor.login(remetente, senha_app)
        servidor.sendmail(remetente, [destino_email], msg.as_string())


def main():
    log("=== Iniciando busca de editais ===")
    historico = carregar_historico()

    ufs_necessarias = set()
    precisa_todas = False
    for d in DESTINATARIOS:
        if d["ufs"] is None:
            precisa_todas = True
        else:
            ufs_necessarias.update(d["ufs"])
    if precisa_todas:
        ufs_para_buscar = TODAS_UFS
    else:
        ufs_para_buscar = sorted(ufs_necessarias)

    pool = buscar_pool_por_uf(ufs_para_buscar)

    for d in DESTINATARIOS:
        try:
            if d["ufs"] is None:
                editais = []
                for uf in ufs_para_buscar:
                    editais.extend(pool.get(uf, []))
            else:
                editais = []
                for uf in d["ufs"]:
                    editais.extend(pool.get(uf, []))

            filtrados = filtrar_por_palavra_chave(editais, d["palavras_chave"])

            vistos_deste = set(historico.get(d["email"], []))
            novos = [e for e in filtrados if e.get("numeroControlePNCP") not in vistos_deste]

            log(d["nome"] + ": " + str(len(filtrados)) + " editais no filtro, " + str(len(novos)) + " novo(s).")

            if novos:
                enviar_email(d["email"], d["nome"], novos)
                log("E-mail enviado para " + d["email"] + " com " + str(len(novos)) + " edital(is).")
                for e in novos:
                    vistos_deste.add(e.get("numeroControlePNCP"))
                historico[d["email"]] = list(vistos_deste)
            else:
                log("Nenhum edital novo para " + d["nome"] + ".")
        except Exception as e:
            log("ERRO ao processar destinatario " + d["nome"] + ": " + str(e))

    salvar_historico(historico)
    log("=== Fim da execucao ===")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("ERRO FATAL: " + str(e))
        raise
