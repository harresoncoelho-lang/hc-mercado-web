import importlib.util
import io
import base64
import json
import os
import shutil
import subprocess
import zlib
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('anexo', Path(__file__).with_name('extrair_anexo.py'))
anexo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(anexo)

class AnexosTest(unittest.TestCase):
    def arquivo(self, nome, conteudo):
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        caminho = Path(pasta.name) / nome
        caminho.write_bytes(conteudo)
        return caminho

    def test_texto_curto_valido(self):
        r = anexo.extrair(self.arquivo('errata.txt', 'Prazo prorrogado para 30/10/2026.'.encode()))
        self.assertIn('30/10/2026', r['texto'])
        self.assertEqual([], r['pendencias'])

    def test_zip_aninhado_preserva_falha(self):
        interno = io.BytesIO()
        with zipfile.ZipFile(interno, 'w') as z:
            z.writestr('termo.txt', 'Exigir capacidade técnica e proposta comercial.')
            z.writestr('arquivo.desconhecido', b'nao reconhecido')
        externo = io.BytesIO()
        with zipfile.ZipFile(externo, 'w') as z:
            z.writestr('anexos.zip', interno.getvalue())
        r = anexo.extrair(self.arquivo('edital.zip', externo.getvalue()))
        self.assertIn('capacidade', r['texto'])
        self.assertTrue(any('desconhecido' in p for p in r['pendencias']))

    def test_zip_travessia_e_limite(self):
        arquivo = io.BytesIO()
        with zipfile.ZipFile(arquivo, 'w') as z:
            z.writestr('../fuga.txt', 'Não extrair')
            z.writestr('grande.txt', 'x' * 200)
        r = anexo.extrair(self.arquivo('edital.zip', arquivo.getvalue()), max_bytes=100)
        self.assertTrue(r['pendencias'])
        self.assertEqual('', r['texto'])

    def test_zip_travessia_com_orcamento_suficiente(self):
        dados = io.BytesIO()
        with zipfile.ZipFile(dados, 'w') as z:
            z.writestr('../fuga.txt', 'Não extrair')
            z.writestr('edital.txt', 'Proposta comercial em 5 dias')
        r = anexo.extrair(self.arquivo('pacote.zip', dados.getvalue()))
        self.assertIn('5 dias', r['texto'])
        self.assertNotIn('Não extrair', r['texto'])
        self.assertTrue(any('caminho inseguro' in p for p in r['pendencias']))

    def test_zip_mimetype_expandido_bloqueado(self):
        dados = io.BytesIO()
        with zipfile.ZipFile(dados, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr('mimetype', b'X' * 100000)
        r = anexo.extrair(self.arquivo('pacote.zip', dados.getvalue()), max_bytes=1000)
        self.assertFalse(r['texto'])
        self.assertTrue(any('expansão' in p for p in r['pendencias']))

    def test_csv_preserva_colunas(self):
        r = anexo.extrair(self.arquivo('itens.csv', 'Item;Quantidade;Valor\nCimento;20;35,50'.encode()))
        self.assertIn('Quantidade', r['texto'])
        self.assertIn('35,50', r['texto'])

    def test_corte_de_texto_nunca_e_completo(self):
        r = anexo.extrair(self.arquivo('edital.txt', b'A' * anexo.MAX_TEXTO))
        self.assertTrue(any('limite de texto' in p for p in r['pendencias']))
        self.assertLessEqual(len(r['texto']), anexo.MAX_TEXTO)

    def test_docx_preserva_cabecalho_e_sinaliza_imagem(self):
        dados = io.BytesIO()
        with zipfile.ZipFile(dados, 'w') as z:
            z.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Exigir proposta comercial</w:t></w:r></w:p></w:document>')
            z.writestr('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Prazo de 15 dias</w:t></w:r></w:p></w:hdr>')
            z.writestr('word/media/image1.png', b'imagem')
        r = anexo.extrair(self.arquivo('edital.docx', dados.getvalue()))
        self.assertIn('15 dias', r['texto'])
        self.assertTrue(any('image1.png' in p for p in r['pendencias']))

    def test_docx_altchunk_nao_parece_integral(self):
        dados = io.BytesIO()
        with zipfile.ZipFile(dados, 'w') as z:
            z.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Objeto contratado</w:t></w:r></w:p><w:altChunk/></w:document>')
            z.writestr('word/afchunk.html', '<p>Exigir proposta em 2 dias</p>')
        r = anexo.extrair(self.arquivo('edital.docx', dados.getvalue()))
        self.assertIn('Objeto contratado', r['texto'])
        self.assertTrue(any('altChunk' in p for p in r['pendencias']))

    def test_grupo_rar_nao_oculta_arquivo_independente(self):
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        arquivos = [(Path(pasta.name) / n, n) for n in ['edital.rar', 'edital']]
        for p, _ in arquivos:
            p.write_bytes(b'teste')
        leitor = anexo.Leitor()
        lidos = []
        leitor.ler = lambda caminho, nome, nivel: lidos.append(nome)
        leitor.ler_pasta(arquivos, 1)
        self.assertEqual(2, len(lidos))

    def test_indices_rar_ambiguos_nao_sao_descartados(self):
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        arquivos = [(Path(pasta.name) / n, n) for n in ['edital.part1.rar', 'edital.part01.rar']]
        for p, _ in arquivos:
            p.write_bytes(b'teste')
        leitor = anexo.Leitor()
        lidos = []
        leitor.ler = lambda caminho, nome, nivel: lidos.append(nome)
        leitor.ler_pasta(arquivos, 1)
        self.assertFalse(lidos)
        self.assertTrue(any('duplicado' in p for p in leitor.pendencias))

    def test_nao_executa_programa(self):
        r = anexo.extrair(self.arquivo('anexo.exe', b'MZfake'))
        self.assertFalse(r['texto'])
        self.assertTrue(r['pendencias'])


@unittest.skipUnless(os.environ.get('TESTAR_CONVERSORES') == '1', 'integração exige imagem isolada de conversores')
class ConversoresTest(unittest.TestCase):
    arquivo = AnexosTest.arquivo
    def test_pdf_textual_e_digitalizado_e_imagem(self):
        fixtures = json.loads((Path(__file__).parent / 'fixtures/anexos-ocr.json').read_text())
        for chave, nome, trecho in [('pdfTexto', 'normal.pdf', '20 dias'), ('pdfEscaneado', 'scan.pdf', '15 dias'), ('png', 'scan.png', '15 dias')]:
            with self.subTest(chave=chave):
                r = anexo.extrair(self.arquivo(nome, base64.b64decode(fixtures[chave])))
                self.assertIn(trecho, r['texto'])
                self.assertEqual([], r['pendencias'])

    def test_word_somente_imagem_recebe_ocr(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/anexos-ocr.json').read_text())
        dados = io.BytesIO()
        with zipfile.ZipFile(dados, 'w') as z:
            z.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:document>')
            z.writestr('word/media/image1.png', base64.b64decode(fixture['png']))
        r = anexo.extrair(self.arquivo('edital.docx', dados.getvalue()))
        self.assertIn('15 dias', r['texto'])
        self.assertEqual([], r['pendencias'])

    def test_word_antigo_e_planilha_com_aba_oculta(self):
        rtf = self.arquivo('edital.rtf', b'{\\rtf1\\ansi Exigir proposta comercial. Prazo de entrega: 12 dias.}')
        r = anexo.extrair(rtf)
        self.assertIn('12 dias', r['texto'])
        self.assertEqual([], r['pendencias'])
        # Converte para Word binário e planilha real sem bibliotecas de teste adicionais.
        subprocess.run(['libreoffice', '-env:UserInstallation=' + (rtf.parent / 'perfil-doc').as_uri(), '--headless', '--convert-to', 'doc', '--outdir', str(rtf.parent), str(rtf)], check=True, capture_output=True)
        r = anexo.extrair(rtf.with_suffix('.doc'))
        self.assertIn('12 dias', r['texto'])
        self.assertEqual([], r['pendencias'])
        ods = io.BytesIO()
        with zipfile.ZipFile(ods, 'w') as z:
            z.writestr('mimetype', 'application/vnd.oasis.opendocument.spreadsheet')
            z.writestr('META-INF/manifest.xml', '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>')
            z.writestr('content.xml', '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="Itens"><table:table-row><table:table-cell office:value-type="string"><text:p>Quantidade 25 cimento</text:p></table:table-cell></table:table-row></table:table><table:table table:name="Custos"><table:table-row><table:table-cell office:value-type="string"><text:p>Custo 12500 reais</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>')
        caminho = self.arquivo('planilha.ods', ods.getvalue())
        for ext in ['ods', 'xlsx', 'xls']:
            if ext != 'ods':
                subprocess.run(['libreoffice', '-env:UserInstallation=' + (caminho.parent / ('perfil-' + ext)).as_uri(), '--headless', '--convert-to', ext, '--outdir', str(caminho.parent), str(caminho)], check=True, capture_output=True)
            r = anexo.extrair(caminho.with_suffix('.' + ext))
            self.assertIn('Quantidade 25', r['texto'])
            self.assertIn('12500', r['texto'])
            self.assertEqual([], r['pendencias'])

    def test_aba_oculta_formula_e_extensao_errada(self):
        from openpyxl import Workbook
        w = Workbook()
        w.active['A1'] = 'Item principal'
        escondida = w.create_sheet('Custos ocultos')
        escondida.sheet_state = 'hidden'
        escondida['B2'] = 12500
        escondida['C2'] = '=B2*2'
        dados = io.BytesIO()
        w.save(dados)
        r = anexo.extrair(self.arquivo('anexo.bin', dados.getvalue()))
        self.assertIn('12500', r['texto'])
        self.assertIn('Custos ocultos', r['texto'])
        self.assertTrue(any('fórmula sem resultado' in p for p in r['pendencias']))
        imagens = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(dados.getvalue())) as entrada, zipfile.ZipFile(imagens, 'w') as saida:
            for item in entrada.infolist():
                saida.writestr(item, entrada.read(item))
            saida.writestr('xl/media/image1.png', b'imagem')
        r = anexo.extrair(self.arquivo('planilha.xlsx', imagens.getvalue()))
        self.assertTrue(any('image1.png' in p for p in r['pendencias']))


    def test_rar_antigo_moderno_e_senha(self):
        fixtures = json.loads((Path(__file__).parent / 'fixtures/anexos-rar.json').read_text())
        for nome, dados in fixtures.items():
            r = anexo.extrair(self.arquivo(nome, base64.b64decode(dados)))
            if 'psw' in nome:
                self.assertFalse(r['texto'])
                self.assertTrue(r['pendencias'])
            else:
                self.assertTrue(r['texto'], r)
                self.assertEqual([], r['pendencias'])

    def test_volumes_rar_dentro_de_zip_e_7z(self):
        fixtures = json.loads((Path(__file__).parent / 'fixtures/anexos-rar-volumes.json').read_text())['files']
        for prefixo in ['rar3-vols.', 'rar5-vols.', 'rar3-old.']:
            pasta = tempfile.TemporaryDirectory()
            self.addCleanup(pasta.cleanup)
            pacote = Path(pasta.name) / 'pacote.zip'
            with zipfile.ZipFile(pacote, 'w') as z:
                for n, v in fixtures.items():
                    if n.startswith(prefixo):
                        z.writestr('Anexos/' + n, zlib.decompress(base64.b64decode(v)))
            r = anexo.extrair(pacote)
            self.assertEqual([], r['pendencias'], r)
            self.assertEqual(1, r['texto'].count('bigfile.txt'))
            self.assertIn('smallfile.txt', r['texto'])
            with zipfile.ZipFile(pacote) as z:
                nomes = []
                for item in z.infolist():
                    arquivo = Path(pasta.name) / Path(item.filename).name
                    arquivo.write_bytes(z.read(item))
                    nomes.append(str(arquivo))
            externo = Path(pasta.name) / 'externo.7z'
            subprocess.run(['7z', 'a', str(externo), *nomes], check=True, capture_output=True)
            r = anexo.extrair(externo)
            self.assertEqual([], r['pendencias'])
            self.assertEqual(1, r['texto'].count('bigfile.txt'))
            self.assertIn('smallfile.txt', r['texto'])
        primeiro = next(n for n in fixtures if n == 'rar5-vols.part1.rar')
        with zipfile.ZipFile(pacote, 'w') as z:
            z.writestr(primeiro, zlib.decompress(base64.b64decode(fixtures[primeiro])))
        r = anexo.extrair(pacote)
        self.assertTrue(r['pendencias'])
        self.assertFalse(r['texto'])

    def test_7z_com_zip_dentro_e_corrompido(self):
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        caminho = Path(pasta.name) / 'anexo.zip'
        with zipfile.ZipFile(caminho, 'w') as z:
            z.writestr('termo.txt', 'Exigir capacidade tecnica e entrega em 14 dias.')
        arquivo = caminho.with_suffix('.7z')
        subprocess.run(['7z', 'a', str(arquivo), str(caminho)], check=True, capture_output=True)
        r = anexo.extrair(arquivo)
        self.assertIn('14 dias', r['texto'])
        self.assertEqual([], r['pendencias'])
        r = anexo.extrair(self.arquivo('incompleto.rar', b'Rar!\x1a\x07\x01\x00danificado'))
        self.assertFalse(r['texto'])
        self.assertTrue(r['pendencias'])

if __name__ == '__main__':
    unittest.main()
