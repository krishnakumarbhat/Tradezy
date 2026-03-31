import { PROVIDERS as PROVIDER_DEFS } from '@/providers';

export interface Model {
  id: string;
  displayName: string;
}

interface Provider {
  displayName: string;
  providerId: string;
  models: Model[];
}

const PROVIDER_MODELS: Record<string, Model[]> = {
  openai: [
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-latest', displayName: 'Sonnet 3.5' },
    { id: 'claude-3-opus-latest', displayName: 'Opus 3' },
  ],
  google: [
    { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
  ],
  xai: [
    { id: 'grok-2-1212', displayName: 'Grok 2' },
    { id: 'grok-beta', displayName: 'Grok Beta' },
  ],
  moonshot: [{ id: 'moonshot-v1-8k', displayName: 'Moonshot V1' }],
  deepseek: [
    { id: 'deepseek-chat', displayName: 'DeepSeek V3' },
    { id: 'deepseek-reasoner', displayName: 'DeepSeek R1' },
  ],
};

export const PROVIDERS: Provider[] = PROVIDER_DEFS.map((provider) => ({
  displayName: provider.displayName,
  providerId: provider.id,
  models: PROVIDER_MODELS[provider.id] ?? [],
}));

export function getModelsForProvider(providerId: string): Model[] {
  const provider = PROVIDERS.find((entry) => entry.providerId === providerId);
  return provider?.models ?? [];
}

export function getModelIdsForProvider(providerId: string): string[] {
  return getModelsForProvider(providerId).map((model) => model.id);
}

export function getDefaultModelForProvider(providerId: string): string | undefined {
  const models = getModelsForProvider(providerId);
  return models[0]?.id;
}

export function getModelDisplayName(modelId: string): string {
  const normalizedId = modelId.replace(/^(ollama|openrouter):/, '');

  for (const provider of PROVIDERS) {
    const model = provider.models.find((entry) => entry.id === normalizedId || entry.id === modelId);
    if (model) {
      return model.displayName;
    }
  }

  return normalizedId;
}
