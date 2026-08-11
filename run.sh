#!/usr/bin/env sh
# Cheremsha: Goshype - launcher for macOS/Linux
cd "$(dirname "$0")" || exit 1

if command -v python3 >/dev/null 2>&1; then
  exec python3 server/app.py "$@"
elif command -v python >/dev/null 2>&1; then
  exec python server/app.py "$@"
else
  echo "Python 3.9+ not found."
  exit 1
fi
