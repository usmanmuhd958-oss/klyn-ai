export class Scheduler {
    queue = [];
    schedule(fn) { this.queue.push(fn); setTimeout(fn, 0); }
}
