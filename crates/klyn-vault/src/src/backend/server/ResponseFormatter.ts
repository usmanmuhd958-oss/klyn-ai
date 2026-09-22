export class ResponseFormatter {

  success(data: unknown) {
    return {
      success: true,
      data,
      timestamp: Date.now()
    };
  }


  error(message: string) {
    return {
      success: false,
      error: message,
      timestamp: Date.now()
    };
  }

}
