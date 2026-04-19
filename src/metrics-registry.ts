import type { MetricDefinition, MetricSample, MetricType } from "./types.js";

type LabelValues = Record<string, string>;

function normalizeLabels(labels: LabelValues | undefined): LabelValues | undefined {
  if (!labels || Object.keys(labels).length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(labels)
      .map(([key, value]) => [key, String(value)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function sampleKey(name: string, labels: LabelValues | undefined): string {
  const normalized = normalizeLabels(labels);
  return `${name}::${normalized ? JSON.stringify(normalized) : ""}`;
}

export class MetricsRegistry {
  private readonly definitions = new Map<string, MetricDefinition>();
  private readonly samples = new Map<string, MetricSample>();

  define(definition: MetricDefinition): void {
    this.definitions.set(definition.name, {
      ...definition,
      ...(definition.labels ? { labels: [...definition.labels] } : {}),
    });
  }

  set(
    name: string,
    value: number,
    options: {
      help: string;
      type?: MetricType;
      labels?: LabelValues;
      timestamp?: number;
    },
  ): void {
    this.define({
      name,
      help: options.help,
      type: options.type ?? "gauge",
      labels: options.labels ? Object.keys(options.labels).sort() : undefined,
    });
    this.samples.set(sampleKey(name, options.labels), {
      name,
      value,
      ...(options.labels ? { labels: normalizeLabels(options.labels) } : {}),
      ...(typeof options.timestamp === "number" ? { timestamp: options.timestamp } : {}),
    });
  }

  inc(
    name: string,
    by: number,
    options: {
      help: string;
      type?: MetricType;
      labels?: LabelValues;
    },
  ): void {
    const key = sampleKey(name, options.labels);
    const current = this.samples.get(key)?.value ?? 0;
    this.set(name, current + by, options);
  }

  dec(
    name: string,
    by: number,
    options: {
      help: string;
      type?: MetricType;
      labels?: LabelValues;
    },
  ): void {
    const key = sampleKey(name, options.labels);
    const current = this.samples.get(key)?.value ?? 0;
    this.set(name, Math.max(0, current - by), options);
  }

  observeSummary(
    prefix: string,
    seconds: number,
    options: {
      help: string;
      labels?: LabelValues;
    },
  ): void {
    this.inc(`${prefix}_count`, 1, {
      help: `${options.help} count`,
      type: "counter",
      labels: options.labels,
    });
    this.inc(`${prefix}_sum`, seconds, {
      help: `${options.help} sum in seconds`,
      type: "counter",
      labels: options.labels,
    });
  }

  setOneHotStatus(
    name: string,
    currentStatus: string,
    statuses: readonly string[],
    options: {
      help: string;
      labels?: LabelValues;
      statusLabel?: string;
    } = {
      help: "",
    },
  ): void {
    const statusLabel = options.statusLabel ?? "status";
    for (const status of statuses) {
      this.set(name, currentStatus === status ? 1 : 0, {
        help: options.help,
        type: "gauge",
        labels: {
          ...(options.labels ?? {}),
          [statusLabel]: status,
        },
      });
    }
  }

  snapshotDefinitions(): MetricDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  snapshotSamples(): MetricSample[] {
    return [...this.samples.values()].sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) {
        return byName;
      }
      return JSON.stringify(a.labels ?? {}).localeCompare(JSON.stringify(b.labels ?? {}));
    });
  }
}
