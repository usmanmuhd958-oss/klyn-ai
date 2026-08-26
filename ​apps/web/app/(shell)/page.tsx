// apps/web/app/(shell)/page.tsx — Intent Space UI

'use client'

import { IntentPanel } from '@klyn/ui/intent'
import { useIntentStore } from '@klyn/store'
import { motion, AnimatePresence } from 'framer-motion'

export default function IntentSpacePage() {
  const { currentIntent, resolutionState } = useIntentStore()
  
  return (
    <div className="relative h-full w-full bg-klyn-void flex flex-col">
      {/* Ambient background that reacts to intent processing */}
      <IntentAmbientBackground state={resolutionState} />
      
      {/* Main intent composition area */}
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          className="w-full max-w-4xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <PromptComposer />
        </motion.div>
      </div>
      
      {/* Intent resolution appearing below */}
      <AnimatePresence>
        {currentIntent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-klyn-border"
          >
            <IntentResolutionView intent={currentIntent} />
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Intent timeline (left sidebar) */}
      <IntentTimeline />
    </div>
  )
}