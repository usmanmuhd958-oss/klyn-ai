const fs = require('fs');
const file = 'apps/backend/src/app.ts';

try {
  let code = fs.readFileSync(file, 'utf8');
  
  // Clean up duplicate or messy express imports
  const lines = code.split('\n').filter(line => !line.includes('from "express"') && !line.includes("from 'express'"));
  const cleanCode = 'import express, { type Express } from "express";\n' + lines.join('\n').trimStart();
  
  // Enforce explicit return type
  const finalCode = cleanCode.replace(/export\s+function\s+createApp\s*\(\s*\)\s*(?::\s*\w+)?/g, 'export function createApp(): Express');
  
  fs.writeFileSync(file, finalCode);
  console.log("APP_TS_REMEDIATION=SUCCESS");
} catch (err) {
  console.error("APP_TS_REMEDIATION=FAILED", err);
  process.exit(1);
}
