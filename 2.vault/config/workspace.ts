// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const WORKSPACE_DIR = process.env.WORKSPACE || path.join(__dirname, '..', 'workspace');

function ensureWorkspace() {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    logger.info(`Workspace directory created: ${WORKSPACE_DIR}`);
  }
}

module.exports = { WORKSPACE_DIR, ensureWorkspace };


export {};
