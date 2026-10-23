#!/bin/sh
# Hyperframes wrapper: puts the local ffmpeg/ffprobe binaries on PATH for the CLI.
export PATH="D:/GitHub/Nexus/brag-output-2026-10-19-232120/work/work-bin:$PATH"
export HYPERFRAMES_FFMPEG_PATH="D:/GitHub/Nexus/brag-output-2026-10-19-232120/work/work-bin/ffmpeg.exe"
export HYPERFRAMES_FFPROBE_PATH="D:/GitHub/Nexus/brag-output-2026-10-19-232120/work/work-bin/ffprobe.exe"
export HYPERFRAMES_SKIP_SKILLS=1
cd "D:/GitHub/Nexus/brag-output-2026-10-19-232120/composition" && exec node node_modules/hyperframes/bin/hyperframes.mjs "$@"
