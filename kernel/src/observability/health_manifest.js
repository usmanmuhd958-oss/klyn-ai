'use strict';
class Manifest {
    constructor() { this.components = {}; }
    register(name, opts) { this.components[name] = { status: 'HEALTHY', ...opts }; }
    setDegraded(name, msg) { if (this.components[name]) this.components[name].status = 'DEGRADED'; }
    setHealthy(name, msg) { if (this.components[name]) this.components[name].status = 'HEALTHY'; }
    snapshot() { return { components: { ...this.components } }; }
}
let instance;
function getManifest() { if (!instance) instance = new Manifest(); return instance; }
module.exports = { getManifest };
