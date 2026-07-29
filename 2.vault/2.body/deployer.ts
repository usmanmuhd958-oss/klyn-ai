// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
import pc from 'picocolors';
import { MarketplaceRegistry } from '../5.marketplace/registry.ts';

export interface DeploymentTarget {
  platform: 'vercel' | 'render';
  prod?: boolean;
}

export interface DeploymentResult {
  target: string;
  success: boolean;
  url?: string;
  duration: number;
  statusCode: number;
  error?: string;
}

export class GhostDeployer {
  private registry: MarketplaceRegistry;

  constructor() {
    this.registry = new MarketplaceRegistry();
  }

  private async deployToVercel(prod: boolean): Promise<DeploymentResult> {
    const startTime = Date.now();
    const token = process.env.VERCEL_TOKEN;

    if (!token) {
      return {
        target: 'vercel',
        success: false,
        duration: Date.now() - startTime,
        statusCode: 401,
        error: 'VERCEL_TOKEN environment variable is missing'
      };
    }

    try {
      const response = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'klyn-ai-os',
          target: prod ? 'production' : 'preview'
        })
      });

      const duration = Date.now() - startTime;
      const data = await response.json() as { url?: string; error?: { message: string } };

      if (!response.ok) {
        return {
          target: 'vercel',
          success: false,
          duration,
          statusCode: response.status,
          error: data.error?.message || 'Vercel Deployment Failed'
        };
      }

      return {
        target: 'vercel',
        success: true,
        url: `https://${data.url}`,
        duration,
        statusCode: response.status
      };
    } catch (err) {
      return {
        target: 'vercel',
        success: false,
        duration: Date.now() - startTime,
        statusCode: 500,
        error: String(err)
      };
    }
  }

  private async deployToRender(prod: boolean): Promise<DeploymentResult> {
    const startTime = Date.now();
    const apiKey = process.env.RENDER_API_KEY;
    const serviceId = process.env.RENDER_SERVICE_ID;

    if (!apiKey || !serviceId) {
      return {
        target: 'render',
        success: false,
        duration: Date.now() - startTime,
        statusCode: 401,
        error: 'RENDER_API_KEY or RENDER_SERVICE_ID missing'
      };
    }

    try {
      const response = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ clearCache: prod ? 'clear' : 'do_not_clear' })
      });

      const duration = Date.now() - startTime;
      if (!response.ok) {
        return {
          target: 'render',
          success: false,
          duration,
          statusCode: response.status,
          error: 'Render Deployment Hook Trigger Failed'
        };
      }

      return {
        target: 'render',
        success: true,
        url: `https://render.com/deploy/${serviceId}`,
        duration,
        statusCode: response.status
      };
    } catch (err) {
      return {
        target: 'render',
        success: false,
        duration: Date.now() - startTime,
        statusCode: 500,
        error: String(err)
      };
    }
  }

  public async deploy(targets: DeploymentTarget[]): Promise<DeploymentResult[]> {
    console.log(pc.cyan('🚀 [Klyn AI OS] Executing Ghost Deployment Pipeline...'));
    
    const tasks = targets.map(t => {
      if (t.platform === 'vercel') return this.deployToVercel(!!t.prod);
      return this.deployToRender(!!t.prod);
    });

    const results = await Promise.allSettled(tasks);
    const finalResults: DeploymentResult[] = [];

    results.forEach(res => {
      if (res.status === 'fulfilled') {
        finalResults.push(res.value);
        if (res.value.success) {
          console.log(pc.green(`✔ Successfully deployed to ${res.value.target.toUpperCase()} in ${res.value.duration}ms -> ${res.value.url}`));
        } else {
          console.log(pc.red(`✖ Failed deploy to ${res.value.target.toUpperCase()}: ${res.value.error} (Status ${res.value.statusCode})`));
        }
      }
    });

    this.registry.close();
    return finalResults;
  }
}
