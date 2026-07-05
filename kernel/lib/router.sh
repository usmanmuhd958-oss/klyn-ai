#!/usr/bin/env bash

route_agent() {
    case "$1" in
        code) echo GPT55 ;;
        research) echo GEMINI ;;
        design) echo OPUS ;;
        reasoning) echo DEEPSEEK ;;
        *) echo GPT55 ;;
    esac
}
