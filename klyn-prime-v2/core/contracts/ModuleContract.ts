export interface KlynModule {
  name: string;
  version: string;

  initialize(): Promise<void>;

  healthCheck(): Promise<boolean>;

  shutdown(): Promise<void>;
}
