import { useEffect, useMemo, useState } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, Rocket, PlugZap, Wrench, Laptop } from 'lucide-react';
import type { SelectedModel, OllamaModelInfo, ProviderConfig } from '@accomplish/shared';
import { DEFAULT_PROVIDERS } from '@accomplish/shared';

interface OnboardingPageProps {
  onComplete: () => void;
}

const KNOWN_API_KEY_FORMATS: Record<string, { prefix: string; placeholder: string }> = {
  anthropic: { prefix: 'sk-ant-', placeholder: 'sk-ant-...' },
  openai: { prefix: 'sk-', placeholder: 'sk-...' },
  google: { prefix: 'AIza', placeholder: 'AIza...' },
  xai: { prefix: 'xai-', placeholder: 'xai-...' },
};

type SkillStatus = {
  id: string;
  name: string;
  description?: string;
  installed: boolean;
  installable: boolean;
};

export default function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const accomplish = getAccomplish();
  const steps = ['Welcome', 'Connect a Model', 'Install Skills', 'Background Mode'];
  const [stepIndex, setStepIndex] = useState(0);

  // Cloud model setup state
  const [provider, setProvider] = useState('anthropic');
  const [providerCatalog, setProviderCatalog] = useState<ProviderConfig[]>(DEFAULT_PROVIDERS);
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');

  // Ollama setup state
  const [activeTab, setActiveTab] = useState<'cloud' | 'local'>('cloud');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState('');

  // Skills state
  const [skills, setSkills] = useState<SkillStatus[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [installingSkills, setInstallingSkills] = useState<string[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  // Background state
  const [runInBackground, setRunInBackground] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [backgroundSaving, setBackgroundSaving] = useState(false);

  const providerModels = useMemo(() => {
    const config = providerCatalog.find((p) => p.id === provider);
    return config?.models ?? [];
  }, [provider, providerCatalog]);

  const cloudProviders = useMemo(
    () => providerCatalog.filter((entry) => entry.id !== 'ollama' && entry.requiresApiKey),
    [providerCatalog]
  );

  useEffect(() => {
    if (providerModels.length > 0 && !providerModels.some((entry) => entry.fullId === selectedModelId)) {
      setSelectedModelId(providerModels[0].fullId);
    }
  }, [providerModels, selectedModelId]);

  useEffect(() => {
    if (cloudProviders.length === 0) return;
    if (!cloudProviders.some((entry) => entry.id === provider)) {
      setProvider(cloudProviders[0].id);
    }
  }, [cloudProviders, provider]);

  useEffect(() => {
    const preload = async () => {
      try {
        const providers = await accomplish.listModelProviders();
        setProviderCatalog(Array.isArray(providers) && providers.length > 0 ? providers : DEFAULT_PROVIDERS);
      } catch (error) {
        console.error('Failed to load model providers:', error);
      }

      try {
        const settings = await accomplish.getAppSettings();
        setRunInBackground(!!settings?.runInBackground);
        setLaunchAtLogin(!!settings?.launchAtLogin);
      } catch (error) {
        console.error('Failed to load app settings:', error);
      }

      try {
        const model = await accomplish.getSelectedModel();
        if (model?.provider === 'ollama') {
          setActiveTab('local');
        } else if (model?.provider) {
          setProvider(model.provider);
          if (model.model) {
            setSelectedModelId(model.model);
          }
        }
      } catch (error) {
        console.error('Failed to load selected model:', error);
      }

      try {
        const config = await accomplish.getOllamaConfig();
        if (config?.baseUrl) {
          setOllamaUrl(config.baseUrl);
        }
      } catch (error) {
        console.error('Failed to load Ollama config:', error);
      }

      await refreshSkills();
    };

    void preload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSkills = async () => {
    setSkillsLoading(true);
    try {
      const data = await accomplish.getSkillsStatus();
      setSkills(data);
    } catch (error) {
      console.error('Failed to load skills:', error);
      setSkillsError('Unable to load skills status.');
    } finally {
      setSkillsLoading(false);
    }
  };

  const handleSaveApiKey = async () => {
    setSavingKey(true);
    setApiKeyError(null);
    setApiKeySaved(false);

    const providerConfig = cloudProviders.find((entry) => entry.id === provider);
    const trimmedKey = apiKey.trim();
    if (!providerConfig) {
      setApiKeyError('Select a provider to continue.');
      setSavingKey(false);
      return;
    }
    if (!trimmedKey) {
      setApiKeyError('Enter your API key to continue.');
      setSavingKey(false);
      return;
    }
    const keyFormat = KNOWN_API_KEY_FORMATS[provider];
    if (keyFormat && !trimmedKey.startsWith(keyFormat.prefix)) {
      setApiKeyError(`Key should start with ${keyFormat.prefix}`);
      setSavingKey(false);
      return;
    }

    try {
      const validation = await accomplish.validateApiKeyForProvider(provider, trimmedKey);
      if (!validation.valid) {
        setApiKeyError(validation.error || 'API key validation failed.');
        setSavingKey(false);
        return;
      }

      await accomplish.addApiKey(provider, trimmedKey);
      await accomplish.setSelectedModel({
        provider,
        model: selectedModelId || providerModels[0]?.fullId,
      });
      setApiKeySaved(true);
      setApiKey('');
    } catch (error) {
      console.error('Failed to save API key:', error);
      setApiKeyError('Unable to save API key.');
    } finally {
      setSavingKey(false);
    }
  };

  const handleTestOllama = async () => {
    setOllamaStatus('testing');
    setOllamaError(null);
    try {
      const result = await accomplish.testOllamaConnection(ollamaUrl);
      if (!result.success || !result.models) {
        setOllamaStatus('error');
        setOllamaError(result.error || 'Unable to connect to Ollama.');
        return;
      }
      setOllamaModels(result.models);
      setSelectedOllamaModel(result.models[0]?.id || '');
      setOllamaStatus('success');
    } catch (error) {
      console.error('Ollama connection failed:', error);
      setOllamaStatus('error');
      setOllamaError('Unable to connect to Ollama.');
    }
  };

  const handleSaveOllama = async () => {
    if (!selectedOllamaModel) return;
    setOllamaStatus('testing');
    try {
      await accomplish.setOllamaConfig({
        baseUrl: ollamaUrl,
        enabled: true,
        models: ollamaModels,
        toolMode: 'off',
      });
      const selected: SelectedModel = {
        provider: 'ollama',
        model: `ollama/${selectedOllamaModel}`,
        baseUrl: ollamaUrl,
      };
      await accomplish.setSelectedModel(selected);
      setOllamaStatus('success');
    } catch (error) {
      console.error('Failed to save Ollama config:', error);
      setOllamaStatus('error');
      setOllamaError('Unable to save Ollama configuration.');
    }
  };

  const handleInstallSkill = async (skillId: string) => {
    setInstallingSkills((prev) => [...prev, skillId]);
    setSkillsError(null);
    try {
      await accomplish.installSkill(skillId);
      await refreshSkills();
    } catch (error) {
      console.error('Skill install failed:', error);
      setSkillsError('Failed to install skill dependencies.');
    } finally {
      setInstallingSkills((prev) => prev.filter((id) => id !== skillId));
    }
  };

  const handleInstallAllSkills = async () => {
    const installable = skills.filter((skill) => skill.installable).map((skill) => skill.id);
    setInstallingSkills(installable);
    setSkillsError(null);
    try {
      await accomplish.installAllSkills();
      await refreshSkills();
    } catch (error) {
      console.error('Skill install failed:', error);
      setSkillsError('Failed to install skill dependencies.');
    } finally {
      setInstallingSkills([]);
    }
  };

  const handleSaveBackground = async () => {
    setBackgroundSaving(true);
    try {
      await accomplish.setRunInBackground(runInBackground);
      await accomplish.setLaunchAtLogin(launchAtLogin);
    } catch (error) {
      console.error('Failed to save background settings:', error);
    } finally {
      setBackgroundSaving(false);
    }
  };

  const handleFinish = async () => {
    await handleSaveBackground();
    await accomplish.setOnboardingComplete(true);
    onComplete();
  };

  const renderStep = () => {
    switch (stepIndex) {
      case 0:
        return (
          <Card className="border-border/60 bg-background/70">
            <CardContent className="p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Rocket className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Welcome to Open Deskmate</h2>
                  <p className="text-sm text-muted-foreground">Let’s get your AI coworker ready.</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                  <div className="text-sm font-medium text-foreground">Local-first</div>
                  <p className="text-xs text-muted-foreground mt-1">Keep work on your machine.</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                  <div className="text-sm font-medium text-foreground">Bring your own model</div>
                  <p className="text-xs text-muted-foreground mt-1">API keys or Ollama.</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                  <div className="text-sm font-medium text-foreground">Automate tasks</div>
                  <p className="text-xs text-muted-foreground mt-1">Browser, files, and workflows.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      case 1:
        return (
          <Card className="border-border/60 bg-background/70">
            <CardContent className="p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <PlugZap className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Connect a model</h2>
                  <p className="text-sm text-muted-foreground">Choose cloud API keys or local Ollama.</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant={activeTab === 'cloud' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab('cloud')}
                >
                  Cloud API
                </Button>
                <Button
                  variant={activeTab === 'local' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab('local')}
                >
                  Local Ollama
                </Button>
              </div>

              {activeTab === 'cloud' ? (
                <div className="space-y-4">
                  {cloudProviders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No cloud providers configured yet. Add one in Settings.
                    </p>
                  ) : (
                    <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium text-foreground">Provider</label>
                      <select
                        className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={provider}
                        onChange={(e) => setProvider(e.target.value)}
                      >
                        {cloudProviders.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Model</label>
                      <select
                        className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={selectedModelId}
                        onChange={(e) => setSelectedModelId(e.target.value)}
                      >
                        {providerModels.map((model) => (
                          <option key={model.fullId} value={model.fullId}>{model.displayName}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">API key</label>
                    <Input
                      className="mt-2"
                      placeholder={KNOWN_API_KEY_FORMATS[provider]?.placeholder || 'Paste API key'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    {apiKeyError && <p className="mt-2 text-xs text-destructive">{apiKeyError}</p>}
                    {apiKeySaved && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        API key saved
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={handleSaveApiKey} disabled={savingKey}>
                      {savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save API key'}
                    </Button>
                    <Button variant="outline" onClick={() => setStepIndex(2)}>
                      Skip for now
                    </Button>
                  </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground">Ollama server URL</label>
                    <Input
                      className="mt-2"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleTestOllama} disabled={ollamaStatus === 'testing'}>
                      {ollamaStatus === 'testing' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test connection'}
                    </Button>
                    {ollamaStatus === 'success' && <Badge variant="secondary">Connected</Badge>}
                    {ollamaStatus === 'error' && <Badge variant="destructive">Failed</Badge>}
                  </div>
                  {ollamaError && <p className="text-xs text-destructive">{ollamaError}</p>}
                  {ollamaModels.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Select model</label>
                      <select
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={selectedOllamaModel}
                        onChange={(e) => setSelectedOllamaModel(e.target.value)}
                      >
                        {ollamaModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.displayName}</option>
                        ))}
                      </select>
                      <Button onClick={handleSaveOllama} disabled={!selectedOllamaModel}>
                        Use this model
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      case 2:
        return (
          <Card className="border-border/60 bg-background/70">
            <CardContent className="p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Wrench className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Install skills</h2>
                  <p className="text-sm text-muted-foreground">Enable browser automation and permissions.</p>
                </div>
              </div>

              {skillsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading skills...
                </div>
              ) : (
                <div className="space-y-3">
                  {skills.map((skill) => (
                    <div key={skill.id} className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">{skill.name}</div>
                        <p className="text-xs text-muted-foreground">{skill.description || 'Skill dependency bundle.'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {skill.installed ? (
                          <Badge variant="secondary">Installed</Badge>
                        ) : (
                          <Badge variant="outline">Not installed</Badge>
                        )}
                        {skill.installable && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={installingSkills.includes(skill.id)}
                            onClick={() => handleInstallSkill(skill.id)}
                          >
                            {installingSkills.includes(skill.id) ? 'Installing...' : 'Install'}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {skillsError && <p className="text-xs text-destructive">{skillsError}</p>}
              <div className="flex items-center gap-2">
                <Button variant="default" onClick={handleInstallAllSkills} disabled={installingSkills.length > 0}>
                  Install all
                </Button>
                <Button variant="outline" onClick={() => setStepIndex(3)}>
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      case 3:
        return (
          <Card className="border-border/60 bg-background/70">
            <CardContent className="p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Laptop className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Background mode</h2>
                  <p className="text-sm text-muted-foreground">Keep Open Deskmate ready for tasks.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">Run in background</div>
                    <p className="text-xs text-muted-foreground">Close the window but keep tasks running in the tray.</p>
                  </div>
                  <button
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      runInBackground ? 'bg-primary' : 'bg-muted'
                    }`}
                    onClick={() => setRunInBackground((prev) => !prev)}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        runInBackground ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">Launch at login</div>
                    <p className="text-xs text-muted-foreground">Start Open Deskmate automatically when you sign in.</p>
                  </div>
                  <button
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                      launchAtLogin ? 'bg-primary' : 'bg-muted'
                    }`}
                    onClick={() => setLaunchAtLogin((prev) => !prev)}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                        launchAtLogin ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={handleFinish} disabled={backgroundSaving}>
                  {backgroundSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Finish setup'}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-background p-10">
      <div className="w-full max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-foreground">Getting started</h1>
            <p className="text-sm text-muted-foreground">Step {stepIndex + 1} of {steps.length}</p>
          </div>
          <div className="flex items-center gap-2">
            {steps.map((step, index) => (
              <div
                key={step}
                className={`h-2.5 w-10 rounded-full ${index <= stepIndex ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
        </div>

        {renderStep()}

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
          >
            Back
          </Button>
          {stepIndex < steps.length - 1 && (
            <Button onClick={() => setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
