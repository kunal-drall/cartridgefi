#!/usr/bin/env bash
set -euo pipefail

# CartridgeFi Frontend (@cartridgefi/web) — Google Cloud Run Deployment Script
# Usage:
#   ./scripts/deploy-cloudrun.sh [GCP_PROJECT_ID] [REGION] [SERVICE_NAME]

PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}}"
REGION="${2:-${CLOUD_RUN_REGION:-us-central1}}"
SERVICE_NAME="${3:-${CLOUD_RUN_SERVICE:-cartridgefi-web}}"

if [ -z "${PROJECT_ID}" ] || [ "${PROJECT_ID}" = "(unset)" ]; then
  echo "Usage: ./scripts/deploy-cloudrun.sh <GCP_PROJECT_ID> [REGION] [SERVICE_NAME]" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Deploying ${SERVICE_NAME} to Google Cloud Run (project=${PROJECT_ID}, region=${REGION}) ==="

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project "${PROJECT_ID}"

gcloud run deploy "${SERVICE_NAME}" \
  --source "${REPO_ROOT}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars "NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com,NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL=https://devnet-router.magicblock.app,NEXT_PUBLIC_MAGICBLOCK_TEE_URL=https://devnet-tee.magicblock.app"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
echo ""
echo "=== Cloud Run Deployment Live ==="
echo "  Landing URL:          ${SERVICE_URL}"
echo "  Protocol Console:     ${SERVICE_URL}/protocol"
echo "  Reference Harness #1: ${SERVICE_URL}/play/borel"
