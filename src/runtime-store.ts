import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import type { ResolvedPrometheusConfig } from "./plugin-config.js";
import type { MonitoredProviderSnapshot } from "./types.js";
import { MetricsRegistry } from "./metrics-registry.js";

type ObservedChannelAccount = {
  channelId: string;
  accountId?: string;
};

type RuntimeStoreState = {
  api: OpenClawPluginApi;
  cfg: ResolvedPrometheusConfig;
  registry: MetricsRegistry;
  startedAt: number;
  observedChannelAccounts: Map<string, ObservedChannelAccount>;
  lastSnapshotRefreshAt?: number;
  snapshotError?: string;
  providerSnapshots: MonitoredProviderSnapshot[];
};

let state: RuntimeStoreState | null = null;

export function initializeRuntimeStore(api: OpenClawPluginApi, cfg: ResolvedPrometheusConfig): RuntimeStoreState {
  state = {
    api,
    cfg,
    registry: new MetricsRegistry(),
    startedAt: Date.now(),
    observedChannelAccounts: new Map(),
    providerSnapshots: [],
  };
  return state;
}

export function getRuntimeStore(): RuntimeStoreState {
  if (!state) {
    throw new Error("[openclaw-prometheus] Runtime store not initialized.");
  }
  return state;
}

export function rememberObservedChannelAccount(channelId: string, accountId?: string): void {
  const store = getRuntimeStore();
  const normalizedChannel = channelId.trim();
  if (!normalizedChannel) {
    return;
  }
  const normalizedAccount = accountId?.trim() || undefined;
  const key = `${normalizedChannel}:${normalizedAccount ?? "default"}`;
  if (!store.observedChannelAccounts.has(key)) {
    store.observedChannelAccounts.set(key, {
      channelId: normalizedChannel,
      ...(normalizedAccount ? { accountId: normalizedAccount } : {}),
    });
  }
}

export function listObservedChannelAccounts(): ObservedChannelAccount[] {
  return [...getRuntimeStore().observedChannelAccounts.values()];
}

export function setSnapshotState(params: {
  refreshedAt: number;
  providerSnapshots: MonitoredProviderSnapshot[];
  error?: string;
}): void {
  const store = getRuntimeStore();
  store.lastSnapshotRefreshAt = params.refreshedAt;
  store.providerSnapshots = params.providerSnapshots;
  store.snapshotError = params.error;
}
