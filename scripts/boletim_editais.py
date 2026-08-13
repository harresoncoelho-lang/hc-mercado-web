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
import socket
import unicodedata
import smtplib
import urllib.request
import urllib.parse
import urllib.error
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from email.header import Header
from datetime import date, datetime, timedelta

PASTA_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_DADOS = os.path.join(PASTA_REPO, "data")
BASE_URL = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta"
ARQUIVO_HISTORICO = os.path.join(DIR_DADOS, "editais_vistos.json")
USER_AGENT_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

NOME_REMETENTE = "LicitaPlena - Alertas de Editais"

TODAS_UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
             "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]

# ---- DESTINATARIOS (edite aqui para adicionar/remover clientes) ----
# ufs: lista de siglas (ex: ["AM","RR"]) ou None para buscar em todo o Brasil
# palavras_chave: use radicais de palavra (sem plural/genero fixo) para pegar mais variacoes
#
# whatsapp (opcional): alem do e-mail, tambem manda um resumo por WhatsApp via CallMeBot
# (API gratuita, nao-oficial). Pra ativar pra um destinatario:
#   1) Salve o numero +34 644 59 71 40 nos contatos do WhatsApp do destinatario.
#   2) Do WhatsApp desse numero, mande a mensagem: "I allow callmebot to send me messages"
#      pro contato salvo no passo 1.
#   3) O bot responde com um "apikey" (numero). Cole esse apikey aqui embaixo.
#   4) Preencha "telefone" com o numero completo do destinatario, com DDI+DDD, sem
#      espacos/traco/parenteses (ex: "5592912345678" pra um numero de Manaus/AM).
# Se "whatsapp" for None, o boletim desse destinatario continua indo so por e-mail.
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
        "whatsapp": None,  # preencha {"telefone": "55...", "apikey": "..."} depois de liberar o CallMeBot
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
        "whatsapp": None,
    },
]
# ---------------------------------------------------------------------


def log(msg):
    linha = "[" + datetime.now().strftime("%d/%m/%Y %H:%M:%S") + "] " + msg
    print(linha, flush=True)


# O historico de editais ja vistos costumava ficar em data/editais_vistos.json,
# commitado no git a cada execucao do robo - isso disparava uma publicacao completa
# do site no Netlify toda vez (mesmo o historico sendo so um arquivinho de controle
# interno que ninguem ve). Agora ele mora na tabela public.dados_robo do Supabase
# (mesmo padrao usado pelos robos em Node - ver scripts/supabase_dados.js), entao
# o robo do boletim para de fazer commit/push no repositorio.
SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co"


def _chave_servico():
    chave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not chave:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY nao configurada (Settings > Secrets and "
            "variables > Actions no repositorio do GitHub)."
        )
    return chave


def carregar_historico():
    chave = _chave_servico()
    url = SUPABASE_URL + "/rest/v1/dados_robo?chave=eq.editais_vistos&select=dado"
    req = urllib.request.Request(url, headers={
        "apikey": chave,
        "Authorization": "Bearer " + chave,
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            linhas = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log("AVISO: falha ao carregar historico do Supabase (" + str(e) + "), comecando vazio.")
        return {}
    if not linhas:
        return {}
    dados = linhas[0].get("dado")
    if isinstance(dados, list):
        novo = {}
        for d in DESTINATARIOS:
            novo[d["email"]] = list(dados)
        return novo
    return dados or {}


def salvar_historico(vistos):
    chave = _chave_servico()
    url = SUPABASE_URL + "/rest/v1/dados_robo?on_conflict=chave"
    corpo = json.dumps([{
        "chave": "editais_vistos",
        "dado": vistos,
        "atualizado_em": datetime.utcnow().isoformat() + "Z",
    }]).encode("utf-8")
    req = urllib.request.Request(url, data=corpo, method="POST", headers={
        "apikey": chave,
        "Authorization": "Bearer " + chave,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        resp.read()


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
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": USER_AGENT_NAVEGADOR,
    })
    tentativas_429 = 0
    esperas_retry = [3, 6, 12, 24]
    tentativas_retry = 0
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
            if e.code == 503 and tentativas_retry < len(esperas_retry):
                time.sleep(esperas_retry[tentativas_retry])
                tentativas_retry += 1
                continue
            raise
        except (socket.timeout, urllib.error.URLError) as e:
            if tentativas_retry < len(esperas_retry):
                time.sleep(esperas_retry[tentativas_retry])
                tentativas_retry += 1
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


# O boletim diario deve trazer so os editais publicados recentemente
# (nao todos os que ainda estao com proposta aberta, que pode incluir
# coisa publicada semanas atras). A busca no PNCP usa uma janela grande
# de dataFinal so para conseguir enxergar tudo que esta aberto; aqui a
# gente filtra pela data de publicacao para o e-mail ficar so com o que
# e novidade de fato.
DIAS_PUBLICACAO_BOLETIM = 2


def filtrar_por_publicacao_recente(editais, dias=DIAS_PUBLICACAO_BOLETIM):
    limite = datetime.now() - timedelta(days=dias)
    resultado = []
    for e in editais:
        data_str = e.get("dataPublicacaoPncp") or e.get("dataInclusao")
        if not data_str:
            continue
        try:
            data_pub = datetime.fromisoformat(data_str.replace("Z", ""))
        except ValueError:
            continue
        if data_pub >= limite:
            resultado.append(e)
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
    if not editais_novos:
        return (
            '<html><body style="margin:0;padding:0;background:#f4f4f4;">'
            '<div style="max-width:640px;margin:0 auto;padding:24px 16px;">'
            '<div style="font-family:Arial,sans-serif;font-size:20px;color:#202124;margin-bottom:4px;">'
            'Ola, ' + html.escape(nome_destinatario) + '!</div>'
            '<div style="font-family:Arial,sans-serif;font-size:14px;color:#5f6368;margin-bottom:20px;">'
            'Nao encontramos nenhuma oportunidade nova hoje que bata com o seu filtro.</div>'
            '<div style="font-family:Arial,sans-serif;font-size:12px;color:#9aa0a6;margin-top:20px;">'
            'Alerta automatico gerado por LicitaPlena com base em dados publicos do PNCP.</div>'
            '</div></body></html>'
        )
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
        'Alerta automatico gerado por LicitaPlena com base em dados publicos do PNCP.</div>'
        '</div></body></html>'
    )


def montar_email_texto(nome_destinatario, editais_novos):
    if not editais_novos:
        return (
            "Ola, " + nome_destinatario + "!\n\n"
            "Nao encontramos nenhuma oportunidade nova hoje que bata com o seu filtro.\n"
        )
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
    if editais_novos:
        msg["Subject"] = "Novos editais encontrados (" + str(len(editais_novos)) + ")"
    else:
        msg["Subject"] = "Nenhuma oportunidade nova hoje"
    msg["From"] = formataddr((str(Header(NOME_REMETENTE, "utf-8")), remetente))
    msg["To"] = destino_email
    msg.attach(MIMEText(montar_email_texto(nome_destinatario, editais_novos), "plain", "utf-8"))
    msg.attach(MIMEText(montar_email_html(nome_destinatario, editais_novos), "html", "utf-8"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as servidor:
        servidor.login(remetente, senha_app)
        servidor.sendmail(remetente, [destino_email], msg.as_string())


# ---- WhatsApp via CallMeBot (API gratuita, nao-oficial) ----
# Manda so pro numero que autorizou o bot (ver instrucoes acima, junto de DESTINATARIOS).
CALLMEBOT_URL = "https://api.callmebot.com/whatsapp.php"


def montar_mensagem_whatsapp(nome_destinatario, editais_novos):
    # WhatsApp/CallMeBot nao tem HTML - mensagem em texto puro, com *negrito* (markdown do
    # proprio WhatsApp). Limita a quantidade de editais no corpo da mensagem pra nao ficar
    # gigante (o e-mail continua trazendo a lista completa).
    limite = 8
    linhas = [
        "🔔 *LicitaPlena* - Novas oportunidades",
        f"Ola, {nome_destinatario}! Encontramos {len(editais_novos)} nova(s) oportunidade(s):",
        "",
    ]
    for e in editais_novos[:limite]:
        orgao = e.get("orgaoEntidade", {}).get("razaoSocial") or "Orgao nao informado"
        objeto = e.get("objetoCompra") or "Objeto nao informado"
        if len(objeto) > 140:
            objeto = objeto[:140].rstrip() + "..."
        linhas.append(f"📌 *{orgao}*")
        linhas.append(objeto)
        linhas.append(link_pncp(e))
        linhas.append("")
    if len(editais_novos) > limite:
        linhas.append(f"...e mais {len(editais_novos) - limite} oportunidade(s). Lista completa no e-mail.")
    return "\n".join(linhas)


def enviar_whatsapp(telefone, apikey, mensagem):
    params = {"phone": telefone, "text": mensagem, "apikey": apikey}
    url = CALLMEBOT_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="ignore")


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

            editais_recentes = filtrar_por_publicacao_recente(editais)
            filtrados = filtrar_por_palavra_chave(editais_recentes, d["palavras_chave"])

            log(d["nome"] + ": " + str(len(filtrados)) + " editais no filtro.")

            enviar_email(d["email"], d["nome"], filtrados)
            if filtrados:
                log("E-mail enviado para " + d["email"] + " com " + str(len(filtrados)) + " edital(is).")

                whatsapp_cfg = d.get("whatsapp")
                if whatsapp_cfg and whatsapp_cfg.get("telefone") and whatsapp_cfg.get("apikey"):
                    try:
                        mensagem = montar_mensagem_whatsapp(d["nome"], filtrados)
                        enviar_whatsapp(whatsapp_cfg["telefone"], whatsapp_cfg["apikey"], mensagem)
                        log("WhatsApp enviado para " + whatsapp_cfg["telefone"] + ".")
                    except Exception as e:
                        # Falha no WhatsApp nao pode derrubar o e-mail, que ja foi enviado.
                        log("ERRO ao enviar WhatsApp para " + d["nome"] + ": " + str(e))
            else:
                log("E-mail enviado para " + d["email"] + " avisando que nao ha oportunidades novas.")

            vistos_deste = set(historico.get(d["email"], []))
            for e in filtrados:
                vistos_deste.add(e.get("numeroControlePNCP"))
            historico[d["email"]] = list(vistos_deste)
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
