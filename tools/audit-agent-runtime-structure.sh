#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN AGENT RUNTIME STRUCTURE AUDIT"
echo "======================================"

echo
echo "[1] Searching agent-runtime"

find packages -path "*agent-runtime*" -maxdepth 5 -type f | sort

echo
echo "[2] Searching AgentExecutor files"

find . -iname "*AgentExecutor*" -o -iname "*agent_executor*" | sort

echo
echo "[3] Checking package exports"

find packages -maxdepth 3 -name package.json -print | grep agent

echo
echo "======================================"
echo " AUDIT COMPLETE"
echo "======================================"
