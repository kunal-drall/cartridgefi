#!/usr/bin/env bash
# Renders the 12 pitch-deck stills (final frame of each animated slide) to docs/pitch/slide-NN.png.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=../docs/pitch
mkdir -p "$OUT"
BUNDLE=${BUNDLE:-/private/tmp/claude-501/-Volumes-T7-cartridgefi/714852f5-31a9-480d-b5d8-c89bd426b895/scratchpad/deck/bundle}
npx remotion bundle src/index.ts --out-dir "$BUNDLE" --log=error
for n in ${SLIDES:-01 02 03 04 05 06 07 08 09 10 11 12}; do
  npx remotion still "$BUNDLE" "slide-$n" "$OUT/slide-$n.png" --frame=179 --log=error &
  # cap parallelism at 4
  while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 0.3; done
done
wait
ls -la "$OUT"
