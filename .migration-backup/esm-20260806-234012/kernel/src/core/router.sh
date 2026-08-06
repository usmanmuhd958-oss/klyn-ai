#!/usr/bin/env bash

route_task() {
    local task="$1"

    case "$task" in
        code|refactor|debug)
            echo coding
            ;;
        reason|math|algorithm)
            echo reasoning
            ;;
        search|research|docs)
            echo research
            ;;
        design|architecture|planning)
            echo architecture
            ;;
        *)
            echo coding
            ;;
    esac
}
