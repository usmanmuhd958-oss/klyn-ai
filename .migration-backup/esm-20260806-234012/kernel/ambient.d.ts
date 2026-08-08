/**
 * Ambient declarations for optional third-party modules referenced by
 * experimental kernel services. These packages are NOT hard dependencies
 * (the code falls back gracefully when they are absent); the declarations
 * keep TypeScript's module resolution happy after the kernel was converted
 * from `require()` to ESM `import`.
 */
declare module '@supabase/supabase-js' {
  export function createClient(url: string, key: string): any;
}

declare module 'ws' {
  export default class WebSocket {
    static Server: any;
    constructor(...args: any[]);
    on(event: string, listener: (...args: any[]) => void): this;
    send(data: any, cb?: (err?: Error) => void): void;
    close(): void;
  }
}
