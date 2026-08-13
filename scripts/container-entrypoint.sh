#!/bin/sh
set -eu

for directory in /data /models; do
  mkdir -p "$directory"
  chown node:node "$directory"
  chmod 700 "$directory"
done

exec /usr/bin/setpriv --reuid=node --regid=node --init-groups -- "$@"
