#!/usr/bin/env bash
set -euo pipefail

# CartridgeFi Sequential Solana Devnet Deployment Script
# Order: largest -> smallest (`cartridge_er_room` -> `cartridge_vault_router` -> `cartridge_registry` -> `cartridge_passport`)
# Uses exact `--max-len` to avoid 2x default ProgramData over-allocation (~5.99 SOL permanent rent, ~6.94 SOL peak)
# and closes any orphaned buffers beforehand and on failure/exit so zero SOL is ever stranded.

export PATH="${HOME}/.local/share/solana/install/active_release/bin:${HOME}/.cargo/bin:${PATH}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/target/deploy"
CLUSTER_URL="${SOLANA_RPC_URL:-https://rpc.magicblock.app/devnet}"
DEPLOYER_KEYPAIR="${SOLANA_KEYPAIR:-${HOME}/.config/solana/id.json}"

cleanup_buffers() {
  echo "[buffer-guard] Closing any open program buffers on Devnet..."
  solana program close --buffers \
    --url "${CLUSTER_URL}" \
    --keypair "${DEPLOYER_KEYPAIR}" \
    --bypass-warning >/dev/null 2>&1 || \
  solana program close --buffers \
    --url devnet \
    --keypair "${DEPLOYER_KEYPAIR}" \
    --bypass-warning >/dev/null 2>&1 || true
}

trap cleanup_buffers EXIT ERR

echo "=== CartridgeFi Sequential Devnet Deployment (${CLUSTER_URL}) ==="
DEPLOYER_PUBKEY="$(solana-keygen pubkey "${DEPLOYER_KEYPAIR}")"
BALANCE="$(solana balance "${DEPLOYER_PUBKEY}" --url "${CLUSTER_URL}" | awk '{print $1}')"
echo "Deployer & Keeper Authority: ${DEPLOYER_PUBKEY} (Balance: ${BALANCE} SOL)"

cleanup_buffers

PROGRAMS=(
  "cartridge_er_room"
  "cartridge_vault_router"
  "cartridge_registry"
  "cartridge_passport"
)

for prog in "${PROGRAMS[@]}"; do
  if [ ! -f "${DEPLOY_DIR}/${prog}.so" ]; then
    echo "Building optimized SBF binaries via Anchor (opt-level = \"z\", lto = \"fat\", codegen-units = 1)..."
    (cd "${REPO_ROOT}" && NO_DNA=1 anchor build)
    break
  fi
done

echo "--- Exact Binary Size & Rent Audit ---"
for prog in "${PROGRAMS[@]}"; do
  SO_FILE="${DEPLOY_DIR}/${prog}.so"
  BYTES="$(wc -c < "${SO_FILE}" | tr -d ' ')"
  RENT_LINE="$(solana rent "${BYTES}" --url "${CLUSTER_URL}" | head -n 1)"
  echo "  ${prog}.so: ${BYTES} bytes | ${RENT_LINE}"
done

for prog in "${PROGRAMS[@]}"; do
  SO_FILE="${DEPLOY_DIR}/${prog}.so"
  KEYPAIR_FILE="${DEPLOY_DIR}/${prog}-keypair.json"
  if [ ! -f "${KEYPAIR_FILE}" ] && [ -f "${REPO_ROOT}/.keys/${prog}-keypair.json" ]; then
    cp "${REPO_ROOT}/.keys/${prog}-keypair.json" "${KEYPAIR_FILE}"
  fi

  PROG_PUBKEY="$(solana-keygen pubkey "${KEYPAIR_FILE}")"
  BYTES="$(wc -c < "${SO_FILE}" | tr -d ' ')"

  echo ""
  echo ">>> Deploying ${prog} (${PROG_PUBKEY}, ${BYTES} bytes)..."
  if solana program show "${PROG_PUBKEY}" --url "${CLUSTER_URL}" >/dev/null 2>&1; then
    echo "Program ${PROG_PUBKEY} already exists on Devnet; upgrading..."
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
  REM_BAL="$(solana balance "${DEPLOYER_PUBKEY}" --url "${CLUSTER_URL}")"
  echo "✓ ${prog} live at ${PROG_PUBKEY} (Remaining balance: ${REM_BAL})"
done

echo ""
echo "=== All 4 CartridgeFi programs verified live on Solana Devnet ==="
