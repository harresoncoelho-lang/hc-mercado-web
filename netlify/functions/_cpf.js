// CPF nunca entra no banco (LGPD): razão social de MEI vem com o CPF do titular ("FULANA DE TAL 97048143215") e
// o chat do pregoeiro às vezes cita CPF. Uma regra só para funções e robôs; os CHECKs do banco usam a mesma forma
// ('\y[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}\y'). Aqui \s cobre mais que o espaço do banco: limpar a
// mais nunca faz o CHECK recusar. A extensão (extensao-leitura/pregao-leitor.mjs) repete a regex (é ESM no navegador).
const CPF_RE = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s/]?\d{2}\b/g;
const semCpf = (s, troca = "***.***.***-**") => String(s ?? "").replace(CPF_RE, troca);
const temCpf = (s) => new RegExp(CPF_RE.source).test(String(s ?? ""));
module.exports = { CPF_RE, semCpf, temCpf };
