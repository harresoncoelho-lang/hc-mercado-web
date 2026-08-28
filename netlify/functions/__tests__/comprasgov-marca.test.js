const test = require("node:test");
const assert = require("node:assert/strict");
const { marcaUtil } = require("../comprasgov-marca");

test("marcaUtil preserva marca declarada e descarta placeholders", () => {
  assert.equal(marcaUtil("CISA/CISABRASILE"), "CISA/CISABRASILE");
  assert.equal(marcaUtil(" . "), null);
  assert.equal(marcaUtil(""), null);
});
