export interface Mission {
  title: string;
  tasks: string[];
}

export class MissionPlanner {
  create(title: string): Mission {
    return {
      title,
      tasks: [
        "Analyze intent",
        "Generate architecture",
        "Execute verification"
      ]
    };
  }
}
