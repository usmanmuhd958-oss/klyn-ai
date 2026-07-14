/**
 * =============================================================================
 * KLYN AI OS — Local Task Compiler
 * File: kernel/src/execution/local_compiler.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Translates high-level agent tasks into optimized, offline Bash pipelines
 *   when LLM APIs are unavailable or too slow. This is the "intelligence
 *   without the cloud" fallback that makes KLYN truly autonomous.
 *
 * COMPILATION STRATEGY:
 *   1. Parse task intent from natural language prompt
 *   2. Match against offline task registry (pre-compiled templates)
 *   3. Generate Bash pipeline using parameterized micro-scripts
 *   4. Optimize for Termux environment (minimal dependencies)
 *   5. Return executable script string
 *
 * SUPPORTED TASK TYPES:
 *   - FILE_ANALYSIS: Static analysis, vulnerability scanning
 *   - CODE_GENERATION: Template-based code scaffolding
 *   - REFACTORING: Pattern-based code transformations
 *   - TESTING: Test harness generation
 *   - DOCUMENTATION: Auto-generate docs from code
 *
 * =============================================================================
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { createLogger } = require('../observability/logger');
const { getOfflineTaskRegistry } = require('./offline_task_registry');
const { BashPipelineGenerator } = require('./bash_pipeline_generator');

const log      = createLogger('LocalCompiler');
const registry = getOfflineTaskRegistry();

// =============================================================================
// SECTION 1: COMPILER CLASS
// =============================================================================

class LocalCompiler {

  constructor() {
    this._generator = new BashPipelineGenerator();

    log.info('Local Compiler initialized.', {
      registeredTasks: registry.getTaskTypes(),
    });
  }

  /**
   * Compiles a high-level task into an executable Bash script.
   *
   * @param {object} options
   * @param {string}  options.taskType  The task type identifier
   * @param {string}  options.prompt    Original natural language prompt
   * @param {object}  [options.params]  Extracted parameters
   * @param {string}  [options.correlId]
   * @returns {Promise<string>}  Executable Bash script
   */
  async compile(options) {
    const { taskType, prompt, params = {}, correlId } = options;

    log.info('Compiling task to local Bash.', { taskType, correlId });

    // Step 1: Get task template from registry
    const template = registry.getTemplate(taskType);
    if (!template) {
      throw new Error(
        `No offline template available for task type "${taskType}". ` +
        `Local compilation not possible.`
      );
    }

    // Step 2: Extract parameters from prompt
    const extractedParams = this._extractParameters(prompt, template.parameters);
    const mergedParams    = { ...extractedParams, ...params };

    log.debug('Parameters extracted.', { taskType, params: mergedParams, correlId });

    // Step 3: Generate Bash pipeline
    const script = this._generator.generate({
      template:   template,
      parameters: mergedParams,
      taskType,
    });

    log.info('Bash script compiled.', {
      taskType,
      scriptLength: script.length,
      correlId,
    });

    return script;
  }

  /**
   * Extracts parameters from a natural language prompt using regex patterns.
   * @param {string} prompt
   * @param {object} parameterSchema  Expected parameters from template
   * @returns {object}  Extracted key-value pairs
   */
  _extractParameters(prompt, parameterSchema) {
    const extracted = {};

    for (const [key, schema] of Object.entries(parameterSchema)) {
      const pattern = schema.extractionPattern;
      if (!pattern) continue;

      const regex  = new RegExp(pattern, 'i');
      const match  = prompt.match(regex);

      if (match && match[1]) {
        extracted[key] = match[1].trim();
      } else if (schema.default !== undefined) {
        extracted[key] = schema.default;
      }
    }

    return extracted;
  }
}

// =============================================================================
// SECTION 2: SINGLETON EXPORT
// =============================================================================

let _compilerInstance = null;

function getLocalCompiler() {
  if (!_compilerInstance) {
    _compilerInstance = new LocalCompiler();
  }
  return _compilerInstance;
}

module.exports = Object.freeze({
  getLocalCompiler,
  LocalCompiler,
});
