# -*- coding: utf-8 -*-
from boletim_editais import filtrar_por_palavra_chave


def test_filtrar_por_palavra_chave_ignora_acentos_e_maiusculas():
    editais = [
        {"objetoCompra": "Aquisicao de Equipamentos de Informatica"},
        {"objetoCompra": "Contratacao de servicos de limpeza"},
    ]

    filtrados = filtrar_por_palavra_chave(editais, ["informática"])

    assert filtrados == [editais[0]]


def test_filtrar_por_palavra_chave_sem_palavras_retorna_todos():
    editais = [
        {"objetoCompra": "Aquisicao de Equipamentos de Informatica"},
        {"objetoCompra": "Contratacao de servicos de limpeza"},
    ]

    assert filtrar_por_palavra_chave(editais, []) == editais
