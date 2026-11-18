const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const helper = path.join(__dirname, "preparar_commit_dados.js");

function comRepositorio(verificar) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "licitaplena-staging-"));
  assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const escrever = (nome, conteudo) => { fs.mkdirSync(path.dirname(path.join(dir, nome)), { recursive: true }); fs.writeFileSync(path.join(dir, nome), conteudo); };
  try {
    git("init", "--quiet");
    escrever("data/contratos_meta.json", '{"cursor":"anterior"}');
    escrever("data/mercado_meta.json", '{"cursor":"anterior"}');
    escrever("data/publico.json", "anterior");
    escrever("data/empresas.json", "privado anterior");
    escrever("data/fornecedores/am.json", "privado anterior");
    escrever(".gitignore", "data/contratos_recentes.json\ndata/mercado_segmentos.json\ndata/oportunidades_abertas.json\n");
    git("add", ".");
    git("-c", "user.name=Teste local", "-c", "user.email=teste@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "base isolada de teste");
    escrever("data/publico.json", "novo");
    escrever("data/empresas.json", "privado novo");
    escrever("data/fornecedores/am.json", "privado novo");
    escrever("data/contratos_meta.json.tmp", "incompleto");
    escrever("data/mercado_segmentos.json.tmp", "bruto incompleto");
    escrever("data/contratos_recentes.json", "bruto");
    const executar = (estado) => spawnSync(process.execPath, [helper, estado], { cwd: dir, encoding: "utf8" });
    verificar({ git, escrever, executar, staged: () => git("diff", "--cached", "--name-only").split("\n").filter(Boolean) });
  } finally {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("licitaplena-staging-"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("coleta falha publica somente checkpoints confirmados por caminho exato", () => comRepositorio(({ escrever, executar, staged }) => {
  escrever("data/contratos_meta.json", '{"cursor":"confirmado"}');
  escrever("data/mercado_meta.json", '{"cursor":"confirmado"}');
  assert.equal(executar("failure").status, 0);
  assert.deepEqual(staged(), ["data/contratos_meta.json", "data/mercado_meta.json"]);
}));

test("falha de upsert sem metadado novo não avança checkpoint", () => comRepositorio(({ executar, staged, git }) => {
  assert.equal(executar("failure").status, 0);
  assert.deepEqual(staged(), []);
  assert.equal(git("show", ":data/contratos_meta.json"), '{"cursor":"anterior"}');
}));

test("sucesso preserva staging anterior e exclusão da base privada", () => comRepositorio(({ escrever, executar, staged }) => {
  escrever("data/contratos_meta.json", '{"cursor":"confirmado"}');
  assert.equal(executar("success").status, 0);
  assert.deepEqual(staged(), ["data/contratos_meta.json", "data/contratos_meta.json.tmp", "data/mercado_segmentos.json.tmp", "data/publico.json"]);
}));

test("coleta não iniciada não publica dados", () => comRepositorio(({ executar, staged }) => {
  const resultado = executar("skipped");
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /Coleta não concluída/);
  assert.deepEqual(staged(), []);
}));

test("workflow publica após falha da coleta e mantém o job vermelho", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/atualizar-dados.yml"), "utf8");
  const coleta = workflow.slice(workflow.indexOf("- name: Rodar robô de coleta"), workflow.indexOf("# Pausado"));
  const publicar = workflow.slice(workflow.indexOf("- name: Commitar e enviar dados atualizados"));
  assert.match(coleta, /id: coleta/);
  assert.doesNotMatch(coleta, /continue-on-error/);
  assert.match(publicar, /if:.*!cancelled\(\).*steps\.coleta\.outcome == 'success'.*steps\.coleta\.outcome == 'failure'/);
  assert.match(publicar, /node scripts\/preparar_commit_dados\.js "\$\{\{ steps\.coleta\.outcome \}\}"/);
  assert.doesNotMatch(publicar, /continue-on-error/);
});
