#!/usr/bin/env bash

set -Eeuo pipefail

KLYN_ROOT="${HOME}/klyn"
VERSION="v256"

ROOT="$KLYN_ROOT/genesis/$VERSION"

echo "[GENESIS V256] Autonomous Enterprise Knowledge Graph & RAG Civilization"


DIRS=(
"knowledge-core"
"rag-engine"
"embedding-system"
"vector-memory"
"semantic-search"
"knowledge-graph"
"document-intelligence"
"code-intelligence"
)


for DIR in "${DIRS[@]}"
do
    mkdir -p "$ROOT/$DIR"
done


FILES=(

"$ROOT/knowledge-core/KnowledgeController.ts"
"$ROOT/knowledge-core/KnowledgeRegistry.ts"
"$ROOT/knowledge-core/KnowledgeLifecycle.ts"


"$ROOT/rag-engine/RAGPipeline.ts"
"$ROOT/rag-engine/RetrievalEngine.ts"
"$ROOT/rag-engine/ContextBuilder.ts"


"$ROOT/embedding-system/EmbeddingEngine.ts"
"$ROOT/embedding-system/EmbeddingWorker.ts"
"$ROOT/embedding-system/EmbeddingRegistry.ts"


"$ROOT/vector-memory/VectorStore.ts"
"$ROOT/vector-memory/MemoryRetriever.ts"
"$ROOT/vector-memory/MemoryOptimizer.ts"


"$ROOT/semantic-search/SemanticSearch.ts"
"$ROOT/semantic-search/QueryUnderstanding.ts"
"$ROOT/semantic-search/SearchRanking.ts"


"$ROOT/knowledge-graph/KnowledgeGraph.ts"
"$ROOT/knowledge-graph/EntityResolver.ts"
"$ROOT/knowledge-graph/RelationshipEngine.ts"


"$ROOT/document-intelligence/DocumentAnalyzer.ts"
"$ROOT/document-intelligence/DocumentParser.ts"
"$ROOT/document-intelligence/DocumentIndexer.ts"


"$ROOT/code-intelligence/CodeAnalyzer.ts"
"$ROOT/code-intelligence/RepositoryUnderstanding.ts"
"$ROOT/code-intelligence/CodeKnowledgeGraph.ts"

)


for FILE in "${FILES[@]}"
do
    touch "$FILE"
done


chmod -R u+rwX "$ROOT"


echo "
====================================
 Genesis V256 READY

 Autonomous Enterprise Knowledge Graph & RAG Civilization

 Location:
 $ROOT
====================================
"

