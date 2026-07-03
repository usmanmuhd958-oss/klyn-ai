#!/bin/bash

# KLYN AI OS - Monorepo Bootstrap Script
# Initializes project structure, dependencies, and builds

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="${SCRIPT_DIR%/*}"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing=0
    
    if ! command -v rustc &> /dev/null; then
        log_error "Rust not found. Install from https://rustup.rs/"
        missing=1
    fi
    
    if ! command -v go &> /dev/null; then
        log_error "Go not found. Install from https://golang.org/doc/install"
        missing=1
    fi
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Install from https://nodejs.org/"
        missing=1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Install from https://docs.docker.com/install/"
        missing=1
    fi
    
    if ! command -v protoc &> /dev/null; then
        log_error "Protocol Buffers not found. Install from https://developers.google.com/protocol-buffers/docs/downloads"
        missing=1
    fi
    
    if [ $missing -eq 1 ]; then
        log_error "Missing required tools. Please install them and try again."
        exit 1
    fi
    
    log_success "All prerequisites found"
}

# Create directory structure
create_structure() {
    log_info "Creating directory structure..."
    
    mkdir -p "${PROJECT_ROOT}"/{packages,services,proto,sdk,cli,docs,deploy,tests}
    mkdir -p "${PROJECT_ROOT}"/packages/{event-store,scheduler,memory-manager,security,ipc,cluster-coordinator}
    mkdir -p "${PROJECT_ROOT}"/services/{kernel,control-plane,agent-manager,api-gateway,recovery}
    mkdir -p "${PROJECT_ROOT}"/sdk/{rust,go,typescript}
    mkdir -p "${PROJECT_ROOT}"/cli/{commands,config,output}
    mkdir -p "${PROJECT_ROOT}"/deploy/{kubernetes,terraform,docker-compose,helm}
    mkdir -p "${PROJECT_ROOT}"/tests/{unit,integration,chaos,performance}
    mkdir -p "${PROJECT_ROOT}"/docs/{design,api,guides,examples}
    mkdir -p "${PROJECT_ROOT}"/.github/workflows
    
    log_success "Directory structure created"
}

# Initialize Rust workspace
init_rust() {
    log_info "Initializing Rust workspace..."
    
    cd "${PROJECT_ROOT}"
    
    # Create workspace Cargo.toml
    cat > Cargo.toml << 'EOF'
[workspace]
members = [
    "services/kernel",
    "packages/event-store",
    "packages/scheduler",
    "packages/memory-manager",
    "packages/security",
    "packages/ipc",
    "packages/cluster-coordinator",
]
resolver = "2"

[workspace.package]
version = "6.0.0"
edition = "2021"
authors = ["KLYN AI OS Contributors"]
license = "Apache-2.0"

[workspace.dependencies]
tokio = { version = "1.35", features = ["full"] }
tonic = "0.11"
prost = "0.12"
tracing = "0.1"
tracing-subscriber = "0.3"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
async-trait = "0.1"
bytes = "1.5"
uuid = { version = "1.6", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
dashmap = "5.5"
parking_lot = "0.12"
anyhow = "1.0"
clap = { version = "4.4", features = ["derive"] }
EOF
    
    log_success "Rust workspace initialized"
}

# Initialize Go modules
init_go() {
    log_info "Initializing Go modules..."
    
    cd "${PROJECT_ROOT}"
    
    # Create go.work file for workspace
    cat > go.work << 'EOF'
go 1.21

use (
    ./services/control-plane
    ./services/api-gateway
    ./services/recovery
    ./sdk/go
)
EOF
    
    cd services/control-plane 2>/dev/null || true
    if [ -d "services/control-plane" ]; then
        go mod init github.com/usmanmuhd958-oss/klyn-ai/services/control-plane 2>/dev/null || true
        go mod tidy 2>/dev/null || true
    fi
    
    log_success "Go modules initialized"
}

# Initialize TypeScript projects
init_typescript() {
    log_info "Initializing TypeScript projects..."
    
    cd "${PROJECT_ROOT}"
    
    # Root package.json
    cat > package.json << 'EOF'
{
  "name": "klyn-ai-monorepo",
  "version": "6.0.0",
  "description": "KLYN AI OS - Intent Execution Operating System",
  "private": true,
  "workspaces": [
    "sdk/typescript",
    "cli"
  ],
  "scripts": {
    "build": "pnpm build --recursive",
    "test": "pnpm test --recursive",
    "lint": "pnpm lint --recursive",
    "fmt": "prettier --write '**/*.{ts,js,json,yaml,md}'",
    "proto:gen": "pnpm run -r proto:gen"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.2.0",
    "prettier": "^3.0.0",
    "eslint": "^8.50.0"
  }
}
EOF
    
    # SDK TypeScript
    mkdir -p sdk/typescript
    cat > sdk/typescript/package.json << 'EOF'
{
  "name": "@klyn-ai/sdk",
  "version": "6.0.0",
  "description": "KLYN AI OS TypeScript SDK",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc && esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js",
    "test": "jest",
    "lint": "eslint src --ext .ts",
    "proto:gen": "grpc_tools_node_protoc --js_out=import_style=commonjs,binary:src/generated --grpc_out=grpc_js:src/generated --plugin=protoc-gen-grpc=grpc_tools_node_protoc_plugin proto/**/*.proto"
  },
  "dependencies": {
    "@grpc/grpc-js": "^1.9.0",
    "protobufjs": "^7.2.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "typescript": "^5.2.0",
    "@types/node": "^20.0.0",
    "esbuild": "^0.19.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0"
  }
}
EOF
    
    # CLI TypeScript
    mkdir -p cli
    cat > cli/package.json << 'EOF'
{
  "name": "@klyn-ai/cli",
  "version": "6.0.0",
  "description": "KLYN AI OS Command Line Interface",
  "bin": {
    "klyn": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@klyn-ai/sdk": "workspace:*",
    "commander": "^11.0.0",
    "chalk": "^5.3.0",
    "ora": "^7.0.0",
    "table": "^6.8.0"
  },
  "devDependencies": {
    "typescript": "^5.2.0",
    "@types/node": "^20.0.0"
  }
}
EOF
    
    # TypeScript configs
    cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
EOF
    
    log_success "TypeScript projects initialized"
}

# Generate protobuf files
init_proto() {
    log_info "Initializing Protocol Buffers..."
    
    mkdir -p "${PROJECT_ROOT}"/proto/{kernel,control-plane,agent-manager}
    
    # Kernel proto
    cat > "${PROJECT_ROOT}"/proto/kernel/kernel.proto << 'EOF'
syntax = "proto3";

package klyn.kernel.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/usmanmuhd958-oss/klyn-ai/proto/gen/go/kernel/v1";
option java_package = "com.klyn.kernel.v1";

message Event {
  string id = 1;
  google.protobuf.Timestamp timestamp = 2;
  string aggregate_id = 3;
  string type = 4;
  bytes data = 5;
  map<string, string> metadata = 6;
  bytes signature = 7;
}

message ExecutionRequest {
  string intent = 1;
  map<string, string> metadata = 2;
  int32 timeout_seconds = 3;
}

message ExecutionResponse {
  string execution_id = 1;
  string status = 2;
  google.protobuf.Timestamp created_at = 3;
}

message ExecutionStatus {
  string execution_id = 1;
  string phase = 2;
  float progress = 3;
  repeated TaskStatus task_statuses = 4;
  string error_message = 5;
}

message TaskStatus {
  string task_id = 1;
  string agent_type = 2;
  string status = 3;
  int64 elapsed_ms = 4;
}

service KernelService {
  rpc Execute(ExecutionRequest) returns (ExecutionResponse);
  rpc GetStatus(StatusRequest) returns (ExecutionStatus);
  rpc WatchStatus(WatchRequest) returns (stream ExecutionStatus);
}

message StatusRequest {
  string execution_id = 1;
}

message WatchRequest {
  string execution_id = 1;
}
EOF

    # Control-plane proto
    cat > "${PROJECT_ROOT}"/proto/control-plane/control_plane.proto << 'EOF'
syntax = "proto3";

package klyn.controlplane.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/usmanmuhd958-oss/klyn-ai/proto/gen/go/controlplane/v1";

message Agent {
  string id = 1;
  string type = 2;
  string status = 3;
  google.protobuf.Timestamp started_at = 4;
  string region = 5;
  map<string, string> metadata = 6;
}

message ClusterNode {
  string id = 1;
  string region = 2;
  string status = 3;
  float cpu_percent = 4;
  int64 memory_mb = 5;
  google.protobuf.Timestamp last_heartbeat = 6;
}

message ListAgentsRequest {
  string agent_type = 1;
  string status = 2;
}

message ListAgentsResponse {
  repeated Agent agents = 1;
}

message ListNodesRequest {}

message ListNodesResponse {
  repeated ClusterNode nodes = 1;
}

service ControlPlaneService {
  rpc ListAgents(ListAgentsRequest) returns (ListAgentsResponse);
  rpc ListNodes(ListNodesRequest) returns (ListNodesResponse);
  rpc GetClusterHealth(HealthRequest) returns (HealthResponse);
}

message HealthRequest {}

message HealthResponse {
  string status = 1;
  int32 healthy_nodes = 2;
  int32 total_nodes = 3;
}
EOF

    log_success "Protocol Buffers initialized"
}

# Create build artifacts
init_build() {
    log_info "Creating build configuration..."
    
    # Makefile
    cat > "${PROJECT_ROOT}"/Makefile << 'EOF'
.PHONY: help build clean test lint fmt generate docker-build docker-push deploy

help:
	@echo "KLYN AI OS Build System"
	@echo "======================="
	@echo "Targets:"
	@echo "  build          - Build all components"
	@echo "  clean          - Clean build artifacts"
	@echo "  test           - Run all tests"
	@echo "  lint           - Lint code"
	@echo "  fmt            - Format code"
	@echo "  generate       - Generate protobuf code"
	@echo "  docker-build   - Build Docker images"
	@echo "  docker-push    - Push Docker images to registry"
	@echo "  deploy         - Deploy to Kubernetes"

build: generate
	cd services/kernel && cargo build --release
	cd services/control-plane && go build -o bin/control-plane ./cmd
	cd services/api-gateway && go build -o bin/api-gateway ./cmd
	cd sdk/typescript && pnpm build
	cd cli && pnpm build

clean:
	cd services/kernel && cargo clean
	find services -name "bin" -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true

test:
	cd services/kernel && cargo test --all
	cd services/control-plane && go test ./...
	cd services/api-gateway && go test ./...
	cd sdk/typescript && pnpm test
	cd cli && pnpm test

lint:
	cd services/kernel && cargo clippy --all -- -D warnings
	cd services/control-plane && golangci-lint run
	cd services/api-gateway && golangci-lint run
	cd sdk/typescript && pnpm lint
	cd cli && pnpm lint

fmt:
	cd services/kernel && cargo fmt
	cd services/control-plane && go fmt ./...
	cd services/api-gateway && go fmt ./...
	cd sdk/typescript && pnpm fmt
	cd cli && pnpm fmt
	prettier --write docs/**/*.md

generate:
	@echo "Generating protobuf code..."
	protoc --go_out=. --go-grpc_out=. proto/kernel/kernel.proto
	protoc --go_out=. --go-grpc_out=. proto/control-plane/control_plane.proto
	protoc --go_out=. --go-grpc_out=. proto/agent-manager/agent_manager.proto
	protoc --go_out=. --go-grpc_out=. proto/recovery/recovery.proto

docker-build:
	docker build -f deploy/docker/Dockerfile.kernel -t klyn:kernel:6.0.0 .
	docker build -f deploy/docker/Dockerfile.control-plane -t klyn:control-plane:6.0.0 .
	docker build -f deploy/docker/Dockerfile.api-gateway -t klyn:api-gateway:6.0.0 .
	docker build -f deploy/docker/Dockerfile.agent-manager -t klyn:agent-manager:6.0.0 .
	docker build -f deploy/docker/Dockerfile.cli -t klyn:cli:6.0.0 .

docker-push: docker-build
	docker tag klyn:kernel:6.0.0 ${REGISTRY}/klyn:kernel:6.0.0
	docker tag klyn:control-plane:6.0.0 ${REGISTRY}/klyn:control-plane:6.0.0
	docker tag klyn:api-gateway:6.0.0 ${REGISTRY}/klyn:api-gateway:6.0.0
	docker tag klyn:agent-manager:6.0.0 ${REGISTRY}/klyn:agent-manager:6.0.0
	docker tag klyn:cli:6.0.0 ${REGISTRY}/klyn:cli:6.0.0
	docker push ${REGISTRY}/klyn:kernel:6.0.0
	docker push ${REGISTRY}/klyn:control-plane:6.0.0
	docker push ${REGISTRY}/klyn:api-gateway:6.0.0
	docker push ${REGISTRY}/klyn:agent-manager:6.0.0
	docker push ${REGISTRY}/klyn:cli:6.0.0

deploy: docker-build
	kubectl apply -f deploy/kubernetes/namespace.yaml
	kubectl apply -f deploy/kubernetes/configmap.yaml
	kubectl apply -f deploy/kubernetes/statefulset-kernel.yaml
	kubectl apply -f deploy/kubernetes/deployment-control-plane.yaml
	kubectl apply -f deploy/kubernetes/deployment-api-gateway.yaml
	kubectl apply -f deploy/kubernetes/service.yaml

.PHONY: help build clean test lint fmt generate docker-build docker-push deploy
EOF

    log_success "Build configuration created"
}

# Main execution
main() {
    log_info "Starting KLYN AI OS Monorepo Bootstrap..."
    log_info "Project Root: ${PROJECT_ROOT}"
    
    check_prerequisites
    create_structure
    init_rust
    init_go
    init_typescript
    init_proto
    init_build
    
    log_success "==================================="
    log_success "Bootstrap Complete!"
    log_success "==================================="
    log_info "Next steps:"
    log_info "1. cd ${PROJECT_ROOT}"
    log_info "2. make generate    # Generate protobuf code"
    log_info "3. make build       # Build all components"
    log_info "4. make test        # Run tests"
    log_info "5. make docker-build # Build Docker images"
}

main "$@"
