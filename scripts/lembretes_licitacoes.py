# -*- coding: utf-8 -*-
# Verifica lembretes de licitacao pendentes (tabela public.lembretes, ver painel.html)
# e manda e-mail pros que vencem hoje: data_final_proposta - dias_antes == hoje.
# Roda 1x/dia via .github/workflows/lembretes-licitacoes.yml. Reaproveita a mesma
# infraestrutura de envio de e-mail do boletim (scripts/boletim_editais.py): Gmail SMTP
# com as mesmas secrets EMAIL_REMETENTE/EMAIL_SENHA_APP.
import os
import re
import json
import smtplib
import urllib.request
import urllib.parse
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from email.header import Header
from datetime import date, datetime

SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co"
NOME_REMETENTE = "LicitaPlena - Lembretes de Licitação"


def log(msg):
    print("[" + datetime.now().strftime("%d/%m/%Y %H:%M:%S") + "] " + msg, flush=True)


def _chave_servico():
    chave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not chave:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY nao configurada (Settings > Secrets and "
            "variables > Actions no repositorio do GitHub)."
        )
    return chave


def _requisicao_supabase(caminho, metodo="GET", corpo=None, headers_extra=None):
    chave = _chave_servico()
    headers = {
        "apikey": chave,
        "Authorization": "Bearer " + chave,
    }
    if headers_extra:
        headers.update(headers_extra)
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    if dados is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(SUPABASE_URL + caminho, data=dados, method=metodo, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        bruto = resp.read()
        return json.loads(bruto.decode("utf-8")) if bruto else None


def carregar_lembretes_pendentes():
    # Filtra so por enviado=false na query (o calculo de "vence hoje" - que depende de
    # dias_antes, um valor por linha - e feito aqui em Python, mais simples e legivel
    # que expressar aritmetica de data no querystring do PostgREST).
    return _requisicao_supabase(
        "/rest/v1/lembretes?enviado=eq.false"
        "&select=id,cliente_id,numero_controle_pncp,objeto_resumo,data_final_proposta,dias_antes,nota"
    ) or []


def vence_hoje(lembrete):
    bruto = lembrete.get("data_final_proposta")
    if not bruto:
        return False
    try:
        data_proposta = datetime.fromisoformat(bruto.replace("Z", "+00:00")).date()
    except ValueError:
        return False
    dias_antes = lembrete.get("dias_antes") or 0
    data_aviso = date.fromordinal(data_proposta.toordinal() - dias_antes)
    return data_aviso == date.today()


def buscar_cliente(cliente_id):
    linhas = _requisicao_supabase(
        "/rest/v1/clientes?id=eq." + urllib.parse.quote(cliente_id) + "&select=nome,empresa,email"
    )
    return linhas[0] if linhas else None


def montar_link_pncp(numero_controle_pncp):
    m = re.match(r"^(\d{14})-\d+-(\d+)/(\d{4})$", numero_controle_pncp or "")
    if m:
        cnpj, seq, ano = m.group(1), str(int(m.group(2))), m.group(3)
        return "https://pncp.gov.br/app/editais/" + cnpj + "/" + ano + "/" + seq
    return "https://pncp.gov.br"


def montar_corpo_email(nome_destinatario, lembrete):
    link = montar_link_pncp(lembrete.get("numero_controle_pncp"))
    objeto = lembrete.get("objeto_resumo") or lembrete.get("numero_controle_pncp") or "Licitação"
    dias_antes = lembrete.get("dias_antes")
    nota = (lembrete.get("nota") or "").strip()

    texto = (
        "Olá, " + nome_destinatario + "!\n\n"
        "Lembrete: faltam " + str(dias_antes) + " dia(s) para o prazo final de propostas "
        "desta licitação que você está acompanhando:\n\n"
        "- " + objeto + "\n"
        "  Link PNCP: " + link + "\n"
    )
    if nota:
        texto += "\n  Sua nota: " + nota + "\n"

    nota_html = (
        "<p><strong>Sua nota:</strong> " + nota + "</p>" if nota else ""
    )
    html_corpo = (
        "<p>Olá, " + nome_destinatario + "!</p>"
        "<p>Faltam <strong>" + str(dias_antes) + " dia(s)</strong> para o prazo final de propostas "
        "desta licitação que você está acompanhando:</p>"
        "<p><strong>" + objeto + "</strong><br>"
        "<a href=\"" + link + "\">Ver no PNCP →</a></p>"
        + nota_html
    )
    return texto, html_corpo


def enviar_email(destino_email, nome_destinatario, lembrete):
    remetente = os.environ["EMAIL_REMETENTE"]
    senha_app = os.environ["EMAIL_SENHA_APP"]
    texto, html_corpo = montar_corpo_email(nome_destinatario, lembrete)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Lembrete: prazo de proposta se aproxima"
    msg["From"] = formataddr((str(Header(NOME_REMETENTE, "utf-8")), remetente))
    msg["To"] = destino_email
    msg.attach(MIMEText(texto, "plain", "utf-8"))
    msg.attach(MIMEText(html_corpo, "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as servidor:
        servidor.login(remetente, senha_app)
        servidor.sendmail(remetente, [destino_email], msg.as_string())


def marcar_como_enviado(lembrete_id):
    _requisicao_supabase(
        "/rest/v1/lembretes?id=eq." + urllib.parse.quote(lembrete_id),
        metodo="PATCH",
        corpo={"enviado": True},
        headers_extra={"Prefer": "return=minimal"},
    )


def main():
    log("=== Verificando lembretes de licitação pendentes ===")
    pendentes = carregar_lembretes_pendentes()
    hoje_lista = [l for l in pendentes if vence_hoje(l)]
    log(str(len(pendentes)) + " lembrete(s) pendente(s) no total, " + str(len(hoje_lista)) + " vencem hoje.")

    enviados = 0
    for lembrete in hoje_lista:
        cliente = buscar_cliente(lembrete["cliente_id"])
        email = (cliente or {}).get("email")
        if not email:
            log("AVISO: lembrete " + lembrete["id"] + " sem e-mail de cliente encontrado, pulando.")
            continue
        nome = (cliente or {}).get("empresa") or (cliente or {}).get("nome") or "Cliente"
        try:
            enviar_email(email, nome, lembrete)
            marcar_como_enviado(lembrete["id"])
            enviados += 1
            log("Lembrete enviado para " + email + " (licitação " + str(lembrete.get("numero_controle_pncp")) + ").")
        except Exception as e:
            log("ERRO ao enviar lembrete " + lembrete["id"] + " para " + email + ": " + str(e))

    log("=== Concluído: " + str(enviados) + " lembrete(s) enviado(s) ===")


if __name__ == "__main__":
    main()
