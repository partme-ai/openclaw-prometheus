import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import { refreshHousekeepingMetrics, refreshRuntimeSnapshots } from "../observer.js";
import { getRuntimeStore } from "../runtime-store.js";

export class PluginRuntimeCollector implements MetricCollector {
  name = "plugin-runtime";

  get definitions(): MetricDefinition[] {
    return getRuntimeStore().registry.snapshotDefinitions();
  }

  async collect(): Promise<MetricSample[]> {
    await refreshRuntimeSnapshots(false);
    refreshHousekeepingMetrics();
    return getRuntimeStore().registry.snapshotSamples();
  }
}
