#!/data/data/com.termux/files/usr/bin/bash
set -uo pipefail

echo "===================================================="
echo "[KLYN AI OS v6] ENTERPRISE CLUSTER VALIDATION SUITE"
echo "===================================================="

# 1. Validate Network Socket Bindings
echo "[TEST 1] Auditing active network socket bindings..."
PORTS=(9000 9001 9002)
FAILED_PORTS=0

for port in "${PORTS[@]}"; do
  if nc -z -w 1 127.0.0.1 "$port" 2>/dev/null; then
    echo "  -> TCP Port $port: ONLINE (Operational)"
  else
    echo "  -> TCP Port $port: OFFLINE (Critical Failure)"
    FAILED_PORTS=1
  fi
done

if [ $FAILED_PORTS -eq 1 ]; then
  echo -e "\n[CRITICAL] Validation stopped. Please launch the system first using: ./kernel/v6/boot_v6.sh"
  exit 1
fi

# 2. Programmatic JSON Packet Generation & Live Injection
TX_ID="tx_verify_$(date +%s)"
echo -e "\n[TEST 2] Generating atomic payload and broadcasting to Master Port 9000..."

TEST_PAYLOAD=$(jq -n \
  --arg id "$TX_ID" \
  --arg type "build" \
  --arg payload "Automated network cluster infrastructure verification telemetry" \
  '{"id":$id,"type":$type,"payload":$payload}')

# Fire the packet down the network stream channel
echo "$TEST_PAYLOAD" | nc 127.0.0.1 9000
echo "  -> Packet [$TX_ID] broadcasted. Holding buffer for execution pipeline..."
sleep 2

# 3. Telemetry Log Audit
echo -e "\n[TEST 3] Auditing target worker microservice logs for packet ingestion..."
LOG_FILE="runtime/v6/logs/node_9001.log"

if [[ -f "$LOG_FILE" ]]; then
  if grep -q "$TX_ID" "$LOG_FILE"; then
    echo "  -> STATUS: SUCCESS! Node captures validated over live TCP socket."
    echo -e "\n==================== LOG VERIFICATION ===================="
    grep "$TX_ID" "$LOG_FILE"
    echo "========================================================"
  else
    echo "  -> STATUS: FAILED! Payload was dropped or choked inside the buffer pool."
    exit 1
  fi
else
  echo "  -> STATUS: FAILED! Target log file '$LOG_FILE' does not exist."
  exit 1
fi

echo -e "\n[CONCLUSION] KLYN AI OS v6 Cloud Core Architecture is 100% Verified."
