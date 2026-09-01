import { atom, map } from 'nanostores';
import { PROVIDER_LIST } from '~/utils/constants';
import type { IProviderConfig } from '~/types/model';
import type { TabVisibilityConfig, TabWindowConfig, UserTabConfig } from '~/components/@settings/core/types';
import { DEFAULT_TAB_CONFIG } from '~/components/@settings/core/constants';
import { toggleTheme } from './theme';
import { create } from 'zustand';

export interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlOrMetaKey?: boolean;
  action: () => void;
  description?: string;
  isPreventDefault?: boolean;
}

export interface Shortcuts {
  toggleTheme: Shortcut;
  toggleTerminal: Shortcut;
}

/**
 * Providers that allow custom base URL editing in the UI settings panel.
 * OpenAILike is included here because the user may want to override the
 * built-in TokenRhythm default with another OpenAI-compatible endpoint.
 */
export const URL_CONFIGURABLE_PROVIDERS = ['Ollama', 'LMStudio', 'OpenAILike'];

/**
 * LOCAL_PROVIDERS:
 * - Require a locally running daemon (Ollama / LMStudio).
 * - Have connection-status indicators (green/red dot) in the Provider combobox.
 * - Are DISABLED by default because they depend on the user having
 *   local software running — the app can't use them "out of the box".
 *
 * IMPORTANT: OpenAILike MUST NOT be in this list.
 *
 *   OpenAILike now ships with a built-in cloud provider fallback
 *   (TokenRhythm / 基元律动) so it works immediately on any device,
 *   including mobile — there is no local daemon requirement.
 *   Putting OpenAILike in LOCAL_PROVIDERS caused it to be disabled by
 *   default in settings.ts -> getInitialProviderSettings(), which made
 *   the provider invisible in the front-end dropdown even though the
 *   LLMManager had fully registered it.
 */
export const LOCAL_PROVIDERS = ['LMStudio', 'Ollama'];

/**
 * Providers that were historically treated as LOCAL (and therefore disabled
 * by default) but have since gained a built-in code-level cloud fallback.
 *
 * Because any visitor who opened the site before this migration already has
 * { provider_settings: { OpenAILike: { settings: { enabled: false } } } }
 * persisted in their localStorage, a blind "apply saved settings" would
 * overwrite the new default (= enabled).  We therefore treat providers in
 * this set specially during load: if the saved state says "disabled" but
 * the provider is no longer in LOCAL_PROVIDERS, we reset it to enabled.
 *
 * This avoids the user having to clear their browser storage manually
 * after every upgrade that promotes a provider to "works out of the box".
 */
const RECENTLY_PROMOTED_FROM_LOCAL_TO_BUILTIN = ['OpenAILike'];

export type ProviderSetting = Record<string, IProviderConfig>;

// Simplified shortcuts store with only theme toggle
export const shortcutsStore = map<Shortcuts>({
  toggleTheme: {
    key: 'd',
    metaKey: true,
    altKey: true,
    shiftKey: true,
    action: () => toggleTheme(),
    description: 'Toggle theme',
    isPreventDefault: true,
  },
  toggleTerminal: {
    key: '`',
    ctrlOrMetaKey: true,
    action: () => {
      // This will be handled by the terminal component
    },
    description: 'Toggle terminal',
    isPreventDefault: true,
  },
});

// Create a single key for provider settings
const PROVIDER_SETTINGS_KEY = 'provider_settings';
const AUTO_ENABLED_KEY = 'auto_enabled_providers';
// Bump this version number whenever we change the "default enabled" strategy
// so that stale localStorage entries get re-evaluated against the new rules.
const SETTINGS_SCHEMA_VERSION = 2;
const SETTINGS_SCHEMA_VERSION_KEY = 'provider_settings_schema_version';

// Add this helper function at the top of the file
const isBrowser = typeof window !== 'undefined';

// Interface for configured provider info from server
interface ConfiguredProvider {
  name: string;
  isConfigured: boolean;
  configMethod: 'environment' | 'none';
}

// Fetch configured providers from server
const fetchConfiguredProviders = async (): Promise<ConfiguredProvider[]> => {
  try {
    const response = await fetch('/api/configured-providers');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as { providers?: ConfiguredProvider[] };

    return data.providers || [];
  } catch (error) {
    console.error('Error fetching configured providers:', error);
    return [];
  }
};

// Initialize provider settings from both localStorage and server-detected configuration
const getInitialProviderSettings = (): ProviderSetting => {
  const initialSettings: ProviderSetting = {};

  // 1) Start with fresh defaults based on current rules
  PROVIDER_LIST.forEach((provider) => {
    initialSettings[provider.name] = {
      ...provider,
      settings: {
        // Local providers are disabled by default (need local daemon running).
        // All other providers are enabled out of the box.
        enabled: !LOCAL_PROVIDERS.includes(provider.name),
      },
    };
  });

  // 2) Handle localStorage migration + selective override
  if (isBrowser) {
    const storedVersion = Number(localStorage.getItem(SETTINGS_SCHEMA_VERSION_KEY) || '0');
    const schemaChanged = !Number.isFinite(storedVersion) || storedVersion < SETTINGS_SCHEMA_VERSION;

    const savedSettingsRaw = localStorage.getItem(PROVIDER_SETTINGS_KEY);
    const hasSavedSettings = savedSettingsRaw !== null;

    // On a schema bump, forcibly reset the persisted settings for providers
    // that were promoted from "local-only" to "has built-in cloud fallback".
    const promotedProvidersNeedingReset = new Set<string>(
      schemaChanged ? RECENTLY_PROMOTED_FROM_LOCAL_TO_BUILTIN : [],
    );

    if (hasSavedSettings) {
      try {
        const parsed = JSON.parse(savedSettingsRaw) as Record<string, IProviderConfig>;

        for (const [name, saved] of Object.entries(parsed)) {
          if (!initialSettings[name]) continue;

          const wasPromoted = promotedProvidersNeedingReset.has(name);
          const savedEnabled = saved?.settings?.enabled;

          // Apply saved override ONLY if:
          //   a) provider was NOT recently promoted, OR
          //   b) the user explicitly turned it ON (we never want to undo that)
          //
          // In other words: if a promoted provider shows up as saved=disabled,
          // treat that as legacy and keep the new default (= enabled).
          if (!wasPromoted || savedEnabled === true) {
            initialSettings[name].settings = { ...initialSettings[name].settings, ...saved.settings };
          }
        }

        // Bump the stored schema version so migration only runs once.
        if (schemaChanged) {
          try {
            localStorage.setItem(SETTINGS_SCHEMA_VERSION_KEY, String(SETTINGS_SCHEMA_VERSION));
            // Persist the migrated settings immediately so reloads don't re-migrate
            localStorage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(initialSettings));
          } catch { /* storage write failures are non-fatal */ }
        }
      } catch (error) {
        console.error('Error parsing saved provider settings (migration aborted for this load):', error);
      }
    } else {
      // Brand-new user — record the schema version immediately.
      try {
        localStorage.setItem(SETTINGS_SCHEMA_VERSION_KEY, String(SETTINGS_SCHEMA_VERSION));
      } catch { /* ignore */ }
    }
  }

  return initialSettings;
};

// Auto-enable providers that are configured on the server
const autoEnableConfiguredProviders = async () => {
  if (!isBrowser) {
    return;
  }

  try {
    const configuredProviders = await fetchConfiguredProviders();
    const currentSettings = providersStore.get();
    const savedSettings = localStorage.getItem(PROVIDER_SETTINGS_KEY);
    const autoEnabledProviders = localStorage.getItem(AUTO_ENABLED_KEY);

    // Track which providers were auto-enabled to avoid overriding user preferences
    const previouslyAutoEnabled = autoEnabledProviders ? JSON.parse(autoEnabledProviders) : [];
    const newlyAutoEnabled: string[] = [];

    let hasChanges = false;

    configuredProviders.forEach(({ name, isConfigured, configMethod }) => {
      if (isConfigured && configMethod === 'environment' && LOCAL_PROVIDERS.includes(name)) {
        const currentProvider = currentSettings[name];

        if (currentProvider) {
          const hasUserSettings = savedSettings !== null;
          const wasAutoEnabled = previouslyAutoEnabled.includes(name);
          const shouldAutoEnable = !currentProvider.settings.enabled && (!hasUserSettings || wasAutoEnabled);

          if (shouldAutoEnable) {
            currentSettings[name] = {
              ...currentProvider,
              settings: {
                ...currentProvider.settings,
                enabled: true,
              },
            };
            newlyAutoEnabled.push(name);
            hasChanges = true;
          }
        }
      }
    });

    if (hasChanges) {
      providersStore.set(currentSettings);
      localStorage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(currentSettings));

      const allAutoEnabled = [...new Set([...previouslyAutoEnabled, ...newlyAutoEnabled])];
      localStorage.setItem(AUTO_ENABLED_KEY, JSON.stringify(allAutoEnabled));

      console.log(`Auto-enabled providers: ${newlyAutoEnabled.join(', ')}`);
    }
  } catch (error) {
    console.error('Error auto-enabling configured providers:', error);
  }
};

export const providersStore = map<ProviderSetting>(getInitialProviderSettings());

// Export the auto-enable function for use in components
export const initializeProviders = autoEnableConfiguredProviders;

// Initialize providers when the module loads (in browser only)
if (isBrowser) {
  setTimeout(() => {
    autoEnableConfiguredProviders();
  }, 100);
}

// Create a function to update provider settings that handles both store and persistence
export const updateProviderSettings = (provider: string, settings: ProviderSetting) => {
  const currentSettings = providersStore.get();

  const updatedProvider = {
    ...currentSettings[provider],
    settings: {
      ...currentSettings[provider].settings,
      ...settings,
    },
  };

  providersStore.setKey(provider, updatedProvider);

  const allSettings = providersStore.get();
  localStorage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(allSettings));

  if (LOCAL_PROVIDERS.includes(provider) && updatedProvider.settings.enabled !== undefined) {
    updateAutoEnabledTracking(provider, updatedProvider.settings.enabled);
  }
};

// Update auto-enabled tracking when user manually changes provider settings
const updateAutoEnabledTracking = (providerName: string, isEnabled: boolean) => {
  if (!isBrowser) {
    return;
  }

  try {
    const autoEnabledProviders = localStorage.getItem(AUTO_ENABLED_KEY);
    const currentAutoEnabled = autoEnabledProviders ? JSON.parse(autoEnabledProviders) : [];

    if (isEnabled) {
      if (!currentAutoEnabled.includes(providerName)) {
        currentAutoEnabled.push(providerName);
        localStorage.setItem(AUTO_ENABLED_KEY, JSON.stringify(currentAutoEnabled));
      }
    } else {
      const updatedAutoEnabled = currentAutoEnabled.filter((name: string) => name !== providerName);
      localStorage.setItem(AUTO_ENABLED_KEY, JSON.stringify(updatedAutoEnabled));
    }
  } catch (error) {
    console.error('Error updating auto-enabled tracking:', error);
  }
};

export const isDebugMode = atom(false);

// Define keys for localStorage
const SETTINGS_KEYS = {
  LATEST_BRANCH: 'isLatestBranch',
  AUTO_SELECT_TEMPLATE: 'autoSelectTemplate',
  CONTEXT_OPTIMIZATION: 'contextOptimizationEnabled',
  EVENT_LOGS: 'isEventLogsEnabled',
  PROMPT_ID: 'promptId',
  DEVELOPER_MODE: 'isDeveloperMode',
} as const;

// Initialize settings from localStorage or defaults
const getInitialSettings = () => {
  const getStoredBoolean = (key: string, defaultValue: boolean): boolean => {
    if (!isBrowser) {
      return defaultValue;
    }

    const stored = localStorage.getItem(key);

    if (stored === null) {
      return defaultValue;
    }

    try {
      return JSON.parse(stored);
    } catch {
      return defaultValue;
    }
  };

  return {
    latestBranch: getStoredBoolean(SETTINGS_KEYS.LATEST_BRANCH, false),
    autoSelectTemplate: getStoredBoolean(SETTINGS_KEYS.AUTO_SELECT_TEMPLATE, true),
    contextOptimization: getStoredBoolean(SETTINGS_KEYS.CONTEXT_OPTIMIZATION, true),
    eventLogs: getStoredBoolean(SETTINGS_KEYS.EVENT_LOGS, true),
    promptId: isBrowser ? localStorage.getItem(SETTINGS_KEYS.PROMPT_ID) || 'default' : 'default',
    developerMode: getStoredBoolean(SETTINGS_KEYS.DEVELOPER_MODE, false),
  };
};

// Initialize stores with persisted values
const initialSettings = getInitialSettings();

export const latestBranchStore = atom<boolean>(initialSettings.latestBranch);
export const autoSelectStarterTemplate = atom<boolean>(initialSettings.autoSelectTemplate);
export const enableContextOptimizationStore = atom<boolean>(initialSettings.contextOptimization);
export const isEventLogsEnabled = atom<boolean>(initialSettings.eventLogs);
export const promptStore = atom<string>(initialSettings.promptId);

// Helper functions to update settings with persistence
export const updateLatestBranch = (enabled: boolean) => {
  latestBranchStore.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.LATEST_BRANCH, JSON.stringify(enabled));
};

export const updateAutoSelectTemplate = (enabled: boolean) => {
  autoSelectStarterTemplate.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.AUTO_SELECT_TEMPLATE, JSON.stringify(enabled));
};

export const updateContextOptimization = (enabled: boolean) => {
  enableContextOptimizationStore.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.CONTEXT_OPTIMIZATION, JSON.stringify(enabled));
};

export const updateEventLogs = (enabled: boolean) => {
  isEventLogsEnabled.set(enabled);
  localStorage.setItem(SETTINGS_KEYS.EVENT_LOGS, JSON.stringify(enabled));
};

export const updatePromptId = (id: string) => {
  promptStore.set(id);
  localStorage.setItem(SETTINGS_KEYS.PROMPT_ID, id);
};

// Initialize tab configuration from localStorage or defaults
const getInitialTabConfiguration = (): TabWindowConfig => {
  const defaultConfig: TabWindowConfig = {
    userTabs: DEFAULT_TAB_CONFIG.filter((tab): tab is UserTabConfig => tab.window === 'user'),
  };

  if (!isBrowser) {
    return defaultConfig;
  }

  try {
    const saved = localStorage.getItem('bolt_tab_configuration');

    if (!saved) {
      return defaultConfig;
    }

    const parsed = JSON.parse(saved);

    if (!parsed?.userTabs) {
      return defaultConfig;
    }

    return {
      userTabs: parsed.userTabs.filter((tab: TabVisibilityConfig): tab is UserTabConfig => tab.window === 'user'),
    };
  } catch (error) {
    console.warn('Failed to parse tab configuration:', error);
    return defaultConfig;
  }
};

export const tabConfigurationStore = map<TabWindowConfig>(getInitialTabConfiguration());

export const resetTabConfiguration = () => {
  const defaultConfig: TabWindowConfig = {
    userTabs: DEFAULT_TAB_CONFIG.filter((tab): tab is UserTabConfig => tab.window === 'user'),
  };

  tabConfigurationStore.set(defaultConfig);
  localStorage.setItem('bolt_tab_configuration', JSON.stringify(defaultConfig));
};

interface SettingsStore {
  isOpen: boolean;
  selectedTab: string;
  openSettings: () => void;
  closeSettings: () => void;
  setSelectedTab: (tab: string) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  isOpen: false,
  selectedTab: 'user',

  openSettings: () => {
    set({
      isOpen: true,
      selectedTab: 'user',
    });
  },

  closeSettings: () => {
    set({
      isOpen: false,
      selectedTab: 'user',
    });
  },

  setSelectedTab: (tab: string) => {
    set({ selectedTab: tab });
  },
}));
