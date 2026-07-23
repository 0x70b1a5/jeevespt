#!/usr/bin/env bash
# Redeploy Jeeves: stop the running bot so the supervisor loop (run.sh)
# pulls the latest code and starts it again.
#
# Run this from anywhere on the VPS — you do NOT need to attach to tmux. The
# new logs appear in the bot's tmux window, continuous with the old ones.
# From Discord, the !redeploy / /redeploy command does the same thing.
#
# Requires the bot to have been launched with ./run.sh.
set -euo pipefail

# SIGINT so the bot runs its graceful shutdown handler. The supervisor's own
# command line doesn't contain this string, so it survives and does the
# pull + restart.
if pkill -INT -f 'ts-node src/server.ts'; then
    echo "Sent stop signal to Jeeves — run.sh will pull the latest code and restart it."
    echo "Watch it come back up with:  tmux attach -t jeevespt   (then Ctrl-B D to detach)"
else
    echo "No running Jeeves process found."
    echo "Make sure it's running under ./run.sh in its tmux window."
    exit 1
fi
