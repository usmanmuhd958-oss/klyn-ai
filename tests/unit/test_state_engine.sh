#!/bin/bash
cd "$(dirname "$0")/../.."
node -e "
const { setState, getState } = require('./kernel/src/services/state_engine.js');
(async () => {
  try {
    await setState('test_key', { hello: 'world' });
    const val = await getState('test_key');
    if (val && val.hello === 'world') {
      console.log('[PASS] State engine set/get works');
      process.exit(0);
    } else {
      console.log('[FAIL] State engine returned unexpected value');
      process.exit(1);
    }
  } catch(e) {
    console.log('[FAIL] State engine error:', e.message);
    process.exit(1);
  }
})();
" 2>/dev/null
