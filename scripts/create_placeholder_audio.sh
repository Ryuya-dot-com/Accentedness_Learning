#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPERIMENT_DIR="$(cd "$ROOT_DIR/.." && pwd)"
SOURCE_DIR="$EXPERIMENT_DIR/pilot_study/Stimuli/audio_en_6voices"

SOURCE_TALKERS=(
  "m1_guy"
  "f1_aria"
  "m2_christopher"
  "f2_jenny"
  "m3_ryan"
  "f3_sonia"
)

copy_accent() {
  local accent="$1"
  shift
  local aliases=("$@")

  for i in "${!SOURCE_TALKERS[@]}"; do
    local src="$SOURCE_DIR/${SOURCE_TALKERS[$i]}"
    local dest="$ROOT_DIR/audio/$accent/${aliases[$i]}"
    mkdir -p "$dest"
    find "$src" -maxdepth 1 -type f -name "*.wav" -exec cp {} "$dest/" \;
  done
}

copy_accent "english" "e1" "e2" "e3" "e4" "e5" "e6"
copy_accent "japanese" "j1" "j2" "j3" "j4" "j5" "j6"
copy_accent "chinese" "c1" "c2" "c3" "c4" "c5" "c6"

cat <<MSG
Created placeholder audio from:
  $SOURCE_DIR

Output:
  $ROOT_DIR/audio/english/{e1..e6}
  $ROOT_DIR/audio/japanese/{j1..j6}
  $ROOT_DIR/audio/chinese/{c1..c6}

These files are copied English TTS placeholders. Replace them before data collection.
MSG
