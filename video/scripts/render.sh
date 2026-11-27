#!/usr/bin/env bash
# Renders the Pitch composition and masters it to artifacts/borel-founder-pitch-demo.mp4
# (h264 yuv420p crf 18, aac 192k, loudness normalised to -14 LUFS). Uses Remotion's bundled ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
ART=../artifacts
mkdir -p "$ART"
RAW=${RAW:-/private/tmp/claude-501/-Volumes-T7-cartridgefi/714852f5-31a9-480d-b5d8-c89bd426b895/scratchpad/video/raw.mp4}
OUT=${OUT:-$ART/borel-founder-pitch-demo.mp4}
mkdir -p "$(dirname "$RAW")"
# Transcode demo clips to keyframe-dense h264 for fast frame extraction (public/cache/manifest.json).
node scripts/render-cache.mjs
npx remotion render src/index.ts Pitch "$RAW" --codec=h264 --crf=12 --pixel-format=yuv420p \
  --audio-codec=aac --audio-bitrate=192k --concurrency=${CONCURRENCY:-10} --log=${LOG:-info} ${PROPS:+--props="$PROPS"}
# Remotion's JPEG frames come out full-range (yuvj420p); convert to broadcast-range yuv420p while mastering.
npx remotion ffmpeg -y -i "$RAW" -vf "scale=in_range=pc:out_range=tv,format=yuv420p" -c:v libx264 -preset ${PRESET:-fast} -crf 18 -pix_fmt yuv420p \
  -color_range tv -af "loudnorm=I=-14:TP=-1.5:LRA=11" -ar 48000 -c:a aac -b:a 192k -movflags +faststart "$OUT"
npx remotion ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate:format=duration -of default=nw=1 "$OUT"
