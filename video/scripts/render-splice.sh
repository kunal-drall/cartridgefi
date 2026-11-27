#!/usr/bin/env bash
# Re-renders only the clip-dependent frame ranges (S4 product/mobile footage, S6 /protocol + Solscan footage)
# and splices them into a full no-clip base render (BASE, rendered with --props '{"noClips":true}').
# Masters the result to OUT (h264 yuv420p crf 18, aac 192k, loudnorm -14 LUFS).
set -euo pipefail
cd "$(dirname "$0")/.."
SCR=/private/tmp/claude-501/-Volumes-T7-cartridgefi/714852f5-31a9-480d-b5d8-c89bd426b895/scratchpad/video
BASE=${BASE:-$SCR/raw-final-noclips.mp4}
OUT=${OUT:-../artifacts/borel-founder-pitch-demo.mp4}
BUNDLE=$SCR/bundle-splice
node scripts/render-cache.mjs
read B0 B1 D0 D1 N < <(node -e '
const m=require("./public/audio/manifest.json");const fps=30,X=14;const T=[15,25,20,60,30,20,20,20,10];
const sec=T.map((t,i)=>{const v=m.find(x=>parseInt(String(x.scene??x.id).match(/\d+/)[0])===i+1);return v?v.durationSec+0.7+10/fps:t});
const tot=sec.reduce((a,b)=>a+b,0); if(tot<184) sec[3]+=184-tot;
const fr=sec.map(s=>Math.ceil(s*fps));let st=0;const s=fr.map(f=>{const o=st;st+=f;return o});
console.log(s[3], s[3]+Math.round(fr[3]*0.68)+X-1, s[5]+Math.round(fr[5]*0.48), s[5]+fr[5]+X-1, st);')
echo "segments: S4 $B0-$B1, S6 $D0-$D1, total $N frames"
npx remotion bundle src/index.ts --out-dir "$BUNDLE" --log=error
npx remotion render "$BUNDLE" Pitch "$SCR/segB.mp4" --frames=$B0-$B1 --muted --codec=h264 --crf=12 --concurrency=10 --log=error
npx remotion render "$BUNDLE" Pitch "$SCR/segD.mp4" --frames=$D0-$D1 --muted --codec=h264 --crf=12 --concurrency=10 --log=error
# Cut the clip-free ranges out of BASE as standalone files starting at t=0 (accurate input seek, half-frame early).
cut() { # $1=out $2=first_frame $3=count
  local ss; ss=$(python3 -c "print(max(0,($2-0.5)/30))")
  npx remotion ffmpeg -y -v error -ss "$ss" -i "$BASE" -frames:v "$3" -an -c:v libx264 -preset ultrafast -crf 10 "$1"
}
cut "$SCR/segA.mp4" 0 "$B0"
cut "$SCR/segC.mp4" $((B1+1)) $((D0-B1-1))
cut "$SCR/segE.mp4" $((D1+1)) $((N-D1-1))
# Concat filter decodes each part separately (no shared extradata), every part starts at t=0.
npx remotion ffmpeg -y -v error -i "$SCR/segA.mp4" -i "$SCR/segB.mp4" -i "$SCR/segC.mp4" -i "$SCR/segD.mp4" -i "$SCR/segE.mp4" -i "$BASE" \
  -filter_complex "[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0,scale=in_range=pc:out_range=tv,format=yuv420p[v]" \
  -map "[v]" -map 5:a -c:v libx264 -preset ${PRESET:-fast} -crf 18 -pix_fmt yuv420p -color_range tv -r 30 \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"
npx remotion ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames:format=duration -of default=nw=1 "$OUT"
