// packages/ui/src/intent/PromptComposer.tsx

'use client'

import { useState, useCallback } from 'react'
import { useIntentEngine } from '@klyn/intent-engine/react'
import { VoiceCommandInterface } from './VoiceCommandInterface'
import { SketchPad } from './SketchPad'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@klyn/ui/primitives'

type InputMode = 'text' | 'voice' | 'sketch' | 'requirements'

export function PromptComposer() {
  const [mode, setMode] = useState<InputMode>('text')
  const [composedIntent, setComposedIntent] = useState('')
  const { submitIntent, isProcessing } = useIntentEngine()

  const handleSubmit = useCallback(async () => {
    if (!composedIntent.trim()) return
    await submitIntent({
      raw: composedIntent,
      inputMode: mode,
      timestamp: Date.now(),
    })
  }, [composedIntent, mode, submitIntent])

  return (
    <div className="klyn-composer rounded-2xl border border-klyn-border bg-klyn-surface/80 backdrop-blur-xl p-6 shadow-2xl">
      {/* Mode switcher */}
      <div className="flex gap-2 mb-4">
        {(['text', 'voice', 'sketch', 'requirements'] as InputMode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`
              px-3 py-1 rounded-lg text-sm font-medium transition-all
              ${mode === m 
                ? 'bg-klyn-accent text-white' 
                : 'text-klyn-muted hover:text-klyn-primary'
              }
            `}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Input area */}
      {mode === 'text' && (
        <textarea
          value={composedIntent}
          onChange={e => setComposedIntent(e.target.value)}
          placeholder="Describe what you want to build..."
          className="w-full min-h-[120px] bg-transparent text-klyn-primary text-lg 
                     placeholder:text-klyn-muted/50 resize-none outline-none"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
        />
      )}

      {mode === 'voice' && (
        <VoiceCommandInterface onTranscript={setComposedIntent} />
      )}

      {mode === 'sketch' && (
        <SketchPad onSketchComplete={(sketch) => {
          setComposedIntent(sketch.description)
        }} />
      )}

      {mode === 'requirements' && (
        <RequirementMapComposer onRequirementsChange={setComposedIntent} />
      )}

      {/* Submit */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-klyn-border">
        <span className="text-xs text-klyn-muted">
          {composedIntent.length > 0 ? 'AI is ready to understand your intent' : 'Start describing your goal'}
        </span>
        <button
          onClick={handleSubmit}
          disabled={isProcessing || !composedIntent.trim()}
          className="klyn-btn-primary px-6 py-2 rounded-xl"
        >
          {isProcessing ? 'Understanding...' : 'Build This →'}
        </button>
      </div>
    </div>
  )
}