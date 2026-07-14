/**
 * =============================================================================
 * KLYN AI OS — Bash Pipeline Generator
 * File: kernel/src/execution/bash_pipeline_generator.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Generates optimized Bash pipelines from task templates. This is the
 *   code generation engine behind the local compiler.
 *
 * OPTIMIZATION STRATEGIES:
 *   - Use Termux-native tools (grep, sed, awk, find)
 *   - Minimize subprocess spawns (pipe chains instead of temp files)
 *   - Leverage /proc filesystem for system introspection
 *   - Battery-aware execution (avoid heavy loops on low battery)
 *
 * =============================================================================
 */

'use strict';

const { createLogger } = require('../observability/logger');

const log = createLogger('BashPipelineGenerator');

class BashPipelineGenerator {

  /**
   * Generates a Bash script from a template and parameters.
   *
   * @param {object} options
   * @param {object}  options.template    Task template from registry
   * @param {object}  options.parameters  Extracted/provided parameters
   * @param {string}  options.taskType    Task type identifier
   * @returns {string}  Executable Bash script
   */
  generate(options) {
    const { template, parameters, taskType } = options;

    log.debug('Generating Bash pipeline.', { taskType });

    // Validate required parameters
    this._validateParameters(parameters, template.parameters);

    // Build the script from template
    let script = this._buildHeader(taskType);
    script += this._interpolateTemplate(template.scriptTemplate, parameters);
    script += this._buildFooter();

    return script;
  }

  /**
   * Validates that all required parameters are present.
   * @param {object} params
   * @param {object} schema
   */
  _validateParameters(params, schema) {
    for (const [key, def] of Object.entries(schema)) {
      if (def.required && !(key in params)) {
        throw new Error(
          `Missing required parameter "${key}" for script generation.`
        );
      }
    }
  }

  /**
   * Builds the script header (shebang, error handling, variables).
   * @param {string} taskType
   * @returns {string}
   */
  _buildHeader(taskType) {
    return `#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# KLYN AI OS — Auto-Generated Script
# Task Type: ${taskType}
# Generated: ${new Date().toISOString()}
# =============================================================================

set -euo pipefail  # Exit on error, undefined vars, pipe failures
IFS=$'\\n\\t'      # Safe internal field separator

# Termux-specific paths
export PATH="/data/data/com.termux/files/usr/bin:$PATH"
export TMPDIR="/data/data/com.termux/files/usr/tmp"

# Logging function
log() {
  echo "[$(date -Iseconds)] [KLYN-SCRIPT] $*" >&2
}

log "Script execution started."

`;
  }

  /**
   * Interpolates template variables with actual parameter values.
   * @param {string} template  Template string with {{variable}} placeholders
   * @param {object} params    Parameter key-value pairs
   * @returns {string}
   */
  _interpolateTemplate(template, params) {
    let result = template;

    for (const [key, value] of Object.entries(params)) {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      const safeValue   = this._escapeShellValue(value);
      result = result.replace(placeholder, safeValue);
    }

    return result;
  }

  /**
   * Builds the script footer (cleanup, exit status).
   * @returns {string}
   */
  _buildFooter() {
    return `
log "Script execution completed successfully."
exit 0
`;
  }

  /**
   * Escapes a value for safe interpolation into Bash.
   * @param {*} value
   * @returns {string}
   */
  _escapeShellValue(value) {
    if (typeof value !== 'string') {
      value = String(value);
    }
    // Escape single quotes for single-quoted strings
    return value.replace(/'/g, "'\\''");
  }
}

module.exports = Object.freeze({
  BashPipelineGenerator,
});
