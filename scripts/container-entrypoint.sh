#!/bin/sh
set -eu

for directory in /data /models; do
  mkdir -p "$directory"
  chown node:node "$directory"
  chmod 700 "$directory"
done

exec /usr/sbin/runuser -u node -- "$@"
