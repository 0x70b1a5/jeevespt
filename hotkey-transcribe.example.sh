#!/bin/bash
#
# Bind to a global hotkey to record + transcribe a short clip via OpenAI Whisper.
# Note: invoke directly (./hotkey-transcribe.sh) so the bash shebang is honored —
# `sh script.sh` runs under dash and the `.` (source) line below silently fails.
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$SCRIPT_DIR/.env"; set +a

DURATION=15
TEMP_AUDIO_WAV="/tmp/hotkey_recording.wav"
TEMP_AUDIO="/tmp/hotkey_recording.mp3"
TRANSCRIBE_JS="$SCRIPT_DIR/src/transcribe.js"
LOG_FILE="$SCRIPT_DIR/transcribe.log.txt"
NODE_BIN="$(command -v node)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

notify() {
    /usr/bin/timeout 2 /usr/bin/notify-send "$@"
    local rc=$?
    [ $rc -ne 0 ] && log "WARN: notify-send exit=$rc for: $1"
    return 0
}

cleanup() {
    rm -f "$TEMP_AUDIO_WAV" "$TEMP_AUDIO"
}
trap cleanup EXIT

log "=== START ==="
notify "Recording..." "Recording for $DURATION seconds..."

arecord -D default -f cd -t wav -d $DURATION "$TEMP_AUDIO_WAV" 2>>"$LOG_FILE"
log "arecord exit=$? wav=$([ -f "$TEMP_AUDIO_WAV" ] && ls -lh "$TEMP_AUDIO_WAV" | awk '{print $5}' || echo 'missing')"

ffmpeg -y -i "$TEMP_AUDIO_WAV" "$TEMP_AUDIO" 2>>"$LOG_FILE"
log "ffmpeg exit=$? mp3=$([ -f "$TEMP_AUDIO" ] && ls -lh "$TEMP_AUDIO" | awk '{print $5}' || echo 'missing')"

if [ ! -f "$TEMP_AUDIO" ]; then
    log "ERROR: mp3 not produced"
    notify "Error" "Failed to record audio"
    exit 1
fi

log "STEP: about to transcribe"
notify "Processing..." "Transcribing audio..."
log "STEP: calling node"

transcription=$("$NODE_BIN" "$TRANSCRIBE_JS" --raw "$TEMP_AUDIO" 2>>"$LOG_FILE")
node_exit=$?
log "node exit=$node_exit transcription_len=${#transcription}"

if [ -z "$transcription" ]; then
    log "ERROR: empty transcription (node exit=$node_exit)"
    notify "Error" "Failed to transcribe audio"
    exit 1
fi

echo -n "$transcription" | xclip -selection clipboard
log "SUCCESS: $transcription"
notify "Transcribed" "$transcription"
