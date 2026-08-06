#!/bin/sh
set -u

REPO_DIR=${PALWORLD_REPO_DIR:-/home/lsemi/palworld-server}
NODE_BIN=/home/lsemi/.nvm/versions/node/v22.16.0/bin/node

cd "$REPO_DIR"

while true; do
	"$NODE_BIN" apps/discord-bot/src/index.js
	exit_code=$?
	echo "Discord Bot exited with code ${exit_code}; restarting in 10 seconds."
	sleep 10
done
