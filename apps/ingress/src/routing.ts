import type { ProviderConfig, ProviderModelConfig } from '@signalglass/providers';

export function selectProvider(
  providers: ProviderConfig[],
  model?: string,
): ProviderConfig | undefined {
  if (!providers.length) return undefined;

  if (model) {
    const byModel = providers.find((provider) =>
      provider.models?.some((m) => matchesModel(m, model)),
    );
    if (byModel) return byModel;
  }

  return providers.find((p) => p.defaultModel) ?? providers[0];
}

function matchesModel(config: ProviderModelConfig, model: string): boolean {
  if (config.id === model) return true;
  if (config.aliases?.includes(model)) return true;
  return false;
}
