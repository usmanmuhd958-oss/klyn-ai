// ADD TO EXISTING protocol.js MSG enum:

const MSG = Object.freeze({
  // ... existing types ...
  
  // Evolution Engine messages
  EVOLUTION_PROPOSE:  'EVOLUTION_PROPOSE',   // Agent → Kernel: propose code patch
  EVOLUTION_RESULT:   'EVOLUTION_RESULT',    // Kernel → Agent: result of proposal
  EVOLUTION_ROLLBACK: 'EVOLUTION_ROLLBACK',  // Agent → Kernel: request rollback
  EVOLUTION_STATUS:   'EVOLUTION_STATUS',    // Agent → Kernel: query evolution status
});

// ADD TO EXISTING PAYLOAD_SCHEMAS:

[MSG.EVOLUTION_PROPOSE]: [
  'targetFile',
  'patchContent',
  'reason',
  'requesterId',
],
[MSG.EVOLUTION_RESULT]: [
  'success',
],
[MSG.EVOLUTION_ROLLBACK]: [
  'evolutionId',
],
