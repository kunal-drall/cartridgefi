#!/usr/bin/env python3
"""Synthesize the founder-pitch voiceover from docs/FOUNDER_PITCH_SCRIPT.md.

Writes video/public/audio/s1.mp3 ... s9.mp3 with Microsoft Edge neural TTS
(edge-tts), then measures each file with Remotion's bundled ffprobe and writes
video/public/audio/manifest.json as [{scene, file, durationSec, text}].
The narration is synthetic.

  python3 video/scripts/record-voiceover.py [--voice en-US-AndrewMultilingualNeural] [--rate +12%] [--out DIR] [--only s1,s4]
"""
import argparse
import asyncio
import json
import pathlib
import re
import os
import subprocess

import edge_tts

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "docs" / "FOUNDER_PITCH_SCRIPT.md"
# `npx remotion ffprobe` needs a Remotion project root (tsconfig.json); call the
# same ffprobe binary Remotion ships so measurement works before video/src exists.
COMPOSITOR = ROOT / "video" / "node_modules" / "@remotion" / "compositor-darwin-arm64"


def duration_sec(path):
    env = dict(os.environ, DYLD_LIBRARY_PATH=str(COMPOSITOR))
    out = subprocess.run(
        [str(COMPOSITOR / "ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        env=env, check=True, capture_output=True, text=True,
    )
    return round(float(out.stdout.strip()), 3)

# Spoken forms for tickers and jargon the neural voice would otherwise misread.
# Only the audio uses these; manifest.json keeps the script's written text.
SPOKEN = [
    (r"\bNVDAx\b", "N V D A X"),
    (r"\bSOL\b", "Sol"),
    (r"\bETH\b", "Eth"),
    (r"\bSPY\b", "Spy"),
    (r"\bPvP\b", "P V P"),
    (r"\bSHA-256\b", "shah two fifty-six"),
    (r"\bELO\b", "Elo"),
    (r"\bMagicBlock\b", "Magic Block"),
    (r"\bSolscan\b", "Sol scan"),
    (r"\bDevnet\b", "dev net"),
    (r"\bdevnet\b", "dev net"),
    (r"\bcartridgefi\b", "cartridge fye"),
    (r"\bone-x\b", "one x"),
    (r"\btwo-x\b", "two x"),
    (r"\bthree-x\b", "three x"),
]


def scenes():
    text = SCRIPT.read_text()
    out = []
    for sid, body in re.findall(r"^## (S\d) — .*?\n(.*?)(?=^## |\n---)", text, re.S | re.M):
        narration = " ".join(l[2:].strip() for l in body.splitlines() if l.startswith("> "))
        out.append((sid.lower(), narration))
    return out


def spoken(text):
    for pat, rep in SPOKEN:
        text = re.sub(pat, rep, text)
    return text


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="en-US-AndrewMultilingualNeural")
    ap.add_argument("--rate", default="+12%")
    ap.add_argument("--pitch", default="+0Hz")
    ap.add_argument("--out", default=str(ROOT / "video" / "public" / "audio"))
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = {s.strip().lower() for s in args.only.split(",") if s.strip()}
    meta = []
    for sid, text in scenes():
        if only and sid not in only:
            continue
        path = out / f"{sid}.mp3"
        for attempt in range(1, 7):
            try:
                await edge_tts.Communicate(spoken(text), args.voice, rate=args.rate, pitch=args.pitch).save(str(path))
                break
            except (edge_tts.exceptions.NoAudioReceived, OSError) as err:
                # The Edge endpoint intermittently drops a stream; back off and retry.
                if attempt == 6:
                    raise
                print(f"{sid}: attempt {attempt} failed ({type(err).__name__}), retrying")
                await asyncio.sleep(2 * attempt)
        dur = duration_sec(path)
        meta.append({"scene": sid.upper(), "file": f"audio/{sid}.mp3", "durationSec": dur, "text": text})
        print(f"{sid}: {len(text.split())} words, {dur}s -> {path}", flush=True)
    manifest_path = out / "manifest.json"
    if only and manifest_path.exists():
        # Re-rendered a subset: replace those scenes, keep the rest.
        fresh = {m["scene"]: m for m in meta}
        merged = [fresh.pop(m["scene"], m) for m in json.loads(manifest_path.read_text())]
        meta = sorted(merged + list(fresh.values()), key=lambda m: int(m["scene"][1:]))
    manifest_path.write_text(json.dumps(meta, indent=2) + "\n")
    total = sum(m["durationSec"] for m in meta)
    print(f"total {total:.2f}s ({args.voice}, rate {args.rate}) -> {manifest_path}", flush=True)


asyncio.run(main())
