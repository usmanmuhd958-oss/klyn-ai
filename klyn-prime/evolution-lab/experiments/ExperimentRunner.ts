export class ExperimentRunner {

  run(experimentId: string) {

    return {
      experimentId,
      status: "completed",
      result: "evaluated"
    };

  }

}
