#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

class KLYNOrchestrator {
  constructor(goal) {
    this.goal = goal;
    this.projectRoot = path.resolve(__dirname, '../../..');
    this.logDir = path.join(this.projectRoot, 'kernel/logs');
    this.logPath = path.join(this.logDir, 'orchestrator.log');
    this.agentsDir = path.join(this.projectRoot, 'agents/src');
    this.results = [];
    this.startTime = Date.now();

    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}\n`;
    process.stdout.write(logEntry);
    fs.appendFileSync(this.logPath, logEntry);
  }

  generatePlan(goal) {
    this.log(`Generating execution plan for goal: "${goal}"`);
    
    const plan = [
      {
        agentName: 'coder',
        task: 'create kernel/src/core/klyn-bootstrap.js: console.log("KLYN AI OS initialized");',
        description: 'Bootstrap core initialization file'
      },
      {
        agentName: 'proactive_bug_hunter',
        task: 'check_security',
        description: 'Scan codebase for security issues'
      },
      {
        agentName: 'debugger',
        task: `analyze_log ${this.logPath}`,
        description: 'Analyze orchestrator logs for anomalies'
      }
    ];

    this.log(`Plan generated with ${plan.length} sequential tasks`);
    return plan;
  }

  executeAgentTask(agentName, task, attempt = 1) {
    const maxAttempts = 3;
    const agentScript = path.join(this.agentsDir, `${agentName}.sh`);

    if (!fs.existsSync(agentScript)) {
      this.log(`Agent script not found: ${agentScript}`, 'ERROR');
      return {
        agentName,
        task,
        status: 'FAILED',
        output: 'Agent script does not exist',
        attempt
      };
    }

    try {
      this.log(`[Attempt ${attempt}/${maxAttempts}] Executing ${agentName} with task: "${task}"`);

      const startExec = Date.now();
      const output = execSync(
        `bash "${agentScript}" "${task}"`,
        {
          encoding: 'utf8',
          stdio: 'pipe',
          maxBuffer: 1024 * 1024 * 10,
          cwd: this.projectRoot,
          env: {
            ...process.env,
            KLYN_PROJECT_ROOT: this.projectRoot,
            KLYN_LOG_PATH: this.logPath
          }
        }
      );

      const execTime = Date.now() - startExec;
      this.log(`${agentName} completed successfully in ${execTime}ms`);

      return {
        agentName,
        task,
        status: 'SUCCESS',
        output: output.trim(),
        attempt,
        executionTime: execTime
      };
    } catch (error) {
      const errorOutput = error.stdout ? error.stdout.toString('utf8') : '';
      const errorMsg = error.message || 'Unknown error';

      this.log(
        `${agentName} failed on attempt ${attempt}: ${errorMsg}`,
        'WARN'
      );

      if (attempt < maxAttempts) {
        this.log(`Attempting self-healing: modifying ${agentName}.sh and retrying...`, 'WARN');
        this.attemptSelfHealing(agentName, error);

        // Recursive retry
        return this.executeAgentTask(agentName, task, attempt + 1);
      } else {
        this.log(
          `${agentName} failed after ${maxAttempts} attempts. Aborting.`,
          'ERROR'
        );

        return {
          agentName,
          task,
          status: 'FAILED',
          output: errorOutput || errorMsg,
          attempt,
          executionTime: 0
        };
      }
    }
  }

  attemptSelfHealing(agentName, error) {
    const agentScript = path.join(this.agentsDir, `${agentName}.sh`);

    try {
      let scriptContent = fs.readFileSync(agentScript, 'utf8');

      // Basic self-healing: add error handling wrapper if missing
      if (!scriptContent.includes('set -e')) {
        scriptContent = '#!/bin/bash\nset -e\n\n' + scriptContent;
        fs.writeFileSync(agentScript, scriptContent);
        this.log(`Added error handling to ${agentName}.sh`, 'INFO');
      }

      // Add defensive quoting around variables if not present
      if (!scriptContent.includes('set -u')) {
        scriptContent = scriptContent.replace('set -e', 'set -e\nset -u');
        fs.writeFileSync(agentScript, scriptContent);
        this.log(`Added undefined variable protection to ${agentName}.sh`, 'INFO');
      }
    } catch (healError) {
      this.log(
        `Self-healing attempt failed: ${healError.message}`,
        'WARN'
      );
    }
  }

  printResultsTable(results) {
    console.log('\n' + '='.repeat(80));
    console.log('KLYN AI OS EXECUTION SUMMARY');
    console.log('='.repeat(80));

    const tableData = results.map(r => ({
      Agent: r.agentName,
      Status: r.status === 'SUCCESS' ? '✓ SUCCESS' : '✗ FAILED',
      Task: r.task.substring(0, 40) + (r.task.length > 40 ? '...' : ''),
      Attempts: r.attempt,
      'Time (ms)': r.executionTime || '-'
    }));

    console.table(tableData);

    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    const totalTime = Date.now() - this.startTime;

    console.log('='.repeat(80));
    console.log(`Total Tasks: ${results.length} | Successful: ${successCount} | Failed: ${results.length - successCount}`);
    console.log(`Total Execution Time: ${totalTime}ms`);
    console.log(`Log File: ${this.logPath}`);
    console.log('='.repeat(80) + '\n');
  }

  async run() {
    try {
      this.log('KLYN AI OS Orchestrator Starting', 'INFO');
      this.log(`Goal: ${this.goal}`, 'INFO');
      this.log(`Project Root: ${this.projectRoot}`, 'INFO');

      const plan = this.generatePlan(this.goal);

      for (const taskDef of plan) {
        const result = this.executeAgentTask(taskDef.agentName, taskDef.task);
        this.results.push(result);
        this.log(`Task "${taskDef.description}" completed with status: ${result.status}`, 'INFO');
      }

      this.printResultsTable(this.results);

      const allSuccessful = this.results.every(r => r.status === 'SUCCESS');
      process.exit(allSuccessful ? 0 : 1);
    } catch (error) {
      this.log(`Orchestrator fatal error: ${error.message}`, 'ERROR');
      this.log(error.stack, 'ERROR');
      process.exit(1);
    }
  }
}

// Entry point
const goal = process.argv[2] || 'Initialize KLYN AI OS';
const orchestrator = new KLYNOrchestrator(goal);
orchestrator.run();

