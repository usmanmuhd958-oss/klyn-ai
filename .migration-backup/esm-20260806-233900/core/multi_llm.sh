#!/usr/bin/env bash

llm_route() {
    case "$1" in
        code) echo GPT55 ;;
        research) echo GEMINI ;;
        design) echo OPUS ;;
        reasoning) echo DEEPSEEK ;;
        *) echo GPT55 ;;
    esac
}
