const fs = require('fs');
const path = require('path');
const pw = require('C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const audit = { pid: process.pid, requests: [], blocked: [], errors: [], browser: null };
const log = path.join(__dirname, '..', 'logs', 'network-' + process.pid + '.json');
process.on('exit', () => fs.writeFileSync(log, JSON.stringify(audit, null, 2)));
module.exports = { chromium: { launch: async () => {
  const b = await pw.chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'] });
  audit.browser = b.version();
  b.newPage = async (options = {}) => {
    const context = await b.newContext({...options, serviceWorkers: 'block'});
    await context.route('**/*', async route => {
      const url = route.request().url(); audit.requests.push(url);
      if (/^(file:|data:|blob:)/.test(url)) return route.continue();
      audit.blocked.push(url); return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', e => audit.errors.push(e.message));
    return page;
  };
  return b;
} } };
