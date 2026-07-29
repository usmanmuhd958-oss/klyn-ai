// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * KLYN AI OS - Reviewer Agent
 * Powered by Gemini 3.5 Pro for long-context validation
 */

// @ts-ignore
import { BaseAgent } from './base_agent.ts';
import type { Task, TaskResult, AgentCapability, Issue } from './types.ts';
import type { CognitiveRouter } from '../1.brain/cognitive_router.ts';
import type { GraphMemory } from '../1.brain/graph_memory.ts';

export class ReviewerAgent extends BaseAgent {
  [key: string]: any;
  constructor(router: CognitiveRouter, memory: GraphMemory) {
    const capability: AgentCapability = {
      role: 'reviewer',
      name: 'Code Reviewer',
      description: 'Validates logic, tests, and cross-file correctness',
      preferredModel: 'gemini-3.5-pro',
      taskTypes: ['code_review'],
      maxConcurrentTasks: 3,
    };

    super(capability, router, memory);
  }

  async executeTask(task: Task): Promise<TaskResult> {
    console.log(`[Reviewer] 👁️  Processing: ${task.description}`);

    const issues: Issue[] = [];

    // Code quality review
    const qualityIssues = await this.reviewCodeQuality(task);
    issues.push(...qualityIssues);

    // Logic correctness review
    const logicIssues = await this.reviewLogic(task);
    issues.push(...logicIssues);

    // Test coverage review
    if (task.context.files?.some(f => f.path.includes('.test.'))) {
      const testIssues = await this.reviewTests(task);
      issues.push(...testIssues);
    }

    // Generate review report
    const report = this.generateReviewReport(issues, task);

    return {
      success: !issues.some(i => i.severity === 'error' || i.severity === 'critical'),
      output: report,
      issues,
      artifacts: [
        {
          type: 'report',
          name: 'code_review.md',
          content: report,
        },
      ],
      metadata: { issueCount: issues.length },
    };
  }

  private async reviewCodeQuality(task: Task): Promise<Issue[]> {
    const files = task.context.files || [];
    if (files.length === 0) return [];

    const fullCode = files.map(f => 
      `// File: ${f.path}\n${f.content}`
    ).join('\n\n' + '='.repeat(80) + '\n\n');

    const prompt = `
Review this codebase for quality and best practices.

${fullCode.slice(0, 50000)} // Utilize Gemini's large context

Evaluate:
1. **Code organization** - Is it well-structured?
2. **Naming conventions** - Clear and consistent?
3. **Type safety** - Proper TypeScript usage?
4. **Error handling** - Comprehensive?
5. **Documentation** - Adequate comments?
6. **Performance** - Any obvious bottlenecks?
7. **Maintainability** - Easy to understand and modify?
8. **Best practices** - Following language idioms?

For each issue, provide:
- severity (info/warning/error)
- type (e.g., "naming", "error_handling")
- message
- file and line (if applicable)
- suggestion

Format as JSON array.
    `.trim();

    const response = await this.query(prompt, 'code_inspection');

    return this.parseIssuesFromResponse(response);
  }

  private async reviewLogic(task: Task): Promise<Issue[]> {
    const files = task.context.files || [];
    if (files.length === 0) return [];

    const codeContext = files.map(f => 
      `File: ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``
    ).join('\n\n');

    const prompt = `
Analyze this code for logical correctness and potential bugs.

${codeContext.slice(0, 100000)}

Check for:
1. **Logic errors** - Incorrect algorithms or conditions
2. **Edge cases** - Unhandled scenarios
3. **Race conditions** - Concurrency issues
4. **Off-by-one errors**
5. **Null/undefined handling**
6. **Type coercion issues**
7. **Async/await correctness**
8. **Resource leaks** - Unclosed connections, timers

Provide detailed analysis with specific line references.
Format findings as JSON array.
    `.trim();

    const response = await this.query(prompt, 'code_inspection');

    return this.parseIssuesFromResponse(response);
  }

  private async reviewTests(task: Task): Promise<Issue[]> {
    const testFiles = task.context.files?.filter(f => 
      f.path.includes('.test.') || f.path.includes('.spec.')
    ) || [];

    if (testFiles.length === 0) return [];

    const sourceFiles = task.context.files?.filter(f => 
      !f.path.includes('.test.') && !f.path.includes('.spec.')
    ) || [];

    const testCode = testFiles.map(f => f.content).join('\n\n');
    const sourceCode = sourceFiles.map(f => f.content).join('\n\n');

    const prompt = `
Review test coverage and quality.

Source Code:
${sourceCode.slice(0, 20000)}

Test Code:
${testCode}

Evaluate:
1. **Coverage** - Are all functions tested?
2. **Edge cases** - Are boundary conditions tested?
3. **Error cases** - Are failures tested?
4. **Test quality** - Clear, independent, repeatable?
5. **Assertions** - Sufficient and meaningful?
6. **Setup/teardown** - Proper cleanup?

Identify:
- Missing test cases
- Weak assertions
- Unclear test names
- Flaky tests

Format as JSON array of issues.
    `.trim();

    const response = await this.query(prompt, 'test_generation');

    return this.parseIssuesFromResponse(response);
  }

  private parseIssuesFromResponse(response: string): Issue[] {
    try {
      const jsonMatch = response.match(/```json\n([\s\S]+?)\n```/) ||
                       response.match(/\[[\s\S]+\]/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const issuesData = JSON.parse(jsonStr);
        
        return issuesData.map((issue: any): Issue => ({
          severity: issue.severity || 'info',
          type: issue.type || 'review',
          message: issue.message || '',
          location: issue.file ? {
            file: issue.file,
            line: issue.line || 0,
            column: 0,
          } : undefined,
          suggestion: issue.suggestion || issue.fix,
        }));
      }
    } catch (error) {
      console.warn('[Reviewer] Failed to parse issues:', error);
    }

    return [];
  }

  private generateReviewReport(issues: Issue[], task: Task): string {
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const info = issues.filter(i => i.severity === 'info');

    let report = `# Code Review Report\n\n`;
    report += `**Project**: ${task.context.projectName || 'Unknown'}\n`;
    report += `**Reviewed**: ${new Date().toISOString()}\n`;
    report += `**Files**: ${task.context.files?.length || 0}\n\n`;

    report += `## Summary\n\n`;
    report += `- ❌ Errors: ${errors.length}\n`;
    report += `- ⚠️  Warnings: ${warnings.length}\n`;
    report += `- ℹ️  Info: ${info.length}\n\n`;

    if (errors.length === 0 && warnings.length === 0) {
      report += `✅ **Code looks good!** No critical issues found.\n\n`;
    }

    if (errors.length > 0) {
      report += `## ❌ Errors (Must Fix)\n\n`;
      errors.forEach((issue, i) => {
        report += `### ${i + 1}. ${issue.type}\n`;
        report += `${issue.message}\n`;
        if (issue.location) {
          report += `**Location**: ${issue.location.file}:${issue.location.line}\n`;
        }
        if (issue.suggestion) {
          report += `**Suggestion**: ${issue.suggestion}\n`;
        }
        report += `\n`;
      });
    }

    if (warnings.length > 0) {
      report += `## ⚠️ Warnings (Should Fix)\n\n`;
      warnings.forEach((issue, i) => {
        report += `${i + 1}. **${issue.type}**: ${issue.message}\n`;
        if (issue.suggestion) {
          report += `   - ${issue.suggestion}\n`;
        }
      });
      report += `\n`;
    }

    if (info.length > 0) {
      report += `## ℹ️ Suggestions\n\n`;
      info.slice(0, 5).forEach((issue, i) => {
        report += `- ${issue.message}\n`;
      });
    }

    return report;
  }

  protected getDefaultSystemPrompt(): string {
    return `You are a senior code reviewer with expertise in software quality assurance. You specialize in:
- Code quality and best practices
- Logic correctness and bug detection
- Test coverage and quality
- Performance optimization
- Maintainability assessment

You provide constructive, actionable feedback that helps developers improve code quality.`;
  }
}
