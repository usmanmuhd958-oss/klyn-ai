export class CognitiveThreatDetectionEngine {
  detect(signal:any){
    return {
      signal,
      threatDetection:true
    };
  }
}
