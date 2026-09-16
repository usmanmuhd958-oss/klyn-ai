#!/usr/bin/env bash
set -euo pipefail

MSG_HELLO="HELLO"
MSG_INIT="INIT"
MSG_READY="READY"
MSG_SHUTDOWN="SHUTDOWN"
MSG_ACK_SHUTDOWN="ACK_SHUTDOWN"
MSG_TASK_ASSIGN="TASK_ASSIGN"
MSG_TASK_RESULT="TASK_RESULT"
MSG_TASK_ERROR="TASK_ERROR"
MSG_HEARTBEAT="HEARTBEAT"
MSG_HEARTBEAT_ACK="HEARTBEAT_ACK"
MSG_ERROR="ERROR"
MSG_FATAL_ERROR="FATAL_ERROR"

STATE_SPAWNING="SPAWNING"
STATE_ONLINE="ONLINE"
STATE_INITIALIZING="INITIALIZING"
STATE_READY="READY"
STATE_BUSY="BUSY"
STATE_ERROR="ERROR"
STATE_SHUTTING_DOWN="SHUTTING_DOWN"
STATE_TERMINATED="TERMINATED"

TIMEOUT_AGENT_SPAWN=20000
TIMEOUT_AGENT_INIT=15000
TIMEOUT_AGENT_READY_TOTAL=35000
TIMEOUT_HEARTBEAT_INTERVAL=30000
TIMEOUT_HEARTBEAT_TIMEOUT=45000
TIMEOUT_TASK_DEFAULT=300000
TIMEOUT_SHUTDOWN_GRACE=10000
TIMEOUT_MESSAGE_ACK=5000
TIMEOUT_RETRY_DELAY=2000

RETRY_MAX_RETRIES=3
RETRY_BACKOFF_MULTIPLIER=1.5
RETRY_MAX_BACKOFF=10000

_generate_id() {
  if command -v uuidgen &>/dev/null; then echo "msg_$(uuidgen)"; else echo "msg_$(date +%s%N)_${RANDOM}${RANDOM}"; fi
}

# Convert any string to a valid, compact JSON value (defaults to {})
_to_json() {
  local input="$1"
  if [ -z "$input" ]; then echo "{}"; return; fi
  echo "$input" | jq -c . 2>/dev/null || echo "{}"
}

message_create() {
  local type="$1"
  local payload="$2"
  local sender="${3:-unknown}"
  local recipient="${4:-broadcast}"
  local priority="${5:-normal}"

  # Ensure payload is valid JSON
  payload="$(_to_json "$payload")"

  local id ts
  id="$(_generate_id)"
  ts="$(date +%s%3N 2>/dev/null || echo $(( $(date +%s) * 1000 )))"

  jq -n \
    --arg id "$id" \
    --arg type "$type" \
    --argjson payload "$payload" \
    --arg ts "$ts" \
    --arg sender "$sender" \
    --arg recipient "$recipient" \
    --arg priority "$priority" \
    '{
      id: $id,
      type: $type,
      payload: $payload,
      timestamp: $ts,
      sender: $sender,
      recipient: $recipient,
      correlationId: null,
      signature: null,
      priority: $priority
    }'
}

message_hello() {
  local agent_id="$1"
  local capabilities="$(_to_json "${2:-{}}")"
  local pid="${3:-$PPID}"

  local payload
  payload="$(jq -n \
    --arg agentId "$agent_id" \
    --arg pid "$pid" \
    --argjson capabilities "$capabilities" \
    --arg platform "$(uname -s)" \
    --arg nodeVersion "bash" \
    '{agentId: $agentId, pid: $pid, capabilities: $capabilities, environment: {platform: $platform, nodeVersion: $nodeVersion, memory: "bash"}}')"

  message_create "$MSG_HELLO" "$payload" "$agent_id"
}

message_init() {
  local agent_id="$1"
  local config="$(_to_json "${2:-{}}")"
  local payload
  payload="$(jq -n --arg agentId "$agent_id" --argjson config "$config" '{agentId: $agentId, config: $config}')"
  message_create "$MSG_INIT" "$payload" "kernel" "$agent_id"
}

message_ready() {
  local agent_id="$1"
  local status="$(_to_json "${2:-{}}")"
  local payload
  payload="$(jq -n --arg agentId "$agent_id" --argjson status "$status" '{agentId: $agentId, status: $status}')"
  message_create "$MSG_READY" "$payload" "$agent_id" "kernel"
}

message_heartbeat() {
  local agent_id="$1"
  local metrics="$(_to_json "${2:-{}}")"
  local payload
  payload="$(jq -n --arg agentId "$agent_id" --argjson metrics "$metrics" '{agentId: $agentId, metrics: $metrics}')"
  message_create "$MSG_HEARTBEAT" "$payload" "$agent_id" "broadcast" "low"
}

message_error() {
  local agent_id="$1"
  local error_msg="$2"
  local context="$(_to_json "${3:-{}}")"
  local payload
  payload="$(jq -n --arg agentId "$agent_id" --arg msg "$error_msg" --argjson context "$context" '{agentId: $agentId, error: {message: $msg}, context: $context, recoverable: true}')"
  message_create "$MSG_ERROR" "$payload" "$agent_id" "broadcast" "high"
}

message_fatal_error() {
  local agent_id="$1"
  local error_msg="$2"
  local context="$(_to_json "${3:-{}}")"
  local payload
  payload="$(jq -n --arg agentId "$agent_id" --arg msg "$error_msg" --argjson context "$context" '{agentId: $agentId, error: {message: $msg}, context: $context, recoverable: false}')"
  message_create "$MSG_FATAL_ERROR" "$payload" "$agent_id" "broadcast" "critical"
}

message_validate() {
  local json="$1"
  jq -e '.id and .timestamp' <<<"$json" >/dev/null 2>&1 || return 1
  local ts
  ts="$(jq -r '.timestamp' <<<"$json")"
  local now="$(date +%s%3N 2>/dev/null || echo $(( $(date +%s) * 1000 )))"
  [ "$ts" -le $((now + 5000)) ] && return 0
  return 1
}

message_get_field() {
  local json="$1"
  local field="$2"
  jq -r ".$field" <<<"$json"
}

echo "✅ protocol.sh loaded – enterprise-grade IPC available."
