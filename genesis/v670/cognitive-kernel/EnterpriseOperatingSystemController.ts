export class EnterpriseOperatingSystemController {
  execute(command: string) {
    return {
      command,
      executed: true
    };
  }
}
