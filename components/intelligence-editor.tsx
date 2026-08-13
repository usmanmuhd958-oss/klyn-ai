'use client'

import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import CodeMirror from '@uiw/react-codemirror'
import { Check, FileCode2, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { CODE_FILES } from '@/lib/data'
import { useKlyn } from '@/lib/store'

export function IntelligenceEditor() {
  const editorFileId = useKlyn((s) => s.editorFileId)
  const openEditor = useKlyn((s) => s.openEditor)
  const accepted = useKlyn((s) => (editorFileId ? s.acceptedSuggestions[editorFileId] : false))
  const acceptSuggestion = useKlyn((s) => s.acceptSuggestion)
  const pushLog = useKlyn((s) => s.pushLog)

  const file = editorFileId ? CODE_FILES[editorFileId] : null

  const displayContent = useMemo(() => {
    if (!file) return ''
    if (file.suggestion && accepted) {
      return file.content.replace(file.suggestion.original, file.suggestion.replacement)
    }
    return file.content
  }, [file, accepted])

  const extensions = useMemo(
    () => [file?.language === 'sql' ? sql() : javascript({ typescript: true, jsx: true })],
    [file?.language],
  )

  const handleAccept = useCallback(() => {
    if (file) acceptSuggestion(file.id)
  }, [file, acceptSuggestion])

  useEffect(() => {
    if (!file) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        openEditor(null)
      } else if (e.key === 'Tab' && file.suggestion && !useKlyn.getState().acceptedSuggestions[file.id]) {
        e.preventDefault()
        handleAccept()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [file, handleAccept, openEditor])

  if (!file) return null

  const showSuggestion = file.suggestion && !accepted

  return (
    <aside
      className="glass fixed top-16 right-4 bottom-4 z-40 flex w-[min(480px,calc(100vw-2rem))] animate-fade-up flex-col rounded-lg shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      aria-label="Inline intelligence editor"
    >
      <header className="flex items-center gap-2.5 border-b border-border-glass px-4 py-3">
        <FileCode2 className="size-4 shrink-0 text-neural" aria-hidden="true" />
        <span className="flex-1 truncate font-mono text-xs text-foreground">{file.path}</span>
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="rounded-md p-1 text-muted transition-colors hover:bg-neural/10 hover:text-neural"
          aria-label="Close editor"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <CodeMirror
          value={displayContent}
          extensions={extensions}
          theme="dark"
          editable={false}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            searchKeymap: false,
          }}
        />
      </div>

      {showSuggestion ? (
        <div className="border-t border-neural/25 bg-neural/[0.04] p-4">
          <div className="flex items-start gap-2.5">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-neural" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-foreground/90">{file.suggestion!.description}</p>
              <div className="mt-3 overflow-x-auto rounded-md border border-border-glass bg-background/60 p-3">
                <pre className="font-mono text-[11px] leading-relaxed">
                  {file.suggestion!.original.split('\n').map((line, i) => (
                    <div key={`del-${i}`} className="text-critical/80">
                      <span className="mr-2 select-none">-</span>
                      {line}
                    </div>
                  ))}
                  {file.suggestion!.replacement.split('\n').map((line, i) => (
                    <div key={`add-${i}`} className="text-neural">
                      <span className="mr-2 select-none">+</span>
                      {line}
                    </div>
                  ))}
                </pre>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAccept}
                  className="flex items-center gap-1.5 rounded-md bg-neural px-3 py-1.5 font-mono text-[11px] font-medium text-background transition-opacity hover:opacity-85"
                >
                  <Check className="size-3" aria-hidden="true" />
                  Accept
                  <kbd className="rounded bg-background/20 px-1 text-[9px]">Tab</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    pushLog('info', 'editor', `Suggestion dismissed for ${file.path}`)
                    openEditor(null)
                  }}
                  className="rounded-md border border-border-glass px-3 py-1.5 font-mono text-[11px] text-muted transition-colors hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : accepted && file.suggestion ? (
        <div className="flex items-center gap-2 border-t border-border-glass px-4 py-2.5">
          <Check className="size-3.5 text-neural" aria-hidden="true" />
          <span className="font-mono text-[11px] text-neural-dim">Suggestion applied — change synced to canvas</span>
        </div>
      ) : null}
    </aside>
  )
}
