#!/usr/bin/env bash
# Supervisor loop for Jeeves.
#
# Run this *inside* the bot's tmux window instead of launching the bot
# directly:
#
#     ./run.sh          # new way
#     # npm run dev     # old way (no auto-update/restart)
#
# Each iteration pulls the latest code, installs deps, and runs the bot in the
# foreground (tee'ing to log.txt, same as `npm run dev`). When the bot stops,
# the loop pulls again and restarts it — so a redeploy is just "stop the bot
# and let the loop pick up the new code" (see ./redeploy.sh or the !redeploy
# Discord command). Because everything stays in this one pane, the tmux
# scrollback (your log) is continuous across restarts.
#
#   - Ctrl-C in this window stops the bot AND this loop (full shutdown).
#   - ./redeploy.sh / !redeploy (or any signal to just the bot) -> pull + restart.
#   - A crash also triggers an automatic pull + restart after a short pause.
set -uo pipefail
cd "$(dirname "$0")"

# Ctrl-C / SIGINT: shut down for real instead of looping back around.
trap 'echo; echo "=== supervisor: SIGINT — shutting down ==="; exit 0' INT

while true; do
    echo "=== $(date '+%F %T') supervisor: git pull ==="
    git pull --ff-only || echo "!!! git pull failed — starting with the code on disk"

    echo "=== $(date '+%F %T') supervisor: npm install ==="
    npm install --no-audit --no-fund || echo "!!! npm install failed — starting anyway"

    echo "=== $(date '+%F %T') supervisor: starting Jeeves (Ctrl-C here to stop for good) ==="
    npx ts-node src/server.ts 2>&1 | tee -a log.txt
    code=${PIPESTATUS[0]}

    echo "=== $(date '+%F %T') supervisor: Jeeves exited (code $code); restarting in 3s ==="
    sleep 3
done
