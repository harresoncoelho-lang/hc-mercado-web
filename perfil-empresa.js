/* global module, btoa */
// Perfil da empresa (esteira E12): preenchido uma vez, usado pela proposta e pelas declarações.
// Contrato no servidor: netlify/functions/empresa-identificacao.js (lerPerfil, salvarPerfil, registrarLogo).
(function (raiz) {
  'use strict';
  const LOGO = Object.freeze({ bytes: 512 * 1024, px: 2000 });
  const SIMPLES = ['nome_fantasia', 'telefone', 'email', 'inscricao_estadual', 'inscricao_municipal', 'porte', 'regime_tributario', 'aliquota_efetiva', 'tributos_fonte', 'cpf_representante', 'uf_sede'];
  const GRUPOS = { banco: ['banco', 'agencia', 'conta', 'pix', 'favorecido'], proposta_padrao: ['validade', 'pagamento', 'prazo_entrega'] };
  const PERCENTUAIS = ['tributos_percentual', 'frete_percentual', 'garantia_percentual', 'margem_percentual', 'margem_minima_percentual'];
  const ROTULOS = {
    nome_fantasia: 'Nome fantasia', telefone: 'Telefone', email: 'E-mail', inscricao_estadual: 'Inscrição estadual', inscricao_municipal: 'Inscrição municipal',
    porte: 'Porte', regime_tributario: 'Regime tributário', aliquota_efetiva: 'Alíquota efetiva (%)', tributos_fonte: 'De onde vem a alíquota', cpf_representante: 'CPF do representante', uf_sede: 'UF da sede',
    'banco.banco': 'Banco', 'banco.agencia': 'Agência', 'banco.conta': 'Conta', 'banco.pix': 'Chave Pix', 'banco.favorecido': 'Favorecido',
    'proposta_padrao.validade': 'Validade da proposta', 'proposta_padrao.pagamento': 'Condição de pagamento', 'proposta_padrao.prazo_entrega': 'Prazo de entrega',
    segmento: 'Segmento', uf: 'UF', tributos_percentual: 'Tributos (%)', frete_percentual: 'Frete (%)', garantia_percentual: 'Garantia (%)', margem_percentual: 'Margem (%)', margem_minima_percentual: 'Margem mínima (%)',
    logo: 'Logo', hash: 'Logo', caminho: 'Logo', perfil: 'Perfil', premissas: 'Premissas',
  };

  // ---------- Logo: mesma leitura de cabeçalho do servidor (_empresa_identificacao.js), sem biblioteca. ----------
  const u16 = (b, i) => (b[i] << 8) | b[i + 1];
  const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  function dimensoesLogo(b) {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (b.length >= 24 && png.every((v, i) => b[i] === v) && String.fromCharCode(b[12], b[13], b[14], b[15]) === 'IHDR') return { ext: 'png', largura: u32(b, 16), altura: u32(b, 20) };
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
    for (let i = 2; i + 3 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
      if (m === 0xd9 || m === 0xda) return null;
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return i + 9 <= b.length ? { ext: 'jpg', altura: u16(b, i + 5), largura: u16(b, i + 7) } : null;
      i += 2 + u16(b, i + 2);
    }
    return null;
  }
  // Conferência no navegador antes de gastar o envio; o servidor confere de novo em registrarLogo.
  function validarLogo(bytes) {
    if (bytes.length > LOGO.bytes) return { erro: 'A logo deve ter no máximo 512 KB.' };
    const img = dimensoesLogo(bytes);
    if (!img) return { erro: 'Envie a logo em PNG ou JPEG.' };
    if (!img.largura || !img.altura || img.largura > LOGO.px || img.altura > LOGO.px) return { erro: 'A logo deve ter no máximo 2000 px de largura e de altura.' };
    return img;
  }
  async function sha256Hex(bytes, subtle = raiz.crypto.subtle) {
    return [...new Uint8Array(await subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const caminhoLogo = (org, empresa, hash, ext) => `${org}/${empresa}/perfil/logo-${hash}.${ext}`;

  // ---------- Formulário <-> payload ----------
  const texto = v => v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  // Valores do formulário como texto plano (chave "banco.conta").
  function valoresDoPerfil(perfil) {
    const p = perfil || {}, v = {};
    for (const k of SIMPLES) v[k] = texto(p[k]);
    if (!v.tributos_fonte) v.tributos_fonte = 'manual';
    for (const [g, chaves] of Object.entries(GRUPOS)) for (const k of chaves) v[`${g}.${k}`] = texto(p[g]?.[k]);
    return v;
  }
  // Nada digitado duas vezes: o favorecido vazio vem da razão social já cadastrada e a UF da sede
  // vazia vem do endereço confirmado na identificação (ufSedeSugerida do servidor).
  function sugestoes(valores, empresa, ufSedeSugerida) {
    const s = { ...valores };
    if (!s['banco.favorecido'] && empresa?.razao_social) s['banco.favorecido'] = empresa.razao_social;
    if (!s.uf_sede && UFS.includes(ufSedeSugerida)) s.uf_sede = ufSedeSugerida;
    return s;
  }
  // Linha "Padrão (todos)" sempre existe e vem primeiro.
  function linhasDePremissas(premissas) {
    const linhas = (premissas || []).map(p => ({ segmento: p.segmento || '*', uf: p.uf || '*', ...Object.fromEntries(PERCENTUAIS.map(k => [k, texto(p[k])])) }));
    const i = linhas.findIndex(l => l.segmento === '*' && l.uf === '*');
    const padrao = i >= 0 ? linhas.splice(i, 1)[0] : { segmento: '*', uf: '*', ...Object.fromEntries(PERCENTUAIS.map(k => [k, ''])) };
    return [padrao, ...linhas];
  }
  // Mesma normalização do servidor (chavePremissa em _empresa_identificacao.js).
  const chaveLinha = l => `${(l.segmento.trim() || '*').normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()}|${l.uf.trim().toUpperCase() || '*'}`;
  // Linha extra sem segmento nem UF repetiria a Padrão: índice da primeira, ou -1.
  const linhaSemChave = linhas => linhas.findIndex((l, i) => i > 0 && l.segmento.trim() === '*' && l.uf.trim() === '*');
  // Só vai ao servidor o que mudou: o CPF mascarado intacto nunca volta, e grupos jsonb vão inteiros.
  function montarPayload(inicial, atual, linhasIniciais, linhasAtuais) {
    const perfil = {};
    for (const k of SIMPLES) if ((atual[k] ?? '') !== (inicial[k] ?? '')) perfil[k] = String(atual[k] ?? '').trim();
    for (const [g, chaves] of Object.entries(GRUPOS)) {
      if (chaves.some(k => (atual[`${g}.${k}`] ?? '') !== (inicial[`${g}.${k}`] ?? ''))) perfil[g] = Object.fromEntries(chaves.map(k => [k, String(atual[`${g}.${k}`] ?? '').trim()]));
    }
    const corpo = {};
    if (Object.keys(perfil).length) corpo.perfil = perfil;
    if (JSON.stringify(linhasAtuais) !== JSON.stringify(linhasIniciais)) {
      corpo.premissas = linhasAtuais.map(l => ({ segmento: l.segmento.trim(), uf: l.uf.trim(), ...Object.fromEntries(PERCENTUAIS.map(k => [k, l[k].trim()])) }));
      // Linha salva que sumiu (removida ou com segmento/UF trocado) é apagada no banco; Padrão fica sempre.
      const ficam = new Set(linhasAtuais.map(chaveLinha));
      const remover = linhasIniciais.filter(l => !(l.segmento === '*' && l.uf === '*') && !ficam.has(chaveLinha(l))).map(l => ({ segmento: l.segmento, uf: l.uf }));
      if (remover.length) corpo.premissasRemover = remover;
      // salvarPerfil exige o objeto perfil; vazio não altera nada no banco.
      corpo.perfil ??= {};
    }
    return corpo.perfil ? corpo : null;
  }

  // ---------- Erro 422 -> campo da tela ----------
  // "banco.conta" -> perfil-banco-conta; "premissas[2].uf" -> perfil-premissas-2-uf; "premissas[2]" -> perfil-premissas-2.
  function idDoCampo(campo) {
    if (typeof campo !== 'string' || !campo) return null;
    if (['logo', 'hash', 'caminho'].includes(campo)) return 'perfil-logo';
    if (campo === 'perfil') return null;
    return 'perfil-' + campo.replace(/\[(\d+)\]/g, '-$1').replace(/\./g, '-');
  }
  function rotuloDoCampo(campo) {
    const m = /^premissas\[(\d+)\](?:\.(\w+))?$/.exec(campo || '');
    if (m) return `Premissas, linha ${Number(m[1]) + 1}${m[2] ? `, ${ROTULOS[m[2]] || m[2]}` : ''}`;
    if (/^premissasRemover/.test(campo || '')) return 'Premissas removidas';
    return ROTULOS[campo] || campo || '';
  }
  // A mensagem do servidor cita o nome técnico do campo; a tela mostra o rótulo.
  function mensagemDoErro(status, corpo) {
    if (status === 503) return 'O perfil da empresa ainda não está disponível neste ambiente.';
    if (status === 403) return 'Seu acesso é só de leitura. Peça a um gestor para preencher o perfil.';
    const erro = corpo?.erro || 'Não foi possível concluir. Tente novamente.', campo = corpo?.campo;
    if (!campo) return erro;
    return erro.includes(campo) ? erro.replace(campo, rotuloDoCampo(campo)) : `${rotuloDoCampo(campo)}: ${erro}`;
  }

  // ---------- Tela ----------
  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  const OPCOES = {
    uf_sede: [['', 'Escolha'], ...UFS.map(uf => [uf, uf])],
    porte: [['', 'Escolha'], ['mei', 'MEI'], ['me', 'Microempresa (ME)'], ['epp', 'Pequeno porte (EPP)'], ['demais', 'Demais']],
    regime_tributario: [['', 'Escolha'], ['mei', 'MEI'], ['simples', 'Simples Nacional'], ['presumido', 'Lucro presumido'], ['real', 'Lucro real']],
    tributos_fonte: [['manual', 'Eu informo'], ['contador', 'Informada pelo contador']],
  };
  const CAMPOS_TELA = [
    ['Contato', [['nome_fantasia', 180], ['telefone', 30, 'tel'], ['email', 254, 'email'], ['inscricao_estadual', 30], ['inscricao_municipal', 30], ['uf_sede'], ['cpf_representante', 14, 'cpf']]],
    ['Impostos', [['porte'], ['regime_tributario'], ['aliquota_efetiva', 7, 'decimal'], ['tributos_fonte']]],
    ['Dados bancários', [['banco.banco', 120], ['banco.agencia', 120, 'numeric'], ['banco.conta', 120], ['banco.pix', 120], ['banco.favorecido', 120]]],
    ['Proposta padrão', [['proposta_padrao.validade', 200], ['proposta_padrao.pagamento', 200], ['proposta_padrao.prazo_entrega', 200]]],
  ];

  function montar({ alvo, obterSessao, requisitar = raiz.fetch?.bind(raiz), enviarLogo }) {
    const doc = alvo.ownerDocument;
    let vigente = null;
    function aviso(texto) { alvo.replaceChildren(); const p = doc.createElement('p'); p.setAttribute('role', 'status'); p.textContent = texto; alvo.append(p); }
    function abrir({ empresa, orgId }) {
      if (!empresa?.id) { vigente = null; aviso('Selecione ou adicione uma empresa para preencher o perfil.'); return; }
      const contexto = {}; vigente = contexto;
      const ativo = () => vigente === contexto;
      aviso('Carregando perfil…');
      async function solicitar(dados) {
        const sessao = await obterSessao();
        if (!sessao?.accessToken) return { status: 401, corpo: { erro: 'Sua sessão expirou. Entre novamente.' } };
        try {
          const r = await requisitar('/api/empresa-identificacao', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.accessToken}` }, body: JSON.stringify({ ...dados, empresaId: empresa.id }) });
          let corpo = {}; try { corpo = await r.json(); } catch { corpo = {}; }
          return { status: r.status, corpo };
        } catch { return { status: 0, corpo: { erro: 'Sem conexão. Confira a internet e tente de novo.' } }; }
      }
      void (async () => {
        const { status, corpo } = await solicitar({ acao: 'lerPerfil' });
        if (!ativo()) return;
        // Leitura recebe 403 do servidor; o papel na resposta é só segunda barreira da tela.
        if (status !== 200 || corpo.papel === 'leitura') { aviso(mensagemDoErro(status === 200 ? 403 : status, corpo)); return; }
        desenhar({ empresa, orgId, ativo, solicitar, resposta: corpo });
      })();
    }
    function desenhar({ empresa, orgId, ativo, solicitar, resposta }) {
      let inicial = valoresDoPerfil(resposta.perfil);
      let linhasIniciais = linhasDePremissas(resposta.premissas);
      let linhas = linhasIniciais.map(l => ({ ...l }));
      const gestor = resposta.papel === 'gestor';
      const opcoes = k => OPCOES[k].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
      const campo = ([k, max, tipo]) => {
        const id = idDoCampo(k), extra = tipo === 'tel' ? ' type="tel" inputmode="tel" autocomplete="tel"' : tipo === 'email' ? ' type="email" autocomplete="email"' : tipo === 'decimal' ? ' inputmode="decimal" placeholder="Ex.: 6,5"' : tipo === 'numeric' ? ' inputmode="numeric"' : tipo === 'cpf' ? ' inputmode="numeric" placeholder="000.000.000-00"' : '';
        const entrada = OPCOES[k] ? `<select id="${id}" data-campo="${k}">${opcoes(k)}</select>` : `<input id="${id}" data-campo="${k}" maxlength="${max}"${extra}>`;
        const botaoCpf = k === 'cpf_representante' && gestor ? '<button type="button" class="link" id="perfil-mostrar-cpf">Mostrar CPF completo</button>' : '';
        return `<div><label for="${id}">${ROTULOS[k]}</label>${entrada}${botaoCpf}</div>`;
      };
      alvo.innerHTML = `
        <div class="perfil-cabeca"><div><h2>Perfil da empresa</h2><p>Preencha uma vez. A proposta e as declarações usam estes dados.</p><p class="nota" id="perfil-identidade"></p></div>
          <div class="perfil-logo"><img id="perfil-logo-previa" alt="Logo da empresa" hidden><label for="perfil-logo" class="btn">Enviar logo</label><input id="perfil-logo" type="file" accept="image/png,image/jpeg" class="perfil-arquivo"><span class="nota">PNG ou JPEG, até 512 KB</span><div id="perfil-logo-aviso" class="aviso" role="status"></div></div></div>
        ${CAMPOS_TELA.map(([titulo, campos]) => `<fieldset class="perfil-grupo"><legend>${titulo}</legend><div class="form-grade">${campos.map(campo).join('')}</div></fieldset>`).join('')}
        <fieldset class="perfil-grupo"><legend>Premissas de preço</legend><p class="nota">Usadas quando o processo não tem valor próprio. Linha mais específica vale primeiro.</p>
          <div class="tabela-wrap"><table class="tabela perfil-premissas"><thead><tr><th>Segmento</th><th>UF</th>${PERCENTUAIS.map(k => `<th>${ROTULOS[k]}</th>`).join('')}<th></th></tr></thead><tbody id="perfil-premissas"></tbody></table></div>
          <button type="button" class="btn" id="perfil-add-premissa">+ Linha</button></fieldset>
        <div id="perfil-aviso" class="aviso" role="status"></div>
        <div class="perfil-rodape"><button type="button" class="btn primario" id="perfil-salvar">Salvar perfil</button></div>`;
      const $ = id => doc.getElementById(id);
      // O aviso fica perto de quem agiu: logo no topo, salvar no rodapé.
      const avisoTela = (texto, tipo, onde = 'perfil-aviso') => { const el = $(onde); el.textContent = texto; el.className = texto ? `aviso ${tipo}` : 'aviso'; };
      const cnpj = /^\d{14}$/.test(empresa.cnpj || '') ? empresa.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : empresa.cnpj;
      $('perfil-identidade').textContent = [empresa.razao_social, cnpj].filter(Boolean).join(' · ') + ' (vem de Dados da empresa)';
      if (empresa.razao_social) $(idDoCampo('nome_fantasia')).placeholder = empresa.razao_social;
      if (resposta.logoUrl) { $('perfil-logo-previa').src = resposta.logoUrl; $('perfil-logo-previa').hidden = false; }
      const preencher = v => { for (const el of alvo.querySelectorAll('[data-campo]')) el.value = v[el.dataset.campo] ?? ''; };
      const lerCampos = () => Object.fromEntries([...alvo.querySelectorAll('[data-campo]')].map(el => [el.dataset.campo, el.value]));
      preencher(sugestoes(inicial, empresa, resposta.ufSedeSugerida));
      function desenharLinhas() {
        $('perfil-premissas').innerHTML = linhas.map((l, i) => `<tr id="perfil-premissas-${i}">
          ${i === 0 ? '<td colspan="2"><strong>Padrão (todos)</strong></td>' : `<td><input id="perfil-premissas-${i}-segmento" data-i="${i}" data-k="segmento" maxlength="80" aria-label="Segmento, linha ${i + 1}" placeholder="Ex.: limpeza"></td><td><input id="perfil-premissas-${i}-uf" data-i="${i}" data-k="uf" maxlength="2" aria-label="UF, linha ${i + 1}" placeholder="Todas" class="perfil-uf"></td>`}
          ${PERCENTUAIS.map(k => `<td><input id="perfil-premissas-${i}-${k}" data-i="${i}" data-k="${k}" inputmode="decimal" aria-label="${ROTULOS[k]}, linha ${i + 1}" class="perfil-pct"></td>`).join('')}
          <td>${i > 0 ? `<button type="button" class="link" data-remover="${i}" aria-label="Remover linha ${i + 1}">Remover</button>` : ''}</td></tr>`).join('');
        for (const el of $('perfil-premissas').querySelectorAll('[data-k]')) { const l = linhas[el.dataset.i]; el.value = el.dataset.k === 'segmento' || el.dataset.k === 'uf' ? (l[el.dataset.k] === '*' ? '' : l[el.dataset.k]) : l[el.dataset.k]; }
      }
      desenharLinhas();
      $('perfil-premissas').addEventListener('input', e => { const el = e.target; if (!el.dataset.k) return; const valor = el.dataset.k === 'uf' ? el.value.toUpperCase() : el.value; linhas[el.dataset.i][el.dataset.k] = (el.dataset.k === 'segmento' || el.dataset.k === 'uf') && !valor.trim() ? '*' : valor; });
      $('perfil-premissas').addEventListener('click', e => { const i = e.target.dataset?.remover; if (i === undefined) return; linhas.splice(Number(i), 1); desenharLinhas(); });
      $('perfil-add-premissa').onclick = () => {
        if (linhas.length >= 50) { avisoTela('Use até 50 linhas de premissas.', 'erro'); return; }
        linhas.push({ segmento: '*', uf: '*', ...Object.fromEntries(PERCENTUAIS.map(k => [k, ''])) }); desenharLinhas(); $(`perfil-premissas-${linhas.length - 1}-segmento`).focus();
      };
      const limparDestaque = () => { for (const el of alvo.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid'); };
      function destacar(campoErro) {
        const id = idDoCampo(campoErro); const el = id && ($(id) || $(id.replace(/-[a-z_]+$/, '')));
        if (!el) return;
        el.setAttribute('aria-invalid', 'true');
        const foco = el.matches('input,select') ? el : el.querySelector('input,select');
        foco?.focus(); el.scrollIntoView?.({ block: 'center' });
      }
      $('perfil-salvar').onclick = async () => {
        limparDestaque();
        const semChave = linhaSemChave(linhas);
        if (semChave >= 0) { avisoTela(`Premissas, linha ${semChave + 1}: Preencha segmento ou UF.`, 'erro'); destacar(`premissas[${semChave}].segmento`); return; }
        const atual = lerCampos(), corpo = montarPayload(inicial, atual, linhasIniciais, linhas);
        if (!corpo) { avisoTela('Nada mudou desde o último salvamento.', 'info'); return; }
        const botao = $('perfil-salvar'); botao.disabled = true; avisoTela('Salvando…', 'info');
        const { status, corpo: r } = await solicitar({ acao: 'salvarPerfil', ...corpo });
        if (!ativo()) return; botao.disabled = false;
        if (status !== 200) { avisoTela(mensagemDoErro(status, r), 'erro'); if (status === 422) destacar(r.campo); return; }
        inicial = valoresDoPerfil(r.perfil);
        if (corpo.premissas) linhasIniciais = linhasDePremissas(r.premissas);
        linhas = linhasIniciais.map(l => ({ ...l })); preencher(inicial); desenharLinhas();
        avisoTela('Perfil salvo. A proposta e as declarações já usam estes dados.', 'info');
      };
      if (gestor) $('perfil-mostrar-cpf').onclick = async () => {
        const { status, corpo: r } = await solicitar({ acao: 'lerPerfil', mostrarCpf: true });
        if (!ativo()) return;
        if (status !== 200) { avisoTela(mensagemDoErro(status, r), 'erro'); return; }
        const cpf = texto(r.perfil?.cpf_representante); inicial = { ...inicial, cpf_representante: cpf }; $(idDoCampo('cpf_representante')).value = cpf; $('perfil-mostrar-cpf').hidden = true;
      };
      $('perfil-logo').onchange = async e => {
        const arquivo = e.target.files?.[0]; e.target.value = ''; if (!arquivo) return;
        limparDestaque();
        const bytes = new Uint8Array(await arquivo.arrayBuffer());
        const img = validarLogo(bytes); if (img.erro) { avisoTela(img.erro, 'erro', 'perfil-logo-aviso'); destacar('logo'); return; }
        avisoTela('Enviando logo…', 'info', 'perfil-logo-aviso');
        let caminho, hash;
        // crypto.subtle só existe em HTTPS/localhost; sem ele, a falha aparece em vez de travar em "Enviando".
        try { hash = await sha256Hex(bytes); caminho = caminhoLogo(orgId, empresa.id, hash, img.ext); await enviarLogo(caminho, arquivo, img.ext === 'png' ? 'image/png' : 'image/jpeg'); } catch (erro) { if (ativo()) avisoTela('Não foi possível enviar a logo. ' + (erro?.message || ''), 'erro', 'perfil-logo-aviso'); return; }
        const { status, corpo: r } = await solicitar({ acao: 'registrarLogo', caminho, hash });
        if (!ativo()) return;
        if (status !== 200) { avisoTela(mensagemDoErro(status, r), 'erro', 'perfil-logo-aviso'); destacar('logo'); return; }
        $('perfil-logo-previa').src = dataUrlLogo(bytes, img.ext); $('perfil-logo-previa').hidden = false; avisoTela('Logo salva.', 'info', 'perfil-logo-aviso');
      };
    }
    return { abrir, limpar: texto => { vigente = null; aviso(texto); } };
  }

  // Prévia em data: URL. A CSP do site (img-src 'self' data: https:) bloqueia blob:, e a prévia
  // via URL.createObjectURL ficava em branco (achado no ambiente de teste local, 18/11).
  function dataUrlLogo(bytes, ext) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,${btoa(s)}`;
  }

  const api = { LOGO, dimensoesLogo, validarLogo, sha256Hex, caminhoLogo, dataUrlLogo, valoresDoPerfil, sugestoes, linhasDePremissas, montarPayload, linhaSemChave, idDoCampo, rotuloDoCampo, mensagemDoErro, montar };
  raiz.PerfilEmpresa = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
