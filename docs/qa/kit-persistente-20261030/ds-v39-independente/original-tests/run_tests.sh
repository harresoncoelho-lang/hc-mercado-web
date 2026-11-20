#!/usr/bin/env bash
# Roda o teste do pacote do KitProposta. Falha (código != 0) se qualquer asserção falhar ou se o SUMMARY não tiver fail=0.
# Requer Node.js e Playwright instalados globalmente.
# Uso: bash run_tests.sh <pasta_com_KitProposta_e_componentes> <pasta_de_saida>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMP="${1:-$HERE/../componentes}"
OUT="${2:-$HERE/../saida}"
mkdir -p "$OUT"
COMP="$(cd "$COMP" && pwd)"
OUT="$(cd "$OUT" && pwd)"
export NODE_PATH="$(npm root -g)"
node "$HERE/t_pacote.js" "$COMP" "$OUT" > "$OUT/t_pacote.txt" 2>&1
rc=$?
cat "$OUT/t_pacote.txt"
if [ $rc -ne 0 ]; then echo "RESULTADO: FALHA (node saiu com código $rc)"; exit $rc; fi
if ! grep -Eq '^SUMMARY pass=[0-9]+ fail=0$' "$OUT/t_pacote.txt"; then echo "RESULTADO: FALHA (SUMMARY ausente ou fail>0)"; exit 1; fi
echo "RESULTADO: OK"; exit 0
