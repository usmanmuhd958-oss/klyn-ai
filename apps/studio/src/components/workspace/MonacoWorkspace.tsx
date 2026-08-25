"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import Editor, {
  OnMount,
} from "@monaco-editor/react";

import type {
  editor as MonacoEditor,
  IDisposable,
  IStandaloneCodeEditor,
} from "monaco-editor";

import {
  X,
  FileCode2,
} from "lucide-react";

import {
  useStudioStore,
} from "@/store/useStudioStore";

export default function MonacoWorkspace() {
  const editorRef = useRef<IStandaloneCodeEditor | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const decorationRef = useRef<string[]>([]);
  const [mounted, setMounted] = useState(false);

  const {
    files,
    activeFileId,
    tabs,
    updateFile,
    setActiveFile,
  } = useStudioStore();

  const activeFile = files.find(
    file => file.id === activeFileId
  );

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      setMounted(true);

      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
        () => {
          window.dispatchEvent(
            new CustomEvent("klyn:open-command-palette", {
              detail: { source: "monaco" },
            })
          );
        }
      );

      decorationRef.current = editor.deltaDecorations([], []);

      const container = editor.getContainerDomNode();
      resizeObserverRef.current = new ResizeObserver(() => {
        editor.layout();
      });

      resizeObserverRef.current.observe(container);
    },
    []
  );

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      editorRef.current?.dispose();
    };
  }, []);

  const updateAIDecorations = useCallback(
    (decorations: MonacoEditor.IModelDeltaDecoration[]) => {
      const editor = editorRef.current;
      if (!editor) return;

      decorationRef.current = editor.deltaDecorations(
        decorationRef.current,
        decorations
      );
    },
    []
  );

  const handleChange = useCallback(
    (value?: string) => {
      if (!activeFile) return;

      updateFile(activeFile.id, value ?? "");
    },
    [activeFile, updateFile]
  );

  const closeTab = useCallback(
    (fileId: string) => {
      const store = useStudioStore.getState();
      const remainingTabs = store.tabs.filter(
        tab => tab.fileId !== fileId
      );

      useStudioStore.setState({
        tabs: remainingTabs,
      });

      if (activeFileId === fileId) {
        const next = remainingTabs[0];
        setActiveFile(next?.fileId ?? "");
      }
    },
    [activeFileId, setActiveFile]
  );

  if (!activeFile) {
    return (
      <div className="flex h-full items-center justify-center bg-[#09090b] text-zinc-500">
        <div className="flex flex-col items-center gap-3">
          <FileCode2 size={40} />
          <span>Open a file to start coding</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#09090b]">
      {/* Tabs */}
      <div className="flex h-10 items-center border-b border-[#27272a] bg-[#09090b] overflow-x-auto">
        {tabs.map(tab => {
          const file = files.find(item => item.id === tab.fileId);
          if (!file) return null;

          const active = file.id === activeFileId;

          return (
            <div
              key={file.id}
              className={`group flex h-full cursor-pointer items-center gap-2 border-r border-[#27272a] px-4 text-sm ${
                active ? "bg-[#18181b] text-white" : "text-zinc-400"
              }`}
              onClick={() => setActiveFile(file.id)}
            >
              <FileCode2 size={14} />
              <span>{file.name}</span>

              {file.modified && (
                <span className="h-2 w-2 rounded-full bg-orange-400" />
              )}

              <button
                onClick={event => {
                  event.stopPropagation();
                  closeTab(file.id);
                }}
                className="opacity-0 group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Monaco */}
      <div className="flex-1 min-h-0">
        <Editor
          theme="vs-dark"
          language={activeFile.language}
          value={activeFile.content}
          onMount={handleEditorMount}
          onChange={handleChange}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 14,
            padding: { top: 16 },
            smoothScrolling: true,
            scrollBeyondLastLine: false,
            renderWhitespace: "selection",
            suggestOnTriggerCharacters: true,
            inlineSuggest: { enabled: true },
          }}
        />
      </div>
    </div>
  );
}
