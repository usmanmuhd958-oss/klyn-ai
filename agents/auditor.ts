/**
 * KLYN AI OS - Security Auditor Agent
 * Powered by DeepSeek V4 Pro for cost-effective security scanning
 */

import { BaseAgent } from './base_agent.ts';
import type { Task, TaskResult, AgentCapability, Issue } from './types.ts';
import type { CognitiveRouter } from '../1.brain/cognitive_router.ts';
import type { GraphMemory } from '../1.brain/graph_memory.ts';

export class AuditorAgent extends BaseAgent {
  private securityPatterns: RegExp[];

  constructor(router: CognitiveRouter, memory: GraphMemory) {
    const capability: AgentCapability = {
      role: 'auditor',
      name: 'Security Auditor',
      description: 'Scans for vulnerabilities, secrets, and security issues',
      preferredModel: 'deepseek-v4-pro',
      taskTypes: ['security_audit'],
      maxConcurrentTasks: 10,
    };

    super(capability, router, memory);

    // Common secret patterns
    this.securityPatterns = [
      /(?:api[_-]?key|apikey)[\s]*[=:]['"]([a-zA-Z0-9_\-]+)['"]/gi,
      /(?:secret|password|passwd|pwd)[\s]*[=:]['"]([^'"]+)['"]/gi,
      /(?:token|auth)[\s]*[=:]['"]([a-zA-Z0-9._\-]+)['"]/gi,
      /sk-[a-zA-Z0-9]{32,}/g, // OpenAI-style keys
      /AIzaSy[a-zA-Z0-9_\-]{33}/g, // Google API keys
    ];
  }

  async executeTask(task: Task): Promise<TaskResult> {
    console.log(`[Auditor] 🔒 Processing: ${task.description}`);

    const issues: Issue[] = [];

    // Quick regex-based scan
    const quickIssues = await this.quickSecurityScan(task);
    issues.push(...quickIssues);

    // Deep LLM-based analysis
    const deepIssues = await this.deepSecurityAnalysis(task);
    issues.push(...deepIssues);

    // Generate security report
    const report = this.generateSecurityReport(issues);

    // Store audit results
    this.storeKnowledge('task', `audit_${task.id}`, report, {
      taskId: task.id,
      issueCount: issues.length,
      criticalCount: issues.filter(i => i.severity === 'critical').length,
    });

    const severity = this.getHighestSeverity(issues);

    return {
      success: severity !== 'critical',
      output: report,
      issues,
      artifacts: [
        {
          type: 'report',
          name: 'security_audit.md',
          content: report,
        },
      ],
      metadata: { 
        issueCount: issues.length,
        criticalCount: issues.filter(i => i.severity === 'critical').length,
      },
    };
  }

  private async quickSecurityScan(task: Task): Promise<Issue[]> {
    const issues: Issue[] = [];
    const files = task.context.files || [];

    for (const file of files) {
      // Check for hardcoded secrets
      for (const pattern of this.securityPatterns) {
        const matches = file.content.matchAll(pattern);
        for (const match of matches) {
          issues.push({
            severity: 'critical',
            type: 'hardcoded_secret',
            message: `Potential hardcoded secret found: ${match[0].slice(0, 20)}...`,
            location: {
              file: file.path,
              line: this.getLineNumber(file.content, match.index || 0),
              column: 0,
            },
            suggestion: 'Use environment variables or a secure vault',
          });
        }
      }

      // Check for unsafe functions
      const unsafeFunctions = [
        'eval', 'Function(', 'exec(', 'child_process.exec',
        'dangerouslySetInnerHTML', 'innerHTML ='
      ];

      for (const unsafeFunc of unsafeFunctions) {
        if (file.content.includes(unsafeFunc)) {
          const index = file.content.indexOf(unsafeFunc);
          issues.push({
            severity: 'warning',
            type: 'unsafe_function',
            message: `Potentially unsafe function: ${unsafeFunc}`,
            location: {
              file: file.path,
              line: this.getLineNumber(file.content, index),
              column: 0,
            },
            suggestion: 'Review for security implications',
          });
        }
      }

      // Check for Termux sandbox violations
      const restrictedPaths = ['/system', '/data/data', '/proc'];
      for (const path of restrictedPaths) {
        if (file.content.includes(`'${path}`) || file.content.includes(`"${path}`)) {
          issues.push({
            severity: 'error',
            type: 'sandbox_violation',
            message: `Attempting to access restricted path: ${path}`,
            location: { file: file.path, line: 0, column: 0 },
            suggestion: 'Stay within Termux home directory',
          });
        }
      }
    }

    return issues;
  }

  private async deepSecurityAnalysis(task: Task): Promise<Issue[]> {
    const files = task.context.files || [];
    if (files.length === 0) return [];

    const codeSnippets = files.slice(0, 3).map(f => 
      `File: ${f.path}\n\`\`\`${f.language}\n${f.content.slice(0, 2000)}\n\`\`\``
    ).join('\n\n');

    const prompt = `
Perform a security audit on this code. Identify vulnerabilities and security issues.

${codeSnippets}

Check for:
1. **Injection vulnerabilities** (SQL, command, code)
2. **Authentication/authorization flaws**
3. **Sensitive data exposure**
4. **XML/XXE vulnerabilities**
5. **Broken access control**
6. **Security misconfiguration**
7. **Insecure dependencies**
8. **Insufficient logging/monitoring**
9. **Termux sandbox boundary violations**
10. **Race conditions**

For each issue found, provide:
- Severity: critical/error/warning/info
- Type: brief category
- Message: description
- Location: file and approximate line
- Suggestion: how to fix

Format as JSON array:
\`\`\`json
[
  {
    "severity": "critical",
    "type": "sql_injection",
    "message": "...",
    "file": "...",
    "line": 42,
    "suggestion": "..."
  }
]
\`\`\`
    `.trim();

    const response = await this.query(prompt, 'log_analysis');

    try {
      // Extract JSON from response
      const jsonMatch = response.match(/```json\n([\s\S]+?)\n```/);
      if (jsonMatch) {
        const issuesData = JSON.parse(jsonMatch[1]);
        return issuesData.map((issue: any): Issue => ({
          severity: issue.severity || 'warning',
          type: issue.type || 'unknown',
          message: issue.message || '',
          location: issue.file ? {
            file: issue.file,
            line: issue.line || 0,
            column: 0,
          } : undefined,
          suggestion: issue.suggestion,
        }));
      }
    } catch (error) {
      console.warn('[Auditor] Failed to parse LLM security analysis:', error);
    }

    return [];
  }

  private generateSecurityReport(issues: Issue[]): string {
    const critical = issues.filter(i => i.severity === 'critical');
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const info = issues.filter(i => i.severity === 'info');

    let report = `# Security Audit Report\n\n`;
    report += `**Generated**: ${new Date().toISOString()}\n\n`;
    report += `## Summary\n\n`;
    report += `- 🔴 Critical: ${critical.length}\n`;
    report += `- ⚠️  Errors: ${errors.length}\n`;
    report += `- ⚡ Warnings: ${warnings.length}\n`;
    report += `- ℹ️  Info: ${info.length}\n\n`;

    if (critical.length > 0) {
      report += `## 🔴 Critical Issues\n\n`;
      critical.forEach((issue, i) => {
        report += `### ${i + 1}. ${issue.type}\n`;
        report += `**Message**: ${issue.message}\n`;
        if (issue.location) {
          report += `**Location**: ${issue.location.file}:${issue.location.line}\n`;
        }
        if (issue.suggestion) {
          report += `**Fix**: ${issue.suggestion}\n`;
        }
        report += `\n`;
      });
    }

    if (errors.length > 0) {
      report += `## ⚠️ Errors\n\n`;
      errors.forEach((issue, i) => {
        report += `${i + 1}. **${issue.type}**: ${issue.message}\n`;
        if (issue.suggestion) report += `   - Fix: ${issue.suggestion}\n`;
      });
      report += `\n`;
    }

    if (warnings.length > 0) {
      report += `## ⚡ Warnings\n\n`;
      warnings.slice(0, 10).forEach((issue, i) => {
        report += `${i + 1}. ${issue.message}\n`;
      });
      if (warnings.length > 10) {
        report += `\n... and ${warnings.length - 10} more warnings\n`;
      }
      report += `\n`;
    }

    return report;
  }

  private getLineNumber(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }

  private getHighestSeverity(issues: Issue[]): Issue['severity'] {
    if (issues.some(i => i.severity === 'critical')) return 'critical';
    if (issues.some(i => i.severity === 'error')) return 'error';
    if (issues.some(i => i.severity === 'warning')) return 'warning';
    return 'info';
  }

  protected getDefaultSystemPrompt(): string {
    return `You are a security expert specializing in application security, penetration testing, and secure code review. You have deep knowledge of:
- OWASP Top 10
- Common vulnerability patterns
- Secure coding practices
- Mobile and edge computing security
- Termux/Android sandbox limitations

You perform thorough security audits and provide actionable remediation guidance.`;
  }
}
