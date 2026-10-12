'use client';

import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { useEngineStore } from '../../store/engineStore';

function buildManifest(nodeId: string): string {
  const { digitalTwin, agents, architectureMemory, decisionMemory } = useEngineStore.getState();

  if (nodeId.startsWith('agent-')) {
    const agent = agents.find((a) => `agent-${a.id}` === nodeId);
    return JSON.stringify(agent ?? { error: 'unknown agent' }, null, 2);
  }
  if (nodeId === 'memory-architecture') {
    return JSON.stringify(architectureMemory, null, 2);
  }
  if (nodeId === 'memory-decision') {
    return JSON.stringify(decisionMemory, null, 2);
  }
  const mod = digitalTwin.find((m) => m.id === nodeId);
  return JSON.stringify(mod ?? { error: 'unknown module' }, null, 2);
}

export function NodeInspector({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: buildManifest(nodeId),
        extensions: [
          basicSetup,
          javascript(),
          oneDark,
          EditorView.editable.of(false),
          EditorView.theme({ '&': { fontSize: '12px', height: '100%' } }),
        ],
      }),
    });

    return () => view.destroy();
  }, [nodeId]);

  return (
    <aside className="flex h-full w-80 flex-col border-l border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <p className="text-xs font-medium text-neutral-400">{nodeId}</p>
        <button onClick={onClose} className="text-xs text-neutral-600 hover:text-neutral-300">
          Close
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto" />
    </aside>
  );
}
