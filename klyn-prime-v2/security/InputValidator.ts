export interface ValidationResult {
  valid: boolean;
  sanitized: string;
  errors: string[];
}

export interface SecurityContext {
  principal: string;
  role: string;
  capabilities: string[];
  clearanceLevel: number;
}

export class InputValidator {
  private static readonly MAX_TASK_LENGTH = 65536;
  private static readonly ALLOWED_TASK_PATTERN = /^[\x20-\x7E\u00A0-\u00FF]*$/;
  private static readonly DANGEROUS_PATTERNS = [
    /(?:rm\s+(-rf?|--recursive)\s+(\/|\$HOME|\~))/i,
    /(?:curl\s+.*\|\s*(?:sh|bash|zsh|fish))/i,
    /(?:wget\s+.*\|\s*(?:sh|bash|zsh|fish))/i,
    /(?:eval\s+["']?\s*(?:\$|`|\$\())/i,
    /(?:exec\s+["']?\s*(?:\$|`|\$\())/i,
    /(?:sudo\s+.*(?:\||;|\&\&|\|\|))/i,
    /(?:chmod\s+.*\s+777)/i,
    /(?:chown\s+.*\s+root)/i,
    /(?:mkfs\s+|dd\s+.*\s+of=\/)/i,
    /(?:>\s*(?:\/dev\/(?:null|zero|random|urandom)))/i,
    /(?:\.\.\/)/g,
    /(?:\.\.\\\\/)/g,
  ];

  static validateTask(task: unknown): ValidationResult {
    const errors: string[] = [];

    if (typeof task !== 'string') {
      return {
        valid: false,
        sanitized: '',
        errors: ['Task must be a string'],
      };
    }

    if (task.length === 0) {
      return {
        valid: false,
        sanitized: '',
        errors: ['Task cannot be empty'],
      };
    }

    if (task.length > this.MAX_TASK_LENGTH) {
      return {
        valid: false,
        sanitized: '',
        errors: [`Task exceeds maximum length of ${this.MAX_TASK_LENGTH} characters`],
      };
    }

    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(task)) {
        errors.push(`Task contains prohibited pattern: ${pattern.source}`);
      }
    }

    const sanitized = this.sanitizeString(task);

    return {
      valid: errors.length === 0,
      sanitized,
      errors,
    };
  }

  static validatePath(path: string, allowedRoots: string[]): ValidationResult {
    const errors: string[] = [];

    if (!path || typeof path !== 'string') {
      return { valid: false, sanitized: '', errors: ['Path is required'] };
    }

    const resolved = this.resolvePath(path);
    const allowed = allowedRoots.some(root => {
      const resolvedRoot = this.resolvePath(root);
      return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + '/');
    });

    if (!allowed) {
      errors.push(`Path "${path}" resolves to "${resolved}" which is outside allowed roots: ${allowedRoots.join(', ')}`);
    }

    const sanitized = this.normalizePath(path);

    return {
      valid: errors.length === 0,
      sanitized,
      errors,
    };
  }

  static validateAgentId(agentId: string): ValidationResult {
    const errors: string[] = [];

    if (!agentId || typeof agentId !== 'string') {
      return { valid: false, sanitized: '', errors: ['Agent ID is required'] };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      errors.push('Agent ID must contain only alphanumeric characters, hyphens, and underscores');
    }

    if (agentId.length > 128) {
      errors.push('Agent ID must not exceed 128 characters');
    }

    const sanitized = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');

    return {
      valid: errors.length === 0,
      sanitized,
      errors,
    };
  }

  static validateRole(role: string, allowedRoles: string[]): ValidationResult {
    const errors: string[] = [];

    if (!role || typeof role !== 'string') {
      return { valid: false, sanitized: '', errors: ['Role is required'] };
    }

    if (!allowedRoles.includes(role)) {
      errors.push(`Role "${role}" is not in allowed roles: ${allowedRoles.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      sanitized: role,
      errors,
    };
  }

  static validateResourceLimit(value: number, min: number, max: number, name: string): ValidationResult {
    const errors: string[] = [];

    if (!Number.isFinite(value) || Number.isNaN(value)) {
      return { valid: false, sanitized: String(min), errors: [`${name} must be a finite number`] };
    }

    if (value < min || value > max) {
      errors.push(`${name} must be between ${min} and ${max}`);
    }

    const sanitized = Math.max(min, Math.min(max, Math.floor(value)));

    return {
      valid: errors.length === 0,
      sanitized: String(sanitized),
      errors,
    };
  }

  private static sanitizeString(input: string): string {
    return input
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/[<>]/g, match => ({ '<': '&lt;', '>': '&gt;' }[match] || match))
      .trim();
  }

  private static resolvePath(path: string): string {
    const resolved = path.replace(/\/+/g, '/').replace(/\/\.\//g, '/');
    const parts = resolved.split('/');
    const result: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        result.pop();
      } else if (part !== '.' && part !== '') {
        result.push(part);
      }
    }

    return '/' + result.join('/');
  }

  private static normalizePath(path: string): string {
    return this.resolvePath(path);
  }
}
