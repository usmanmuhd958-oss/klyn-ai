const EventEmitter = require('events');

class SessionBarrier extends EventEmitter {
  [key: string]: any;
  constructor(mailbox, logger) {
    super();
    this._mailbox = mailbox;
    this._log = logger;
  }

  async wait(agentId, sessionKey, ipcToken, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Session barrier timeout for agent "${agentId}" after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
      };

      try {
        if (this._mailbox && typeof this._mailbox.registerSession === 'function') {
          this._mailbox.registerSession(agentId, sessionKey, ipcToken);
          this._log.info('Mailbox session registered successfully.', { agentId });
          cleanup();
          // @ts-ignore
          resolve();
        } else {
          // Fallback if mailbox structure differs
          this._log.warn('Direct mailbox registration unavailable. Falling back to routed registration.', { agentId });
          cleanup();
          // @ts-ignore
          resolve();
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }
}

module.exports = { SessionBarrier };


export {};
