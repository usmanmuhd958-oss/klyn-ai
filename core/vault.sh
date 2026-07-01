#!/bin/bash
set -euo pipefail

BASE_DIR="runtime/workspace"

log() {
  echo "[VAULT] $1"
}

ensure_workspace() {
  local pipeline_id="$1"
  local dir="$BASE_DIR/$pipeline_id"

  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
    log "Created workspace for pipeline: $pipeline_id"
  fi
}

save_artifact() {
  local pipeline_id="$1"
  local name="$2"
  local content="$3"

  ensure_workspace "$pipeline_id"

  local file="$BASE_DIR/$pipeline_id/$name"

  # atomic write to prevent partial corruption
  local tmp_file
  tmp_file="$(mktemp)"

  echo "$content" > "$tmp_file"
  mv "$tmp_file" "$file"

  log "Saved artifact [$name] for pipeline [$pipeline_id]"
  return 0
}

get_artifact() {
  local pipeline_id="$1"
  local name="$2"

  local file="$BASE_DIR/$pipeline_id/$name"

  if [[ ! -f "$file" ]]; then
    echo "[VAULT][ERROR] Artifact not found: $pipeline_id/$name" >&2
    return 1
  fi

  cat "$file"
  return 0
}

# ----------------------------
# CLI Router
# ----------------------------
main() {
  local cmd="${1:-}"

  case "$cmd" in
    save)
      if [[ $# -lt 4 ]]; then
        echo "[VAULT][ERROR] Usage: save <pipeline_id> <artifact_name> <content>" >&2
        exit 1
      fi

      save_artifact "$2" "$3" "$4"
      ;;

    get)
      if [[ $# -lt 3 ]]; then
        echo "[VAULT][ERROR] Usage: get <pipeline_id> <artifact_name>" >&2
        exit 1
      fi

      get_artifact "$2" "$3"
      ;;

    *)
      echo "[VAULT][ERROR] Unknown command: ${cmd}"
      echo "Usage:"
      echo "  save <pipeline_id> <artifact_name> <content>"
      echo "  get  <pipeline_id> <artifact_name>"
      exit 1
      ;;
  esac
}

main "$@"
