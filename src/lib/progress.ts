export type ProgressStage =
  | "config"
  | "discover"
  | "prepare"
  | "prove"
  | "relay"
  | "confirm"
  | "verify";

export interface ProgressUpdate {
  readonly stage: ProgressStage;
  readonly message: string;
}

export type ProgressReporter = (update: ProgressUpdate) => void | Promise<void>;

export const noopProgress: ProgressReporter = () => undefined;
