#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

action="${1:-}"
name="${2:-}"

case "$action" in
  install)
    mkdir -p "runtime/plugins/$name"
    echo "[KLYN] Plugin installed: $name"
    ;;
  *)
    echo "Usage: klyn plugin install <name>"
    ;;
esac
