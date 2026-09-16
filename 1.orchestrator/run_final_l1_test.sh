#!/bin/bash
export UV_THREADPOOL_SIZE=16
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_ANDROID_LINKER=clang

echo "🔥 Running Final Layer 1 Orchestrator Benchmark..."
npm test
