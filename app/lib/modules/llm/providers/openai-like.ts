import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { logger } from '~/utils/logger';

interface OpenAIModelsResponse {
  data: Array<{ id: string; context_length?: number; max_completion_tokens?: number }>;
}

/**
 * Built-in TokenRhythm (基元律动) defaults.
 * These act as a code-level fallback so the provider works immediately
 * even when no env vars or UI settings are configured (e.g. mobile UI broken).
 * Users can still override via OPENAI_LIKE_API_BASE_URL / OPENAI_LIKE_API_KEY / OPENAI_LIKE_API_MODELS env vars,
 * or via the providerSettings / apiKeys from the UI.
 */
const DEFAULT_BASE_URL = 'https://tokenrhythm.studio/v1';
const DEFAULT_API_KEY = 'sk_tr_dchX8Z8reAM5xNqgh2Zo90rE3aYJ11E77FRuc9NJCn0';

const BUILTIN_MODELS: ModelInfo[] = [
  { name: 'glm-5.3-flash',   label: 'GLM-5.3 Flash (TokenRhythm)',    provider: 'OpenAILike', maxTokenAllowed: 1_000_000, maxCompletionTokens: 128_000 },
  { name: 'glm-5.3',         label: 'GLM-5.3 (TokenRhythm)',          provider: 'OpenAILike', maxTokenAllowed: 1_000_000, maxCompletionTokens: 128_000 },
  { name: 'glm-5.2',         label: 'GLM-5.2 (TokenRhythm)',          provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'glm-5.1',         label: 'GLM-5.1 (TokenRhythm)',          provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'glm-5',           label: 'GLM-5 (TokenRhythm)',            provider: 'OpenAILike', maxTokenAllowed: 1_000_000, maxCompletionTokens: 128_000 },
  { name: 'deepseek-v4-flash-0731', label: 'DeepSeek-V4 Flash 0731 (TokenRhythm)', provider: 'OpenAILike', maxTokenAllowed: 128_000, maxCompletionTokens: 8_192 },
  { name: 'deepseek-v4-pro-0813',   label: 'DeepSeek-V4 Pro 0813 (TokenRhythm)',   provider: 'OpenAILike', maxTokenAllowed: 128_000, maxCompletionTokens: 8_192 },
  { name: 'kimi-k2.5',       label: 'Kimi K2.5 (TokenRhythm)',        provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'kimi-k2.6',       label: 'Kimi K2.6 (TokenRhythm)',        provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'kimi-k2.7-code',  label: 'Kimi K2.7 Code (TokenRhythm)',   provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'longcat-2.0',     label: 'LongCat 2.0 (TokenRhythm)',      provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'mimo-v2.5-pro',   label: 'MiMo v2.5 Pro (TokenRhythm)',    provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'minimax-m2.5',    label: 'MiniMax-M2.5 (TokenRhythm)',     provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'minimax-m2.7',    label: 'MiniMax-M2.7 (TokenRhythm)',     provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 192_000 },
  { name: 'qwen3.7-flash',   label: 'Qwen3.7 Flash (TokenRhythm)',    provider: 'OpenAILike', maxTokenAllowed: 1_000_000, maxCompletionTokens: 128_000 },
  { name: 'qwen3.7-max',     label: 'Qwen3.7 Max (TokenRhythm)',      provider: 'OpenAILike', maxTokenAllowed: 1_000_000, maxCompletionTokens: 128_000 },
  { name: 'qwen3.8-27b',     label: 'Qwen3.8 27B (TokenRhythm)',      provider: 'OpenAILike', maxTokenAllowed: 1_000_000, maxCompletionTokens: 128_000 },
  { name: 'qwen3.8-max',     label: 'Qwen3.8 Max (TokenRhythm)',      provider: 'OpenAILike', maxTokenAllowed: 1_000_000, maxCompletionTokens: 128_000 },
  { name: 'seed-2.1-pro',    label: 'Seed 2.1 Pro (TokenRhythm)',     provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
  { name: 'seed-2.1-turbo',  label: 'Seed 2.1 Turbo (TokenRhythm)',   provider: 'OpenAILike', maxTokenAllowed:   200_000, maxCompletionTokens: 128_000 },
];

export default class OpenAILikeProvider extends BaseProvider {
  name = 'OpenAILike';
  getApiKeyLink = undefined;
  labelForGetApiKey = '基元律动 TokenRhythm 已内置配置';

  config = {
    baseUrlKey: 'OPENAI_LIKE_API_BASE_URL',
    apiTokenKey: 'OPENAI_LIKE_API_KEY',
    modelsKey: 'OPENAI_LIKE_API_MODELS',
    // Hardcoded defaults used when the user hasn't configured env vars or UI settings yet.
    // Resolve order: providerSettings.baseUrl > serverEnv[KEY] > process.env[KEY] > manager.env[KEY] > this.config.baseUrl
    baseUrl: DEFAULT_BASE_URL,
  };

  /**
   * Built-in models show up immediately in the dropdown without any API call.
   * getDynamicModels will still try to fetch /models and merge (newer /models wins).
   */
  staticModels: ModelInfo[] = BUILTIN_MODELS;

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    const { baseUrl, apiKey } = this._resolveConfig({
      apiKeys,
      providerSettings: settings,
      serverEnv,
    });

    if (!baseUrl || !apiKey) {
      // Fallback: without config, return built-in list directly
      logger.info(`${this.name}: No env/config found, returning built-in TokenRhythm model list`);
      return BUILTIN_MODELS;
    }

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: this.createTimeoutSignal(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const res = (await response.json()) as OpenAIModelsResponse;

      return res.data.map((model) => ({
        name: model.id,
        label: `${model.id} (TokenRhythm)`,
        provider: this.name,
        maxTokenAllowed: model.context_length ?? 128_000,
        maxCompletionTokens: model.max_completion_tokens ?? 8_192,
      }));
    } catch (error) {
      logger.info(`${this.name}: Could not fetch /models endpoint, checking fallback env / builtin list`, error);

      // 1) Fallback to OPENAI_LIKE_API_MODELS if available
      // eslint-disable-next-line dot-notation
      const modelsEnv = serverEnv['OPENAI_LIKE_API_MODELS'] || settings?.OPENAI_LIKE_API_MODELS;

      if (modelsEnv) {
        logger.info(`${this.name}: Using OPENAI_LIKE_API_MODELS fallback`);
        return this._parseModelsFromEnv(modelsEnv);
      }

      // 2) Final fallback: built-in TokenRhythm model list
      logger.info(`${this.name}: Using built-in TokenRhythm model list`);
      return BUILTIN_MODELS;
    }
  }

  /**
   * Resolve baseUrl + apiKey with hardcoded TokenRhythm defaults as last fallback.
   * Mirrors BaseProvider.getProviderBaseUrlAndKey but also fills in the built-in
   * DEFAULT_API_KEY when no key is present (so the UI "Not Set" state still works).
   */
  private _resolveConfig(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: IProviderSetting;
    serverEnv?: Record<string, string>;
  }) {
    const { apiKeys, providerSettings, serverEnv } = options;
    const base = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings,
      serverEnv: serverEnv ?? {},
      defaultBaseUrlKey: 'OPENAI_LIKE_API_BASE_URL',
      defaultApiTokenKey: 'OPENAI_LIKE_API_KEY',
    });

    return {
      baseUrl: base.baseUrl ?? DEFAULT_BASE_URL,
      apiKey:  base.apiKey  ?? DEFAULT_API_KEY,
    };
  }

  /**
   * Parse OPENAI_LIKE_API_MODELS environment variable
   * Format: path/to/model1:limit;path/to/model2:limit;path/to/model3:limit
   */
  private _parseModelsFromEnv(modelsEnv: string): ModelInfo[] {
    if (!modelsEnv) {
      return [];
    }

    try {
      const models: ModelInfo[] = [];
      const modelEntries = modelsEnv.split(';');

      for (const entry of modelEntries) {
        const trimmedEntry = entry.trim();

        if (!trimmedEntry) {
          continue;
        }

        const [modelPath, limitStr] = trimmedEntry.split(':');

        if (!modelPath) {
          continue;
        }

        const limit = limitStr ? parseInt(limitStr.trim(), 10) : 128_000;
        const modelName = modelPath.trim();

        // Generate a readable label from the model path
        const label = this._generateModelLabel(modelName);

        models.push({
          name: modelName,
          label,
          provider: this.name,
          maxTokenAllowed: limit,
          maxCompletionTokens: Math.min(limit, 128_000),
        });
      }

      logger.info(`${this.name}: Parsed ${models.length} models from env`);

      return models;
    } catch (error) {
      logger.error(`${this.name}: Error parsing OPENAI_LIKE_API_MODELS:`, error);
      return [];
    }
  }

  /**
   * Generate a readable label from model path
   */
  private _generateModelLabel(modelPath: string): string {
    // Extract the last part of the path and clean it up
    const parts = modelPath.split('/');
    const lastPart = parts[parts.length - 1];

    // Remove common prefixes and clean up the name
    let label = lastPart
      .replace(/^accounts\//, '')
      .replace(/^fireworks\/models\//, '')
      .replace(/^models\//, '')
      // Capitalize first letter of each word
      .replace(/\b\w/g, (l) => l.toUpperCase())
      // Replace spaces with hyphens for a cleaner look
      .replace(/\s+/g, '-');

    // Add provider suffix if not already present
    if (!label.includes('TokenRhythm') && !label.includes('Fireworks') && !label.includes('OpenAI')) {
      label += ' (TokenRhythm)';
    }

    return label;
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;
    const envRecord = this.convertEnvToRecord(serverEnv);

    const { baseUrl, apiKey } = this._resolveConfig({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: envRecord,
    });

    if (!baseUrl || !apiKey) {
      throw new Error(`Missing configuration for ${this.name} provider`);
    }

    return getOpenAILikeModel(baseUrl, apiKey, model);
  }
}
