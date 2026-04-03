declare module "openclaw/plugin-sdk/core" {
  export type OpenClawPluginApi = {
    id: string;
    runtime: unknown;
    config: unknown;
    pluginConfig?: Record<string, unknown>;
    registerHttpRoute: (route: unknown) => void;
  };
}

declare module "openclaw/plugin-sdk/plugin-entry" {
  export function definePluginEntry(opts: {
    id: string;
    name: string;
    description: string;
    register: (api: import("openclaw/plugin-sdk/core").OpenClawPluginApi) => void;
  }): {
    id: string;
    name: string;
    description: string;
    register: (api: import("openclaw/plugin-sdk/core").OpenClawPluginApi) => void;
  };
}
