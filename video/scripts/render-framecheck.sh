#!/usr/bin/env bash
# Extracts 12 evenly spaced frames from the mastered video for visual QA.
set -euo pipefail
cd "$(dirname "$0")/.."
IN=${1:-../artifacts/borel-founder-pitch-demo.mp4}
OUT=${2:-/private/tmp/claude-501/-Volumes-T7-cartridgefi/714852f5-31a9-480d-b5d8-c89bd426b895/scratchpad/video/frames}
mkdir -p "$OUT"
DUR=$(npx remotion ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
for i in $(seq 0 11); do
  T=$(python3 -c "print(round(($i + 0.5) * $DUR / 12, 2))")
  npx remotion ffmpeg -y -v error -ss "$T" -i "$IN" -frames:v 1 -vf scale=960:-1 "$OUT/frame-$(printf %02d $i)-${T}s.png"
done
ls "$OUT"
