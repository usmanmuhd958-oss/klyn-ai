#!/data/data/com.termux/files/usr/bin/bash

set -e

mkdir -p architecture/graph

echo "{"
echo "\"generated\":\"$(date -u)\","
echo "\"modules\":{"

echo "\"AgentRuntime\":{"
echo "\"risk\":\"critical\","
echo "\"affected\":[
\"AgentExecutor\",
\"AIOrchestrator\"
]"
echo "},"

echo "\"AIEngine\":{"
echo "\"risk\":\"critical\","
echo "\"affected\":[
\"AIOrchestrator\",
\"Gateway\"
]"
echo "},"

echo "\"WorkflowEngine\":{"
echo "\"risk\":\"high\","
echo "\"affected\":[
\"Automation\"
]"
echo "},"

echo "\"MemoryEngine\":{"
echo "\"risk\":\"critical\","
echo "\"affected\":[
\"Intelligence\",
\"Agents\"
]"
echo "}"

echo "}"
echo "}"
