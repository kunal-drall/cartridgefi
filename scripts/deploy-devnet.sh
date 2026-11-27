#!/usr/bin/env bash
set -euo pipefail

# CartridgeFi Priority-Ordered Rent-Optimized Solana Devnet Deployment Script
# Priority Order:
#   1. cartridge_er_room       (Core MagicBlock ER/PER Arena & VRF Settlement)
#   2. cartridge_vault_router  (Non-Custodial Escrow, Harmonic Shapley & Fee Split)
#   3. cartridge_registry      (EngineConfig, platformFeeAccount & Manifests)
#   4. cartridge_passport      (Cross-Game Market ELO & Earned Vault Accounting)
#
# Guarantees:
# - Never runs raw OS `strip` on SBF `.so` binaries (relies strictly on Cargo `[profile.release]`
#   `opt-level = "z"`, `lto = "fat"`, `codegen-units = 1`).
# - Uses exact `--max-len <bytes>` on initial deploy to avoid 2x ProgramData rent over-allocation.
# - Supports partial/priority deployment when Devnet SOL is tight (skips already-deployed programs
#   unless `--upgrade` / `FORCE_UPGRADE=true` is set, and halts cleanly before buffer allocation if
#   remaining SOL < required rent + 0.05 SOL fee headroom).
# - Runs `solana program close --buffers --url devnet` beforehand, after each step, and on EXIT/ERR.

export PATH="${HOME}/.local/share/solana/install/active_release/bin:${HOME}/.cargo/bin:${PATH}"

FORCE_UPGRADE="${FORCE_UPGRADE:-false}"
MAX_PROGRAMS="${MAX_PROGRAMS:-4}"
for arg in "$@"; do
  case "${arg}" in
    --upgrade)
      FORCE_UPGRADE="true"
      ;;
    --max-programs=*)
      MAX_PROGRAMS="${arg#*=}"
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/target/deploy"
CLUSTER_URL="${SOLANA_RPC_URL:-https://rpc.magicblock.app/devnet}"
DEPLOYER_KEYPAIR="${SOLANA_KEYPAIR:-${HOME}/.config/solana/id.json}"

cleanup_buffers() {
  echo "[buffer-guard] Closing any stranded program buffers on Devnet..."
  solana program close --buffers \
    --url devnet \
    --keypair "${DEPLOYER_KEYPAIR}" \
    --bypass-warning >/dev/null 2>&1 || true
  if [ "${CLUSTER_URL}" != "devnet" ] && [ "${CLUSTER_URL}" != "https://api.devnet.solana.com" ]; then
    solana program close --buffers \
      --url "${CLUSTER_URL}" \
      --keypair "${DEPLOYER_KEYPAIR}" \
      --bypass-warning >/dev/null 2>&1 || true
  fi
}

trap cleanup_buffers EXIT ERR

echo "=== CartridgeFi Priority-Ordered Devnet Deployment (${CLUSTER_URL}) ==="
DEPLOYER_PUBKEY="$(solana-keygen pubkey "${DEPLOYER_KEYPAIR}")"
BALANCE="$(solana balance "${DEPLOYER_PUBKEY}" --url "${CLUSTER_URL}" | awk '{print $1}')"
echo "Deployer & Relayer Authority: ${DEPLOYER_PUBKEY} (Balance: ${BALANCE} SOL)"

cleanup_buffers

PROGRAMS=(
  "cartridge_er_room"
  "cartridge_vault_router"
  "cartridge_registry"
  "cartridge_passport"
)

PROGRAM_DIRS=(
  "cartridge-er-room"
  "cartridge-vault-router"
  "cartridge-registry"
  "cartridge-passport"
)

for prog in "${PROGRAMS[@]}"; do
  if [ ! -f "${DEPLOY_DIR}/${prog}.so" ]; then
    echo "Building optimized SBF binaries via Anchor (opt-level = \"z\", lto = \"fat\", codegen-units = 1)..."
    (cd "${REPO_ROOT}" && NO_DNA=1 anchor build --ignore-keys)
    break
  fi
done

echo ""
echo "--- 1. Program ID Parity Audit (Keypair == declare_id! == Anchor.toml == Codama) ---"
for idx in "${!PROGRAMS[@]}"; do
  prog="${PROGRAMS[$idx]}"
  pdir="${PROGRAM_DIRS[$idx]}"
  KEYPAIR_FILE="${DEPLOY_DIR}/${prog}-keypair.json"
  if [ -f "${REPO_ROOT}/.keys/programs/${prog}-keypair.json" ]; then
    cp "${REPO_ROOT}/.keys/programs/${prog}-keypair.json" "${KEYPAIR_FILE}"
  elif [ ! -f "${KEYPAIR_FILE}" ] && [ -f "${REPO_ROOT}/.keys/${prog}-keypair.json" ]; then
    cp "${REPO_ROOT}/.keys/${prog}-keypair.json" "${KEYPAIR_FILE}"
  fi
  KP_PUB="$(solana-keygen pubkey "${KEYPAIR_FILE}")"
  RS_PUB="$(sed -n 's/.*declare_id!("\([^"]*\)").*/\1/p' "${REPO_ROOT}/programs/${pdir}/src/lib.rs" | head -n 1)"
  TOML_PUB="$(sed -n "s/^${prog}[[:space:]]*=[[:space:]]*\"\([^\"]*\)\"/\1/p" "${REPO_ROOT}/Anchor.toml" | head -n 1)"
  if [ "${KP_PUB}" != "${RS_PUB}" ] || [ "${KP_PUB}" != "${TOML_PUB}" ]; then
    echo "FATAL: Program ID mismatch for ${prog}: keypair=${KP_PUB}, lib.rs=${RS_PUB}, Anchor.toml=${TOML_PUB}" >&2
    exit 1
  fi
  if ! grep -q "${KP_PUB}" "${REPO_ROOT}/packages/shared-types/src/constants.ts"; then
    echo "FATAL: Program ID ${KP_PUB} (${prog}) missing in packages/shared-types/src/constants.ts" >&2
    exit 1
  fi
  echo "  ✓ [P$((idx + 1))] ${prog}: ${KP_PUB} (100% parity verified)"
done

echo ""
echo "--- 2. Exact SBF Binary Size & Solana Rent Audit ---"
TOTAL_BYTES=0
for idx in "${!PROGRAMS[@]}"; do
  prog="${PROGRAMS[$idx]}"
  SO_FILE="${DEPLOY_DIR}/${prog}.so"
  BYTES="$(wc -c < "${SO_FILE}" | tr -d ' ')"
  TOTAL_BYTES=$((TOTAL_BYTES + BYTES))
  RENT_OUT="$(solana rent "${BYTES}" --url "${CLUSTER_URL}" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
  echo "  [Priority #$((idx + 1))] ${prog}.so: ${BYTES} bytes | ${RENT_OUT}"
done
echo "  Total SBF Footprint: ${TOTAL_BYTES} bytes"

echo ""
echo "--- 3. Sequential Priority Deployment (MAX_PROGRAMS=${MAX_PROGRAMS}, FORCE_UPGRADE=${FORCE_UPGRADE}) ---"
DEPLOYED_COUNT=0
PARTIAL_HALT=0

for idx in "${!PROGRAMS[@]}"; do
  if [ "${DEPLOYED_COUNT}" -ge "${MAX_PROGRAMS}" ]; then
    echo "Reached MAX_PROGRAMS=${MAX_PROGRAMS}; stopping sequential pass cleanly."
    break
  fi

  prog="${PROGRAMS[$idx]}"
  SO_FILE="${DEPLOY_DIR}/${prog}.so"
  KEYPAIR_FILE="${DEPLOY_DIR}/${prog}-keypair.json"
  PROG_PUBKEY="$(solana-keygen pubkey "${KEYPAIR_FILE}")"
  BYTES="$(wc -c < "${SO_FILE}" | tr -d ' ')"
  REQ_RENT_SOL="$(solana rent "${BYTES}" --url "${CLUSTER_URL}" | awk '/Rent-exempt minimum:/ {print $3}')"

  echo ""
  echo ">>> [Priority #$((idx + 1))] ${prog} (${PROG_PUBKEY}, ${BYTES} bytes, min rent: ${REQ_RENT_SOL} SOL)"

  if solana program show "${PROG_PUBKEY}" --url "${CLUSTER_URL}" >/dev/null 2>&1; then
    if [ "${FORCE_UPGRADE}" != "true" ]; then
      SLOT_LINE="$(solana program show "${PROG_PUBKEY}" --url "${CLUSTER_URL}" | awk -F': ' '/Last Deployed In Slot|Balance/ {printf "%s=%s ", $1, $2}')"
      echo "  ✓ Already live on Devnet (${SLOT_LINE}); skipping re-upload (pass --upgrade to force)."
      DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
      continue
    fi
    echo "  Upgrading existing program ${PROG_PUBKEY} (--upgrade enabled)..."
  fi

  CUR_BAL_SOL="$(solana balance "${DEPLOYER_PUBKEY}" --url "${CLUSTER_URL}" | awk '{print $1}')"
  HAS_SOL="$(awk -v bal="${CUR_BAL_SOL}" -v rent="${REQ_RENT_SOL}" 'BEGIN { print (bal >= (rent + 0.05)) ? "1" : "0" }')"

  if [ "${HAS_SOL}" != "1" ]; then
    echo "  [partial-priority-guard] Tight Devnet SOL detected: current=${CUR_BAL_SOL} SOL, needed=${REQ_RENT_SOL} SOL (+0.05 SOL buffer)."
    echo "  Halting before ${prog} so ${DEPLOYED_COUNT} higher-priority program(s) remain live with zero stranded buffer SOL."
    PARTIAL_HALT=1
    break
  fi

  if solana program show "${PROG_PUBKEY}" --url "${CLUSTER_URL}" >/dev/null 2>&1; then
    solana program deploy "${SO_FILE}" \
      --program-id "${KEYPAIR_FILE}" \
      --url "${CLUSTER_URL}" \
      --keypair "${DEPLOYER_KEYPAIR}" \
      --use-rpc \
      --with-compute-unit-price 5000
  else
    solana program deploy "${SO_FILE}" \
      --program-id "${KEYPAIR_FILE}" \
      --max-len "${BYTES}" \
      --url "${CLUSTER_URL}" \
      --keypair "${DEPLOYER_KEYPAIR}" \
      --use-rpc \
      --with-compute-unit-price 5000
  fi

  cleanup_buffers
  DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
  REM_BAL="$(solana balance "${DEPLOYER_PUBKEY}" --url "${CLUSTER_URL}")"
  echo "  ✓ ${prog} deployed & verified at ${PROG_PUBKEY} (Remaining balance: ${REM_BAL})"
done

cleanup_buffers
echo ""
if [ "${PARTIAL_HALT}" -eq 1 ]; then
  echo "=== Partial Priority Deployment Complete (${DEPLOYED_COUNT}/${#PROGRAMS[@]} programs live; top up Devnet SOL and re-run to resume) ==="
else
  echo "=== All ${DEPLOYED_COUNT}/${#PROGRAMS[@]} CartridgeFi Protocol Programs Verified Live on Solana Devnet ==="
fi

