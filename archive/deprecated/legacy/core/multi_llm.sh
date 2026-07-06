#!/bin/bash
set -euo pipefail

#############################################
# KLYN AI OS v6 - Multi LLM Gateway Router
# Supports: Gemini, Claude, GPT, DeepSeek
#############################################

# -----------------------------
# SAFE ERROR HANDLER
# -----------------------------
fail() {
  echo "[LLM ERROR] $1" >&2
  return 1
}

# -----------------------------
# GEMINI (Architecture / Docs)
# -----------------------------
call_gemini() {
  local prompt="${1:-}"

  [[ -z "${GEMINI_API_KEY:-}" ]] && fail "GEMINI_API_KEY not set" && return 1
  [[ -z "$prompt" ]] && fail "Empty prompt" && return 1

  curl -s https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key="$GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$prompt" '{
      contents: [
        { parts: [ { text: $p } ] }
      ]
    }')" | jq -r '.candidates[0].content.parts[0].text // "NO_RESPONSE"'
}

# -----------------------------
# CLAUDE (Production Coding)
# -----------------------------
call_claude() {
  local prompt="${1:-}"

  [[ -z "${CLAUDE_API_KEY:-}" ]] && fail "CLAUDE_API_KEY not set" && return 1
  [[ -z "$prompt" ]] && fail "Empty prompt" && return 1

  curl -s https://api.anthropic.com/v1/messages \
    -H "x-api-key: $CLAUDE_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "$(jq -n --arg p "$prompt" '{
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 4096,
      messages: [
        { role: "user", content: $p }
      ]
    }')" | jq -r '.content[0].text // "NO_RESPONSE"'
}

# -----------------------------
# GPT (Debugging / Review)
# -----------------------------
call_gpt() {
  local prompt="${1:-}"

  [[ -z "${OPENAI_API_KEY:-}" ]] && fail "OPENAI_API_KEY not set" && return 1
  [[ -z "$prompt" ]] && fail "Empty prompt" && return 1

  curl -s https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$prompt" '{
      model: "gpt-4o",
      messages: [
        { role: "user", content: $p }
      ],
      temperature: 0.2
    }')" | jq -r '.choices[0].message.content // "NO_RESPONSE"'
}

# -----------------------------
# DEEPSEEK (Logic / Math / Cheap compute)
# -----------------------------
call_deepseek() {
  local prompt="${1:-}"

  [[ -z "${DEEPSEEK_API_KEY:-}" ]] && fail "DEEPSEEK_API_KEY not set" && return 1
  [[ -z "$prompt" ]] && fail "Empty prompt" && return 1

  curl -s https://api.deepseek.com/chat/completions \
    -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$prompt" '{
      model: "deepseek-chat",
      messages: [
        { role: "user", content: $p }
      ],
      temperature: 0.3
    }')" | jq -r '.choices[0].message.content // "NO_RESPONSE"'
}

# -----------------------------
# OPTIONAL CLI ROUTER
# -----------------------------
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  provider="${1:-}"
  shift || true
  prompt="${*:-}"

  case "$provider" in
    gemini) call_gemini "$prompt" ;;
    claude) call_claude "$prompt" ;;
    gpt) call_gpt "$prompt" ;;
    deepseek) call_deepseek "$prompt" ;;
    *)
      echo "Usage: $0 {gemini|claude|gpt|deepseek} \"prompt\"" >&2
      exit 1
      ;;
  esac
fi
