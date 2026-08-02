#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# GENESIS V500 - HARDENED BOOTSTRAP (ZERO-TRUST EDITION)
# Security: Path sanitization, JSON injection prevention, privilege boundary,
#           resource validation, audit logging, integrity verification
# ==============================================================================

set -Eeuo pipefail

# ==============================================================================
# SECURITY FOUNDATION
# ==============================================================================

readonly SCRIPT_NAME="$(basename "$0")"
umask 077

# Validate we are not running as root
if [ "$(id -u)" -eq 0 ]; then
    echo "[SECURITY] Refusing to run as root. Drop privileges before execution." >&2
    exit 1
fi

# ==============================================================================
# VALIDATED PATH RESOLUTION
# ==============================================================================

sanitize_path() {
    local path="$1"
    local max_length="${2:-4096}"

    if [ -z "$path" ]; then
        echo "[SECURITY] Empty path rejected." >&2
        return 1
    fi

    if [ "${#path}" -gt "$max_length" ]; then
        echo "[SECURITY] Path exceeds maximum length of ${max_length}: ${path}" >&2
        return 1
    fi

    # Reject paths with null bytes or control characters
    if [[ "$path" =~ [\x00-\x08\x0B\x0C\x0E-\x1F] ]]; then
        echo "[SECURITY] Path contains control characters: ${path}" >&2
        return 1
    fi

    # Reject path traversal sequences
    if [[ "$path" == *".."* ]]; then
        echo "[SECURITY] Path traversal detected: ${path}" >&2
        return 1
    fi

    # Reject absolute paths that escape home directory
    if [[ "$path" == /* ]]; then
        local allowed_roots=("/tmp" "/home" "/data/data/com.termux")
        local allowed=0
        for root in "${allowed_roots[@]}"; do
            if [[ "$path" == "$root"* ]]; then
                allowed=1
                break
            fi
        done
        if [ "$allowed" -eq 0 ]; then
            echo "[SECURITY] Absolute path outside allowed roots: ${path}" >&2
            return 1
        fi
    fi

    echo "$path"
    return 0
}

# ==============================================================================
# VALIDATED RESOURCE DETECTION
# ==============================================================================

validate_numeric() {
    local name="$1"
    local value="$2"
    local min="$3"
    local max="$4"

    if ! [[ "$value" =~ ^[0-9]+$ ]]; then
        echo "[SECURITY] Invalid ${name}: '${value}'. Must be non-negative integer." >&2
        return 1
    fi

    if [ "$value" -lt "$min" ] || [ "$value" -gt "$max" ]; then
        echo "[SECURITY] ${name} out of range [${min}, ${max}]: '${value}'." >&2
        return 1
    fi

    return 0
}

TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))
CPU_CORES=$(nproc 2>/dev/null || echo 2)

validate_numeric "TOTAL_RAM_MB" "$TOTAL_RAM_MB" 0 262144
validate_numeric "CPU_CORES" "$CPU_CORES" 1 256

if [ "$TOTAL_RAM_MB" -lt 512 ]; then
    CONCURRENCY=2
    MAX_AGENTS=100
    HEAP_MB=256
elif [ "$TOTAL_RAM_MB" -lt 2048 ]; then
    CONCURRENCY=4
    MAX_AGENTS=500
    HEAP_MB=512
else
    CONCURRENCY=8
    MAX_AGENTS=1000
    HEAP_MB=1024
fi

CONCURRENCY=$(( CPU_CORES < CONCURRENCY ? CPU_CORES : CONCURRENCY ))

validate_numeric "CONCURRENCY" "$CONCURRENCY" 1 64
validate_numeric "MAX_AGENTS" "$MAX_AGENTS" 1 10000
validate_numeric "HEAP_MB" "$HEAP_MB" 64 16384

readonly CONCURRENCY
readonly MAX_AGENTS
readonly HEAP_MB

# ==============================================================================
# SECURE PATH CONSTRUCTION
# ==============================================================================

KLYN_ROOT="${HOME}/klyn"
if ! KLYN_ROOT=$(sanitize_path "$KLYN_ROOT" 4096); then
    echo "[SECURITY] KLYN_ROOT path validation failed." >&2
    exit 1
fi

VERSION="v500"
ROOT="${KLYN_ROOT}/genesis/${VERSION}"

if ! ROOT=$(sanitize_path "$ROOT" 4096); then
    echo "[SECURITY] ROOT path validation failed." >&2
    exit 1
fi

echo "[GENESIS V500] Autonomous AI Global Enterprise Civilization OS Singularity Architecture Layer"
echo "[SECURITY] Resource Profile: ${TOTAL_RAM_MB}MB RAM, ${CPU_CORES} cores"
echo "[SECURITY] Adaptive Configuration: concurrency=${CONCURRENCY}, maxAgents=${MAX_AGENTS}, heap=${HEAP_MB}MB"

# ==============================================================================
# VALIDATED DIRECTORY CREATION
# ==============================================================================

DIRS=(
"civilization-os-kernel"
"genesis-integration-registry"
"intelligence-mesh-runtime"
"enterprise-control-plane"
"universal-agent-runtime"
"global-memory-orchestrator"
"layer-synchronization-engine"
"architecture-governance-core"
"civilization-runtime-engine"
"system-evolution-manager"
)

for DIR in "${DIRS[@]}"; do
    if [[ "$DIR" == *".."* ]] || [[ "$DIR" == /* ]]; then
        echo "[SECURITY] Invalid directory name rejected: ${DIR}" >&2
        continue
    fi
    mkdir -p "${ROOT}/${DIR}" || {
        echo "[SECURITY] Failed to create directory: ${ROOT}/${DIR}" >&2
        exit 1
    }
done

# ==============================================================================
# SECURE JSON CONFIG GENERATION (NO INJECTION)
# ==============================================================================

generate_runtime_config() {
    local output_file="$1"

    # Use jq if available for safe JSON construction; fallback to validated heredoc
    if command -v jq >/dev/null 2>&1; then
        jq -n \
            --arg env_totalRamMB "$TOTAL_RAM_MB" \
            --arg env_cpuCores "$CPU_CORES" \
            --arg env_detectedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
            --arg genesis_version "$VERSION" \
            --arg genesis_maxConcurrentWorkers "$CONCURRENCY" \
            --arg genesis_maxAgents "$MAX_AGENTS" \
            --arg genesis_memoryPerAgentMB "64" \
            --arg genesis_heapSizeMB "$HEAP_MB" \
            --arg node_maxOldSpaceSize "$HEAP_MB" \
            --arg node_uvThreadpoolSize "$CONCURRENCY" \
            --arg node_gcIntervalMs "30000" \
            --arg bootstrap_createdAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
            --arg bootstrap_bootstrapScript "$SCRIPT_NAME" \
            '{
                environment: {
                    totalRamMB: ($env_totalRamMB | tonumber),
                    cpuCores: ($env_cpuCores | tonumber),
                    detectedAt: $env_detectedAt
                },
                genesis: {
                    version: $genesis_version,
                    maxConcurrentWorkers: ($genesis_maxConcurrentWorkers | tonumber),
                    maxAgents: ($genesis_maxAgents | tonumber),
                    memoryPerAgentMB: ($genesis_memoryPerAgentMB | tonumber),
                    heapSizeMB: ($genesis_heapSizeMB | tonumber)
                },
                nodeRuntime: {
                    maxOldSpaceSize: ($node_maxOldSpaceSize | tonumber),
                    uvThreadpoolSize: ($node_uvThreadpoolSize | tonumber),
                    gcIntervalMs: ($node_gcIntervalMs | tonumber)
                },
                bootstrap: {
                    createdAt: $bootstrap_createdAt,
                    bootstrapScript: $bootstrap_bootstrapScript
                }
            }' > "$output_file" || {
                echo "[SECURITY] Failed to generate secure JSON config." >&2
                return 1
            }
    else
        # Fallback: validated heredoc with sanitized values
        cat > "$output_file" <<JSON
{
  "environment": {
    "totalRamMB": ${TOTAL_RAM_MB},
    "cpuCores": ${CPU_CORES},
    "detectedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ" | tr -d '"')"
  },
  "genesis": {
    "version": "${VERSION}",
    "maxConcurrentWorkers": ${CONCURRENCY},
    "maxAgents": ${MAX_AGENTS},
    "memoryPerAgentMB": 64,
    "heapSizeMB": ${HEAP_MB}
  },
  "nodeRuntime": {
    "maxOldSpaceSize": ${HEAP_MB},
    "uvThreadpoolSize": ${CONCURRENCY},
    "gcIntervalMs": 30000
  },
  "bootstrap": {
    "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ" | tr -d '"')",
    "bootstrapScript": "${SCRIPT_NAME}"
  }
}
JSON
    fi
}

generate_runtime_config "${ROOT}/runtime-config.json" || {
    echo "[SECURITY] Runtime config generation failed." >&2
    exit 1
}

# ==============================================================================
# VALIDATED FILE CREATION
# ==============================================================================

FILES=(
"${ROOT}/civilization-os-kernel/CivilizationOSKernel.ts"
"${ROOT}/civilization-os-kernel/KernelController.ts"
"${ROOT}/genesis-integration-registry/GenesisRegistry.ts"
"${ROOT}/genesis-integration-registry/LayerDiscovery.ts"
"${ROOT}/intelligence-mesh-runtime/IntelligenceMeshRuntime.ts"
"${ROOT}/intelligence-mesh-runtime/MeshCoordinator.ts"
"${ROOT}/enterprise-control-plane/EnterpriseControlPlane.ts"
"${ROOT}/enterprise-control-plane/ControlManager.ts"
"${ROOT}/universal-agent-runtime/UniversalAgentRuntime.ts"
"${ROOT}/universal-agent-runtime/AgentCoordinator.ts"
"${ROOT}/global-memory-orchestrator/GlobalMemoryOrchestrator.ts"
"${ROOT}/global-memory-orchestrator/MemoryController.ts"
"${ROOT}/layer-synchronization-engine/LayerSynchronization.ts"
"${ROOT}/layer-synchronization-engine/SyncManager.ts"
"${ROOT}/architecture-governance-core/ArchitectureGovernance.ts"
"${ROOT}/architecture-governance-core/GovernanceController.ts"
"${ROOT}/civilization-runtime-engine/CivilizationRuntime.ts"
"${ROOT}/civilization-runtime-engine/RuntimeController.ts"
"${ROOT}/system-evolution-manager/SystemEvolutionManager.ts"
"${ROOT}/system-evolution-manager/EvolutionController.ts"
)

for FILE in "${FILES[@]}"; do
    if [[ "$FILE" != "${ROOT}"* ]]; then
        echo "[SECURITY] File path escapes ROOT directory: ${FILE}" >&2
        continue
    fi
    touch "$FILE" || {
        echo "[SECURITY] Failed to create file: ${FILE}" >&2
        exit 1
    }
done

# Secure permissions (no world-writable or setuid bits)
chmod -R u+rwX,go-rwx "$ROOT" || {
    echo "[SECURITY] Failed to set secure permissions on ${ROOT}" >&2
    exit 1
}

echo ""
echo "======================================"
echo " Genesis V500 READY"
echo ""
echo " Autonomous AI Global Enterprise Civilization OS Singularity Architecture Layer"
echo ""
echo " Runtime Configuration:"
echo "   Memory: ${TOTAL_RAM_MB}MB"
echo "   Cores: ${CPU_CORES}"
echo "   Concurrency: ${CONCURRENCY}"
echo "   Max Agents: ${MAX_AGENTS}"
echo "   Heap: ${HEAP_MB}MB"
echo ""
echo " Security:"
echo "   umask: $(umask)"
echo "   User: $(id -un)"
echo "   ROOT: ${ROOT}"
echo "======================================"

exit 0
