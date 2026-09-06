import type { Output } from "../lib/work-store.ts";

export interface Input {
  text: string;
  images?: string[];
}
export interface TurnOptions {
  input: Input;
  instructions: string;
  sessionId?: string;
  signal: AbortSignal;
  onSession: (id: string) => void;
  onProgress?: (text: string) => Promise<void>;
  onActivity?: (text: string, usage?: unknown) => void;
  onControl?: (steer: (input: Input) => Promise<void>) => void;
  ask?: (question: string, options: string[]) => Promise<string>;
  tool?: (name: string, args: unknown) => Promise<unknown>;
}
export type RunTurn = (options: TurnOptions) => Promise<Output>;
