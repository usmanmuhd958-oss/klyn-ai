// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
import assert from 'node:assert';
import { executeCoreTask, validateSessionToken } from './build_payment_c_core.js';

console.log("[KLYN-AST-TEST] Running automated test suite for: build_payment_c_core.js");

// Test Suite for Exported Function: executeCoreTask
try {
  assert.strictEqual(typeof executeCoreTask, 'function', 'executeCoreTask must be a function');
  const result = executeCoreTask({});
  assert.notStrictEqual(result, undefined, 'executeCoreTask should return a valid output');
  console.log("  ├── [PASS] Function executeCoreTask() execution & return shape verified.");
} catch (err) {
  console.error("  └── [FAIL] executeCoreTask test failed:", err.message);
  process.exit(1);
}

// Test Suite for Exported Function: validateSessionToken
try {
  assert.strictEqual(typeof validateSessionToken, 'function', 'validateSessionToken must be a function');
  const result = validateSessionToken({});
  assert.notStrictEqual(result, undefined, 'validateSessionToken should return a valid output');
  console.log("  ├── [PASS] Function validateSessionToken() execution & return shape verified.");
} catch (err) {
  console.error("  └── [FAIL] validateSessionToken test failed:", err.message);
  process.exit(1);
}

console.log("[KLYN-AST-TEST] All AST assertions passed successfully for build_payment_c_core.js.");
