# -*- coding: utf-8 -*-
from datetime import datetime, timezone

import os
from unittest.mock import patch

import lembretes_licitacoes as lic
from lembretes_licitacoes import momento_do_aviso, montar_corpo_email, situacao

# Prazo 20/11/2026 17:00 em Brasília (UTC-3) = 20:00Z.
LEMBRETE = {"data_final_proposta": "2026-11-20T20:00:00+00:00", "dias_antes": 2, "hora_aviso": 7,
            "numero_controle_pncp": "11222333000181-1-000001/2026", "objeto_resumo": "Limpeza <b>x</b>", "nota": "<script>"}


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def test_momento_do_aviso_usa_hora_de_brasilia_e_dias_antes():
    assert momento_do_aviso(LEMBRETE).astimezone(timezone.utc) == utc(2026, 11, 18, 10)


def test_prazo_na_madrugada_utc_conta_o_dia_de_brasilia():
    # 01:00Z de 21/11 ainda é 20/11 em Brasília: 1 dia antes = 19/11 às 08h = 11:00Z.
    lembrete = {"data_final_proposta": "2026-11-21T01:00:00+00:00", "dias_antes": 1, "hora_aviso": 8}
    assert momento_do_aviso(lembrete).astimezone(timezone.utc) == utc(2026, 11, 19, 11)


def test_situacao_aguardar_enviar_expirado():
    assert situacao(LEMBRETE, utc(2026, 11, 18, 9, 59)) == "aguardar"
    assert situacao(LEMBRETE, utc(2026, 11, 18, 10, 0)) == "enviar"
    # Rodada perdida: horas depois ainda envia, desde que o prazo não tenha vencido.
    assert situacao(LEMBRETE, utc(2026, 11, 20, 19, 59)) == "enviar"
    assert situacao(LEMBRETE, utc(2026, 11, 20, 20, 0)) == "expirado"


def test_lembrete_antigo_sem_hora_avisa_as_8h_e_sem_prazo_nunca_envia():
    antigo = {"data_final_proposta": "2026-11-20T20:00:00+00:00", "dias_antes": 0}
    assert momento_do_aviso(antigo).astimezone(timezone.utc) == utc(2026, 11, 20, 11)
    assert situacao({"data_final_proposta": None, "dias_antes": 1}, utc(2030, 1, 1)) == "aguardar"


def test_corpo_do_email_escapa_html_e_mostra_o_prazo():
    texto, html_corpo = montar_corpo_email("Empresa <A>", LEMBRETE)
    assert "20/11/2026 17:00" in texto
    assert "<script>" not in html_corpo and "&lt;script&gt;" in html_corpo
    assert "<b>x</b>" not in html_corpo and "Empresa &lt;A&gt;" in html_corpo


def _rodar_main(reserva, envio_falha=False):
    chamadas = []
    lembrete = {**LEMBRETE, "id": "L1", "cliente_id": "C1", "enviado": False}

    def enviar(*a):
        chamadas.append("enviar")
        if envio_falha:
            raise RuntimeError("smtp")
    with patch.multiple(
        lic,
        carregar_lembretes_pendentes=lambda: [lembrete],
        situacao=lambda l, agora: "enviar",
        buscar_cliente=lambda _id: {"email": "a@b.c", "nome": "A"},
        reservar_envio=lambda i: chamadas.append("reservar") or reserva,
        liberar_envio=lambda i: chamadas.append("liberar"),
        enviar_email=enviar,
    ), patch.dict(os.environ, {"LEMBRETES_SO_REGISTRAR": "0"}):
        lic.main()
    return chamadas


def test_reserva_antes_de_enviar():
    assert _rodar_main(True) == ["reservar", "enviar"]


def test_outra_rodada_ja_reservou_nao_envia():
    assert _rodar_main(False) == ["reservar"]


def test_envio_falho_devolve_lembrete_para_a_fila():
    assert _rodar_main(True, envio_falha=True) == ["reservar", "enviar", "liberar"]
