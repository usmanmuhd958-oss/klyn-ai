#!/usr/bin/env bash
set -Eeuo pipefail

run_agent() {
    local task="$1"
    local agent

    agent="$(route_task "$task")"

    emit_event agent.selected "$agent"

    case "$agent" in
        coding)
            echo "[GPT-5.5] $task"
            ;;
        reasoning)
            echo "[DeepSeek-R1] $task"
            ;;
        research)
            echo "[Gemini-3.1] $task"
            ;;
        architecture)
            echo "[Opus-4.8] $task"
            ;;
    esac
}
