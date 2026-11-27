#!/usr/bin/env bash
# Re-masters an existing raw render (RAW) to OUT without re-rendering frames.
set -euo pipefail
cd "$(dirname "$0")/.."
RAW=${1:?raw mp4}
OUT=${2:-../artifacts/borel-founder-pitch-demo.mp4}
npx remotion ffmpeg -y -v error -i "$RAW" -vf "scale=in_range=pc:out_range=tv,format=yuv420p" -c:v libx264 -preset ${PRESET:-fast} -crf 18 -pix_fmt yuv420p \
  -color_range tv -af "loudnorm=I=-14:TP=-1.5:LRA=11" -ar 48000 -c:a aac -b:a 192k -movflags +faststart "$OUT"
npx remotion ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate:format=duration -of default=nw=1 "$OUT"
