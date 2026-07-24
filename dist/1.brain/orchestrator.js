export class Hive {
    async run(a) { return Promise.all(a.map(x => x())); }
}
