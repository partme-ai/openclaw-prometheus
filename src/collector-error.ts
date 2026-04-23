import type { MetricSample } from "./types.js";

export class CollectorError extends Error {
  readonly samples: MetricSample[];

  constructor(message: string, samples: MetricSample[], cause?: unknown) {
    super(message);
    this.name = "CollectorError";
    this.samples = samples;
    if (cause !== undefined) {
      (this as unknown as { cause?: unknown }).cause = cause;
    }
  }
}

