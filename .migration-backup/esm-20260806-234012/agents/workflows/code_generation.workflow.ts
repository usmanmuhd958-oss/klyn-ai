/**
 * KLYN AI OS - Code Generation Workflow
 */

import type { Workflow } from '../types.ts';

export const codeGenerationWorkflow: Workflow = {
  id: 'code_generation',
  name: 'Full-Stack Code Generation',
  description: 'End-to-end code generation with architecture, implementation, audit, and review',
  steps: [
    {
      id: 'requirements',
      agent: 'architect',
      task: 'analyze_requirements',
      description: 'Analyze requirements and create technical specification',
    },
    {
      id: 'architecture',
      agent: 'architect',
      task: 'design_architecture',
      description: 'Design system architecture and module interfaces',
      dependsOn: ['requirements'],
    },
    {
      id: 'implementation',
      agent: 'coder',
      task: 'generate_code',
      description: 'Generate production-grade implementation',
      dependsOn: ['architecture'],
    },
    {
      id: 'tests',
      agent: 'coder',
      task: 'write_tests',
      description: 'Write comprehensive unit tests',
      dependsOn: ['implementation'],
    },
    {
      id: 'security_audit',
      agent: 'auditor',
      task: 'security_audit',
      description: 'Security audit and vulnerability scan',
      dependsOn: ['implementation'],
    },
    {
      id: 'code_review',
      agent: 'reviewer',
      task: 'code_review',
      description: 'Review code quality and logic correctness',
      dependsOn: ['implementation', 'tests'],
    },
    {
      id: 'documentation',
      agent: 'coder',
      task: 'documentation',
      description: 'Generate comprehensive documentation',
      dependsOn: ['code_review'],
      optional: true,
    },
  ],
  metadata: {
    estimatedDuration: '5-10 minutes',
    complexity: 'high',
  },
};

export const refactoringWorkflow: Workflow = {
  id: 'refactoring',
  name: 'Code Refactoring Pipeline',
  description: 'Refactor existing code with review and validation',
  steps: [
    {
      id: 'initial_review',
      agent: 'reviewer',
      task: 'code_review',
      description: 'Review current code and identify issues',
    },
    {
      id: 'refactor',
      agent: 'coder',
      task: 'refactor',
      description: 'Refactor code based on review feedback',
      dependsOn: ['initial_review'],
    },
    {
      id: 'test_update',
      agent: 'coder',
      task: 'write_tests',
      description: 'Update tests for refactored code',
      dependsOn: ['refactor'],
    },
    {
      id: 'final_review',
      agent: 'reviewer',
      task: 'code_review',
      description: 'Validate refactored code',
      dependsOn: ['refactor', 'test_update'],
    },
    {
      id: 'security_check',
      agent: 'auditor',
      task: 'security_audit',
      description: 'Ensure refactoring didn\'t introduce vulnerabilities',
      dependsOn: ['refactor'],
    },
  ],
};
