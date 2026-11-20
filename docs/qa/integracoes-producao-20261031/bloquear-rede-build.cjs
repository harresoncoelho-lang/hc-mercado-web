// Contenção do subprocesso de compilação: nenhuma credencial nem saída de rede é necessária.
const bloquear = () => { throw new Error('Rede bloqueada durante compilação local.'); };
globalThis.fetch = async () => bloquear();
for (const nome of ['node:http', 'node:https']) {
  const api = require(nome); api.request = bloquear; api.get = bloquear;
}
const net = require('node:net');
net.connect = bloquear; net.createConnection = bloquear; net.Socket.prototype.connect = bloquear;
require('node:tls').connect = bloquear;
require('node:dgram').createSocket = bloquear;
const dns = require('node:dns');
for (const alvo of [dns,dns.promises,dns.Resolver.prototype,dns.promises.Resolver.prototype]) {
  for (const nome of Object.getOwnPropertyNames(alvo)) if (/^(?:lookup|resolve|reverse)/.test(nome) && typeof alvo[nome] === 'function') alvo[nome] = bloquear;
}
require('node:module').syncBuiltinESMExports();
