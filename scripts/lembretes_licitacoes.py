# -*- coding: utf-8 -*-
# Verifica lembretes de licitacao pendentes (tabela public.lembretes, ver painel.html)
# e manda e-mail quando chega o momento do aviso: (dia do prazo - dias_antes) na hora_aviso,
# horario de Brasilia. Roda de hora em hora (.github/workflows/lembretes-licitacoes.yml) e
# avisa tudo que ja passou do momento e ainda nao venceu, entao uma rodada perdida nao perde aviso.
# Envio: ZeptoMail (ZEPTOMAIL_TOKEN, o mesmo do site); sem o token cai no Gmail SMTP do boletim.
# Local/teste: LEMBRETES_SO_REGISTRAR=1 nao envia nem marca nada, so registra no log;
# SUPABASE_URL aponta para o banco de teste (o padrao e producao).
import os
import re
import html
import json
import smtplib
import urllib.request
import urllib.parse
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from email.header import Header
from datetime import datetime, timedelta, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL") or "https://lsqjamqvmrcyrvowndiu.supabase.co"
ZEPTOMAIL_URL = "https://api.zeptomail.com/v1.1/email"
REMETENTE_ZEPTO = "licitaplena@licitaplena.com.br"
BRASILIA = timezone(timedelta(hours=-3))
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
        "&select=id,cliente_id,numero_controle_pncp,objeto_resumo,data_final_proposta,dias_antes,hora_aviso,nota"
    ) or []


def _prazo(lembrete):
    bruto = lembrete.get("data_final_proposta")
    if not bruto:
        return None
    try:
        prazo = datetime.fromisoformat(bruto.replace("Z", "+00:00"))
    except ValueError:
        return None
    return prazo if prazo.tzinfo else prazo.replace(tzinfo=timezone.utc)


def momento_do_aviso(lembrete):
    # Mesma conta de busca-avancada.js (momentoDoAviso): dia do prazo em Brasilia menos dias_antes, na hora escolhida.
    prazo = _prazo(lembrete)
    if prazo is None:
        return None
    dia = prazo.astimezone(BRASILIA).date() - timedelta(days=lembrete.get("dias_antes") or 0)
    hora = lembrete.get("hora_aviso")
    return datetime(dia.year, dia.month, dia.day, 8 if hora is None else hora, tzinfo=BRASILIA)


def situacao(lembrete, agora):
    # "aguardar" = ainda nao e a hora; "enviar" = passou da hora e o prazo nao venceu; "expirado" = prazo ja passou.
    aviso, prazo = momento_do_aviso(lembrete), _prazo(lembrete)
    if aviso is None:
        return "aguardar"
    if agora >= prazo:
        return "expirado"
    return "enviar" if agora >= aviso else "aguardar"


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
    prazo = _prazo(lembrete)
    prazo_msg = " Prazo: " + prazo.astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M") + " (Brasília)." if prazo else ""

    texto = (
        "Olá, " + nome_destinatario + "!\n\n"
        "Lembrete: faltam " + str(dias_antes) + " dia(s) para o prazo final de propostas "
        "desta licitação que você está acompanhando." + prazo_msg + "\n\n"
        "- " + objeto + "\n"
        "  Link PNCP: " + link + "\n"
    )
    if nota:
        texto += "\n  Sua nota: " + nota + "\n"

    nota_html = (
        "<p><strong>Sua nota:</strong> " + html.escape(nota) + "</p>" if nota else ""
    )
    html_corpo = (
        "<p>Olá, " + html.escape(nome_destinatario) + "!</p>"
        "<p>Faltam <strong>" + str(dias_antes) + " dia(s)</strong> para o prazo final de propostas "
        "desta licitação que você está acompanhando." + html.escape(prazo_msg) + "</p>"
        "<p><strong>" + html.escape(objeto) + "</strong><br>"
        "<a href=\"" + html.escape(link) + "\">Ver no PNCP →</a></p>"
        + nota_html
    )
    return texto, html_corpo


def enviar_zeptomail(token, destino_email, nome_destinatario, texto, html_corpo):
    token = re.sub(r"^Zoho-enczapikey\s+", "", token.strip()).strip("\"'").strip()
    corpo = {
        "from": {"address": REMETENTE_ZEPTO, "name": "LicitaPlena"},
        "to": [{"email_address": {"address": destino_email, "name": nome_destinatario}}],
        "subject": "Lembrete: prazo de proposta se aproxima",
        "textbody": texto,
        "htmlbody": html_corpo,
    }
    req = urllib.request.Request(
        ZEPTOMAIL_URL, data=json.dumps(corpo).encode("utf-8"), method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": "Zoho-enczapikey " + token},
    )
    with urllib.request.urlopen(req, timeout=20):
        pass


def enviar_email(destino_email, nome_destinatario, lembrete):
    texto, html_corpo = montar_corpo_email(nome_destinatario, lembrete)
    token = os.environ.get("ZEPTOMAIL_TOKEN")
    if token:
        enviar_zeptomail(token, destino_email, nome_destinatario, texto, html_corpo)
        return
    remetente = os.environ["EMAIL_REMETENTE"]
    senha_app = os.environ["EMAIL_SENHA_APP"]

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Lembrete: prazo de proposta se aproxima"
    msg["From"] = formataddr((str(Header(NOME_REMETENTE, "utf-8")), remetente))
    msg["To"] = destino_email
    msg.attach(MIMEText(texto, "plain", "utf-8"))
    msg.attach(MIMEText(html_corpo, "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as servidor:
        servidor.login(remetente, senha_app)
        servidor.sendmail(remetente, [destino_email], msg.as_string())


def marcar_como_enviado(lembrete_id, enviado=True):
    _requisicao_supabase(
        "/rest/v1/lembretes?id=eq." + urllib.parse.quote(lembrete_id),
        metodo="PATCH",
        corpo={"enviado": True, **({"enviado_em": datetime.now(timezone.utc).isoformat()} if enviado else {})},
        headers_extra={"Prefer": "return=minimal"},
    )


def main():
    log("=== Verificando lembretes de licitação pendentes ===")
    so_registrar = os.environ.get("LEMBRETES_SO_REGISTRAR") == "1"
    agora = datetime.now(timezone.utc)
    pendentes = carregar_lembretes_pendentes()
    expirados = [l for l in pendentes if situacao(l, agora) == "expirado"]
    hoje_lista = [l for l in pendentes if situacao(l, agora) == "enviar"]
    log(str(len(pendentes)) + " pendente(s): " + str(len(hoje_lista)) + " no momento do aviso, " + str(len(expirados)) + " com prazo vencido.")

    # Prazo vencido sem aviso (rodada perdida ou lembrete criado tarde): so fecha, sem e-mail fora de hora.
    if not so_registrar:
        for lembrete in expirados:
            marcar_como_enviado(lembrete["id"], enviado=False)

    enviados = 0
    for lembrete in hoje_lista:
        cliente = buscar_cliente(lembrete["cliente_id"])
        email = (cliente or {}).get("email")
        if not email:
            log("AVISO: lembrete " + lembrete["id"] + " sem e-mail de cliente encontrado, pulando.")
            continue
        nome = (cliente or {}).get("empresa") or (cliente or {}).get("nome") or "Cliente"
        if so_registrar:
            log("[SO REGISTRAR] enviaria para " + email + ": licitação " + str(lembrete.get("numero_controle_pncp")) + ", aviso " + str(lembrete.get("dias_antes")) + " dia(s) antes às " + str(lembrete.get("hora_aviso")) + "h.")
            enviados += 1
            continue
        try:
            enviar_email(email, nome, lembrete)
            marcar_como_enviado(lembrete["id"])
            enviados += 1
            log("Lembrete enviado para " + email + " (licitação " + str(lembrete.get("numero_controle_pncp")) + ").")
        except Exception as e:
            log("ERRO ao enviar lembrete " + lembrete["id"] + " para " + email + ": " + str(e))

    log("=== Concluído: " + str(enviados) + " lembrete(s) " + ("registrado(s), nada enviado" if so_registrar else "enviado(s)") + " ===")


if __name__ == "__main__":
    main()
