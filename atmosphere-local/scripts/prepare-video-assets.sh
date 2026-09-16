#!/usr/bin/env sh
set -eu

FFMPEG_BIN="${1:-ffmpeg}"
VIDEO_DIR="public/assets/videos"
ADAPTIVE_DIR="$VIDEO_DIR/adaptive"
POSTER_DIR="$VIDEO_DIR/posters"

mkdir -p "$ADAPTIVE_DIR" "$POSTER_DIR"

for source in "$VIDEO_DIR"/*.mp4; do
  filename=$(basename "$source")
  stem=${filename%.*}

  "$FFMPEG_BIN" -hide_banner -loglevel error -y -i "$source" \
    -map 0:v:0 -an \
    -vf "scale='min(1280,iw)':-2:force_original_aspect_ratio=decrease" \
    -c:v libx264 -preset medium -crf 21 -maxrate 3500k -bufsize 7000k \
    -pix_fmt yuv420p -profile:v high -level 4.1 -movflags +faststart \
    "$ADAPTIVE_DIR/$stem-720.mp4"

  "$FFMPEG_BIN" -hide_banner -loglevel error -y -ss 2 -i "$source" \
    -frames:v 1 -vf "scale='min(1280,iw)':-2:force_original_aspect_ratio=decrease" \
    -q:v 3 "$POSTER_DIR/$stem.jpg"
done
