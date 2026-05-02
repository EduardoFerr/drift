#!/usr/bin/env bash
# dms-refresh.sh — Drift dead-man's switch refresh
#
# Cifra `.dms-payload.txt` (plaintext local, gitignored) contra um round
# drand futuro (now + N meses) usando tlock. Gera ciphertext + prova
# OpenTimestamps. Output em dms/dms-YYYY-MM.{asc,ots}, commit-ável.
#
# Princípio: ciphertext é público; só descriptografável após o round
# drand passar; OTS prova publicamente que o blob existia em data X.
#
# === PRÉ-REQUISITOS ===
#   - tlock-cli         https://github.com/drand/tlock (Go binary)
#   - drand-cli         https://github.com/drand/drand (Go binary, opcional — só pra info)
#   - ots-cli           https://github.com/opentimestamps/opentimestamps-client (pip install opentimestamps-client)
#   - jq                JSON parser
#   - curl
#
#   Drand chain (League of Entropy mainnet, quicknet — 3s round):
#       chain hash: 52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971
#       endpoint:   https://api.drand.sh
#       backup:     https://drand.cloudflare.com
#
# === USO ===
#   ./scripts/dms-refresh.sh                  # default: 6 meses
#   ./scripts/dms-refresh.sh --months 12      # 12 meses
#   ./scripts/dms-refresh.sh --dry-run        # mostra tudo, não escreve em dms/
#   ./scripts/dms-refresh.sh --payload custom.txt
#
# === SEGURANÇA ===
# Plaintext NUNCA toca CI. Rodar em laptop pessoal. `.dms-payload.txt`
# está no .gitignore. Apenas dms/*.asc e dms/*.ots são commit-áveis.
#
# === RESET ===
# Para cancelar um DMS antes do round (ex.: novo refresh com data nova),
# basta criar dms-YYYY-MM.asc novo com round mais futuro — o anterior
# ainda vai abrir no seu round, então o conteúdo do payload deve estar
# desatualizado intencionalmente em refreshes mais antigos. Considere
# manter só o último .asc na pasta dms/ e mover os antigos para
# dms/archive/ pra sinalizar "este é o ativo".

set -euo pipefail

# ----------------- defaults -----------------
MONTHS=6
DRY_RUN=0
PAYLOAD=".dms-payload.txt"
DMS_DIR="dms"
DRAND_CHAIN="52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
DRAND_ENDPOINT="https://api.drand.sh"
DRAND_PERIOD_SECONDS=3   # quicknet round period

# ----------------- args -----------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --months)   MONTHS="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --payload)  PAYLOAD="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
done

# ----------------- pre-flight -----------------
need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[!] $1 não encontrado no PATH. Instale antes de rodar." >&2
    exit 1
  }
}
need tlock
need ots
need jq
need curl
need sha256sum

[[ -f "$PAYLOAD" ]] || { echo "[!] Plaintext não existe: $PAYLOAD" >&2; exit 1; }

# Refusa rodar se PAYLOAD não estiver no .gitignore (proteção contra commit acidental)
if [[ -f .gitignore ]] && ! grep -qE "^${PAYLOAD//./\\.}$" .gitignore; then
  echo "[!] $PAYLOAD não está em .gitignore. Adicione antes de continuar." >&2
  exit 1
fi

# ----------------- compute target round -----------------
# drand chain info pra confirmar period e genesis_time
INFO=$(curl -fsSL "${DRAND_ENDPOINT}/${DRAND_CHAIN}/info")
GENESIS_TIME=$(echo "$INFO" | jq -r '.genesis_time')
PERIOD=$(echo "$INFO" | jq -r '.period')

if [[ "$PERIOD" -ne "$DRAND_PERIOD_SECONDS" ]]; then
  echo "[!] drand period inesperado: $PERIOD (esperado $DRAND_PERIOD_SECONDS)" >&2
  echo "    A chain pode ter mudado — re-validar DRAND_CHAIN." >&2
  exit 1
fi

NOW_EPOCH=$(date +%s)
TARGET_EPOCH=$((NOW_EPOCH + MONTHS * 30 * 86400))
TARGET_ROUND=$(( (TARGET_EPOCH - GENESIS_TIME) / PERIOD ))
TARGET_DATE_HUMAN=$(date -d "@${TARGET_EPOCH}" "+%Y-%m-%d %H:%M %Z" 2>/dev/null \
                    || date -r "${TARGET_EPOCH}" "+%Y-%m-%d %H:%M %Z")

YEAR_MONTH=$(date +%Y-%m)
OUT_ASC="${DMS_DIR}/dms-${YEAR_MONTH}.asc"
OUT_OTS="${DMS_DIR}/dms-${YEAR_MONTH}.ots"
OUT_META="${DMS_DIR}/dms-${YEAR_MONTH}.meta.json"

# ----------------- summary -----------------
cat <<EOF
==> Drift DMS refresh
   Plaintext      : $PAYLOAD ($(wc -c < "$PAYLOAD") bytes)
   Months ahead   : $MONTHS
   Drand chain    : $DRAND_CHAIN (period ${PERIOD}s)
   Target epoch   : $TARGET_EPOCH ($TARGET_DATE_HUMAN)
   Target round   : $TARGET_ROUND
   Output asc     : $OUT_ASC
   Output ots     : $OUT_OTS
   Output meta    : $OUT_META
   Dry-run        : $DRY_RUN
EOF

# ----------------- encrypt -----------------
TMP_ASC=$(mktemp)
trap 'rm -f "$TMP_ASC"' EXIT

echo "==> tlock encrypt against round $TARGET_ROUND"
tlock --encrypt \
  --chain "$DRAND_CHAIN" \
  --network "$DRAND_ENDPOINT" \
  --round "$TARGET_ROUND" \
  --armor \
  --input "$PAYLOAD" \
  --output "$TMP_ASC"

CIPHERTEXT_SHA=$(sha256sum "$TMP_ASC" | awk '{print $1}')
echo "    ciphertext sha256: $CIPHERTEXT_SHA"

# ----------------- OpenTimestamps -----------------
echo "==> ots stamp"
TMP_OTS="${TMP_ASC}.ots"
ots stamp "$TMP_ASC"
[[ -f "$TMP_OTS" ]] || { echo "[!] ots stamp falhou — sem output" >&2; exit 1; }

# ----------------- meta -----------------
TMP_META=$(mktemp)
cat > "$TMP_META" <<EOF
{
  "version": 1,
  "generated_at_epoch": $NOW_EPOCH,
  "generated_at_iso": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "drand_chain": "$DRAND_CHAIN",
  "drand_period_seconds": $PERIOD,
  "target_round": $TARGET_ROUND,
  "target_epoch": $TARGET_EPOCH,
  "target_iso": "$(date -u -d "@${TARGET_EPOCH}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
                  || date -u -r "${TARGET_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)",
  "ciphertext_sha256": "$CIPHERTEXT_SHA",
  "ciphertext_filename": "dms-${YEAR_MONTH}.asc",
  "ots_filename": "dms-${YEAR_MONTH}.ots"
}
EOF

# ----------------- write or dry-run -----------------
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "=== DRY RUN — nada escrito em $DMS_DIR/ ==="
  echo "Meta seria:"
  cat "$TMP_META"
  rm -f "$TMP_OTS" "$TMP_META"
  exit 0
fi

mkdir -p "$DMS_DIR"
mv "$TMP_ASC"  "$OUT_ASC"
mv "$TMP_OTS"  "$OUT_OTS"
mv "$TMP_META" "$OUT_META"
trap - EXIT

echo
echo "==> Concluído."
echo "    Próximos passos:"
echo "      git add $OUT_ASC $OUT_OTS $OUT_META"
echo "      git commit -m 'chore(dms): refresh ${YEAR_MONTH} (round ${TARGET_ROUND})'"
echo
echo "    Lembrete: agendar próximo refresh antes de ${TARGET_DATE_HUMAN}."
echo "    Ideal: ($((MONTHS - 1)) meses) — 1 mês de margem antes do expiry."
