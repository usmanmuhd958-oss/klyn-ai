export class ErrorBoundary {

  handle(error: unknown) {

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
      timestamp: Date.now()
    };

  }

}
