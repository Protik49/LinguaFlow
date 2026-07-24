import { useState, useEffect, useCallback, Component, type ReactNode } from "react";
import type { UserSettings, VocabularyEntry, ApiProvider, PageWord, TranslationResult } from "@shared/types";
import { LANGUAGE_OPTIONS } from "@shared/types";
import { MESSAGE_TYPES } from "@shared/constants";
import { vocabToCSV, parseVocabularyImport, generateVocabularyId } from "@shared/storage";

type Tab = "words" | "setup" | "vocab";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-48 px-4 text-center bg-surface-base text-text-primary">
          <h1 className="text-sm font-semibold text-text-primary mb-2">Something went wrong</h1>
          <p className="text-xs text-text-inverse mb-3">LinguaFlow encountered an error. Try reloading the popup.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-3 py-1.5 text-xs font-semibold bg-surface-raised hover:bg-opacity-90 text-text-secondary rounded-md"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface WordCardProps {
  word: PageWord;
  targetLanguage: string;
  onSave: (entry: VocabularyEntry) => void;
}

function WordCard({ word: pw, targetLanguage, onSave }: WordCardProps) {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleClick = async () => {
    if (expanded && result) {
      setExpanded(false);
      return;
    }
    setExpanded(true);

    if (result || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await new Promise<TranslationResult>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: MESSAGE_TYPES.TRANSLATE_WORD, payload: { word: pw.word, context: pw.context, targetLanguage } },
          (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (response?.success) resolve(response.data as TranslationResult);
            else reject(new Error(response?.error || "Translation failed"));
          }
        );
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!result) return;
    setSaved(true);
    onSave({
      id: generateVocabularyId(),
      word: pw.word,
      translation: result.translation,
      definition: result.definition,
      pronunciation: result.pronunciation,
      synonym: result.synonym,
      context: pw.context,
      sourceUrl: window.location.href,
      targetLanguage: targetLanguage as VocabularyEntry["targetLanguage"],
      savedAt: Date.now(),
      reviewCount: 0,
      nextReviewAt: Date.now() + 24 * 60 * 60 * 1000,
      forms: result.forms,
    });
  };

  return (
    <div
      className={`bg-[#050505] border border-border-strong glow-green-hover ${
        expanded ? "rounded-xs border-text-inverse/45 shadow-[0_0_12px_rgba(92,224,134,0.06)]" : "rounded-md"
      }`}
    >
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-2 px-space-6 py-space-5 text-left min-h-[36px] focus-visible:outline-none"
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" className={`flex-shrink-0 text-text-inverse transition-transform duration-fast ${expanded ? "rotate-90 text-surface-raised" : ""}`}
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-xs font-medium text-text-primary">{pw.word}</span>
        {result && (
          <span className="text-surface-raised text-xs truncate ml-auto">
            {result.translation}
          </span>
        )}
        {loading && (
          <span className="text-[10px] text-text-inverse ml-auto">Translating...</span>
        )}
      </button>

      {expanded && (
        <div className="px-space-6 pb-space-6 pt-0 space-y-space-5">
          {loading && (
            <div className="flex items-center gap-space-4 text-xs text-text-inverse">
              <div className="w-3 h-3 border-2 border-border-strong border-t-surface-raised rounded-full animate-spin" />
              Translating...
            </div>
          )}
          {error && (
            <div className="text-xs text-red-500">{error}</div>
          )}
          {result && (
            <>
              {result.translation && (
                <div className="text-sm font-medium text-text-primary">{result.translation}</div>
              )}
              {result.definition && (
                <div className="text-[11px] text-text-inverse italic">{result.definition}</div>
              )}
              <div className="flex gap-space-4 flex-wrap">
                {result.pronunciation && (
                  <span className="text-[10px] text-text-inverse bg-[#0f110a] border border-border-strong px-1.5 py-0.5 rounded-xs">
                    /{result.pronunciation}/
                  </span>
                )}
                {result.synonym && (
                  <span className="text-[10px] text-text-inverse bg-[#0f110a] border border-border-strong px-1.5 py-0.5 rounded-xs">
                    ≈ {result.synonym}
                  </span>
                )}
              </div>
              {result.forms && (result.forms.verb || result.forms.adjective || result.forms.noun || result.forms.adverb) && (
                <div className="space-y-space-3 pt-space-5 border-t border-border-strong">
                  <div className="text-[9px] font-semibold text-text-inverse uppercase tracking-wider">Other Forms</div>
                  <div className="grid grid-cols-2 gap-space-3 text-[10px]">
                    {result.forms.verb && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-blue-400 font-medium bg-blue-950/30 border border-blue-900/40 px-1 py-0.2 rounded-xs text-[9px]">verb</span>
                        <span className="text-text-primary truncate">{result.forms.verb}</span>
                      </div>
                    )}
                    {result.forms.adjective && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-400 font-medium bg-amber-950/30 border border-amber-900/40 px-1 py-0.2 rounded-xs text-[9px]">adj</span>
                        <span className="text-text-primary truncate">{result.forms.adjective}</span>
                      </div>
                    )}
                    {result.forms.noun && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-emerald-400 font-medium bg-emerald-950/30 border border-emerald-900/40 px-1 py-0.2 rounded-xs text-[9px]">noun</span>
                        <span className="text-text-primary truncate">{result.forms.noun}</span>
                      </div>
                    )}
                    {result.forms.adverb && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-purple-400 font-medium bg-purple-950/30 border border-purple-900/40 px-1 py-0.2 rounded-xs text-[9px]">adv</span>
                        <span className="text-text-primary truncate">{result.forms.adverb}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <button
                onClick={handleSave}
                disabled={saved}
                className={`w-full py-1.5 text-xs font-semibold rounded-md transition-colors min-h-[28px] ${
                  saved
                    ? "border border-surface-raised text-surface-raised bg-transparent cursor-default"
                    : "bg-surface-raised hover:bg-opacity-90 text-text-secondary"
                }`}
              >
                {saved ? "Saved" : "Save to Vocabulary"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AppContent() {
  const [tab, setTab] = useState<Tab>("words");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showOpenrouterKey, setShowOpenrouterKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [vocab, setVocab] = useState<VocabularyEntry[]>([]);
  const [vocabFilter, setVocabFilter] = useState("");
  const [errors, setErrors] = useState<{ message: string; time: string }[]>([]);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [pageWords, setPageWords] = useState<PageWord[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [vocabLoaded, setVocabLoaded] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.success) {
        const data = res.data as UserSettings;
        setSettings(data);
        setOpenrouterKey(data.openrouterApiKey || "");
        setGeminiKey(data.geminiApiKey || "");
        if (!data.onboarded) {
          setShowOnboarding(true);
        }
      }
    });
    chrome.storage.local.get("linguaflow_vocabulary", (result) => {
      setVocab(result.linguaflow_vocabulary || []);
    });
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_ERRORS }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.success) setErrors(res.data || []);
    });
  }, []);

  const fetchPageWords = useCallback(() => {
    setPageLoading(true);
    setPageError(null);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        setPageError("No active tab found");
        setPageLoading(false);
        return;
      }
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: MESSAGE_TYPES.GET_PAGE_VOCAB },
        (res) => {
          if (chrome.runtime.lastError) {
            setPageError("Extension not loaded on this page. Try a regular webpage.");
            setPageLoading(false);
            return;
          }
          if (res?.success) {
            setPageWords(res.data as PageWord[]);
          } else {
            setPageError(res?.error || "Failed to extract words");
          }
          setPageLoading(false);
        }
      );
    });
  }, []);

  const showStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), 2000);
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
      if (!settings) return;
      const updated = { ...settings, [key]: value };
      setSettings(updated);
      chrome.storage.local.set({ linguaflow_settings: updated });
      showStatus("Saved!");
    },
    [settings, showStatus]
  );

  const saveKeys = () => {
    chrome.storage.local.get("linguaflow_settings", (result) => {
      const current = result.linguaflow_settings || {};
      chrome.storage.local.set({
        linguaflow_settings: { ...current, openrouterApiKey: openrouterKey, geminiApiKey: geminiKey },
      });
      showStatus("API keys saved!");
    });
  };

  const clearCache = () => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CACHE_CLEAR }, () => {
      if (chrome.runtime.lastError) return;
      showStatus("Cache cleared!");
    });
  };

  const testConnection = () => {
    setTestStatus("testing");
    setTestMsg("Testing...");
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.TEST_CONNECTION }, (res) => {
      if (chrome.runtime.lastError) { setTestStatus("fail"); setTestMsg("Background unavailable"); return; }
      if (res?.success) {
        if (res.data.success) { setTestStatus("ok"); setTestMsg(res.data.message); }
        else { setTestStatus("fail"); setTestMsg(res.data.message); }
      } else {
        setTestStatus("fail");
        setTestMsg(res?.error || "Test failed");
      }
    });
  };

  const clearErrors = () => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_ERRORS }, () => {
      if (chrome.runtime.lastError) return;
      setErrors([]);
      showStatus("Errors cleared!");
    });
  };

  const removeVocabEntry = (id: string) => {
    const updated = vocab.filter((v) => v.id !== id);
    setVocab(updated);
    chrome.storage.local.set({ linguaflow_vocabulary: updated });
  };

  const clearVocab = () => {
    chrome.storage.local.set({ linguaflow_vocabulary: [] });
    setVocab([]);
    showStatus("Vocabulary cleared!");
  };

  const exportVocab = (format: "json" | "csv") => {
    const data = format === "json" ? JSON.stringify(vocab, null, 2) : vocabToCSV(vocab);
    const blob = new Blob([data], { type: format === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `linguaflow-vocabulary.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus(`Exported ${format.toUpperCase()}!`);
  };

  const importVocab = (format: "json" | "csv") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = format === "json" ? ".json" : ".csv";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const entries = parseVocabularyImport(text, format);
      if (entries.length === 0) {
        showStatus("No valid entries found");
        return;
      }
      chrome.runtime.sendMessage(
        { type: MESSAGE_TYPES.IMPORT_VOCABULARY, payload: entries },
        (res) => {
          if (chrome.runtime.lastError) return;
          if (res?.success) {
            const { imported, skipped } = res.data as { imported: number; skipped: number };
            showStatus(`Imported ${imported}, skipped ${skipped}`);
            chrome.storage.local.get("linguaflow_vocabulary", (result) => {
              setVocab(result.linguaflow_vocabulary || []);
            });
          }
        }
      );
    };
    input.click();
  };

  const handleSaveWord = (entry: VocabularyEntry) => {
    chrome.runtime.sendMessage(
      { type: MESSAGE_TYPES.SAVE_VOCABULARY, payload: entry },
      (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.success) {
          const updated = [entry, ...vocab];
          setVocab(updated);
          chrome.storage.local.set({ linguaflow_vocabulary: updated });
        }
      }
    );
  };

  const completeOnboarding = () => {
    setShowOnboarding(false);
    if (settings) {
      updateSetting("onboarded", true);
    }
  };

  const filteredVocab = vocabFilter
    ? vocab.filter(
        (v) =>
          v.word.toLowerCase().includes(vocabFilter.toLowerCase()) ||
          v.translation.toLowerCase().includes(vocabFilter.toLowerCase())
      )
    : vocab;

  if (showOnboarding && settings && !settings.onboarded) {
    return (
      <div className="flex flex-col w-[380px] p-6 space-y-4 bg-surface-base text-text-primary">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-md bg-surface-raised flex items-center justify-center">
            <span className="text-text-secondary font-bold text-lg">L</span>
          </div>
          <div>
            <h1 className="text-md font-semibold text-text-primary">Welcome to LinguaFlow</h1>
            <p className="text-xs text-text-inverse">Let&apos;s get you set up</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="onboard-provider" className="block text-[10px] font-medium text-text-inverse mb-1.5 uppercase tracking-wider">
              Choose API Provider
            </label>
            <div className="flex gap-1.5">
              {([
                { value: "openrouter" as ApiProvider, label: "OpenRouter" },
                { value: "gemini" as ApiProvider, label: "Gemini API" },
              ]).map((prov) => (
                <button
                  key={prov.value}
                  onClick={() => updateSetting("apiProvider", prov.value)}
                  className={`flex-1 py-2 text-xs rounded-md border transition-colors duration-fast ${
                    settings.apiProvider === prov.value
                      ? "border-surface-raised bg-[#0f110a] text-surface-raised font-semibold"
                      : "border-border-strong text-text-inverse hover:border-text-inverse hover:text-text-primary"
                  }`}
                >
                  {prov.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="onboard-lang" className="block text-[10px] font-medium text-text-inverse mb-1.5 uppercase tracking-wider">
              Target Language
            </label>
            <select
              id="onboard-lang"
              value={settings.targetLanguage}
              onChange={(e) => updateSetting("targetLanguage", e.target.value as UserSettings["targetLanguage"])}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border-strong bg-surface-base text-text-primary focus:border-surface-raised focus:ring-1 focus:ring-surface-raised outline-none cursor-pointer"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-surface-base">{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="onboard-key" className="block text-[10px] font-medium text-text-inverse mb-1.5 uppercase tracking-wider">
              API Key
            </label>
            <p className="text-[10px] text-text-inverse mb-1.5">
              {settings.apiProvider === "openrouter" ? (
                <>Get a free key at <a href="https://openrouter.ai/keys" target="_blank" className="text-surface-raised underline" rel="noreferrer">openrouter.ai/keys</a></>
              ) : (
                <>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" className="text-surface-raised underline" rel="noreferrer">aistudio.google.com/apikey</a></>
              )}
            </p>
            <input
              id="onboard-key"
              type="password"
              value={settings.apiProvider === "openrouter" ? openrouterKey : geminiKey}
              onChange={(e) => {
                if (settings.apiProvider === "openrouter") setOpenrouterKey(e.target.value);
                else setGeminiKey(e.target.value);
              }}
              placeholder={settings.apiProvider === "openrouter" ? "sk-or-v1-..." : "AIza..."}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border-strong bg-surface-base text-text-primary focus:border-surface-raised focus:ring-1 focus:ring-surface-raised outline-none font-mono"
            />
          </div>
        </div>

        <button
          onClick={() => { saveKeys(); completeOnboarding(); }}
          className="w-full py-2 text-xs font-semibold bg-surface-raised hover:bg-opacity-90 text-text-secondary rounded-md transition-colors duration-fast shadow-sm"
        >
          Start Learning
        </button>
        <button
          onClick={completeOnboarding}
          className="w-full py-1.5 text-[11px] text-text-inverse hover:text-text-primary transition-colors duration-fast"
        >
          Skip for now
        </button>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-48 bg-surface-base">
        <div className="w-5 h-5 border-2 border-border-strong border-t-surface-raised rounded-full animate-spin" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[380px] max-h-[520px] bg-surface-base text-text-primary">
      <header className="px-4 py-3 border-b border-border-strong flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-surface-raised flex items-center justify-center">
            <span className="text-text-secondary font-bold text-xs">L</span>
          </div>
          <h1 className="font-semibold text-xs text-text-primary tracking-wide">LinguaFlow</h1>
        </div>
        <div className="flex items-center gap-2">
          {statusMsg && (
            <span className="text-[10px] text-surface-raised font-medium animate-fade-in" role="status" aria-live="polite">{statusMsg}</span>
          )}
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={settings.enabled} onChange={() => {
              const updated = { ...settings, enabled: !settings.enabled };
              setSettings(updated);
              chrome.storage.local.set({ linguaflow_settings: updated });
            }} aria-label="Toggle extension" />
            <div className="w-9 h-5 bg-border-strong rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-text-inverse after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-surface-raised peer-checked:after:bg-text-secondary" />
          </label>
        </div>
      </header>

      <nav className="flex border-b border-border-strong flex-shrink-0" role="tablist" aria-label="Main navigation">
        {([
          { id: "words" as Tab, label: `Words (${pageWords.length})` },
          { id: "setup" as Tab, label: "Setup" },
          { id: "vocab" as Tab, label: `Vocab${vocab.length ? ` (${vocab.length})` : ""}` },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            role="tab"
            aria-selected={tab === t.id}
            className={`flex-1 py-2.5 text-xs font-semibold transition-all duration-fast ${
              tab === t.id
                ? "text-surface-raised border-b-2 border-surface-raised tab-active-glow bg-[#050505]/40"
                : "text-text-inverse hover:text-text-primary hover:bg-[#060604]/40"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="overflow-y-auto flex-1" role="tabpanel">
        {tab === "words" && (
          <div className="px-4 py-3 space-y-3">
            <div className="pb-2 border-b border-border-strong">
              <label htmlFor="target-lang" className="block text-[10px] font-semibold text-text-inverse mb-1.5 uppercase tracking-wider">
                Target Language
              </label>
              <select
                id="target-lang"
                value={settings.targetLanguage}
                onChange={(e) => updateSetting("targetLanguage", e.target.value as UserSettings["targetLanguage"])}
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border-strong bg-surface-base text-text-primary focus:border-surface-raised focus:ring-1 focus:ring-surface-raised outline-none cursor-pointer"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-surface-base">{opt.label}</option>
                ))}
              </select>
            </div>

            {!vocabLoaded && !pageLoading && (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center space-y-4 rounded-md border border-border-strong bg-[#030303] my-2">
                <div className="relative w-16 h-16 rounded-full border border-border-strong flex items-center justify-center bg-[#090b05] text-surface-raised">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">Ready to scan page</h3>
                  <p className="text-[11px] text-text-inverse max-w-[240px] leading-relaxed">
                    Click below to scan the active page text and extract vocabulary matching your difficulty level.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setVocabLoaded(true);
                    fetchPageWords();
                  }}
                  className="px-5 py-2 text-xs font-bold bg-surface-raised hover:bg-opacity-90 text-text-secondary rounded-md transition-colors duration-fast shadow-sm"
                >
                  Load Vocabulary
                </button>
              </div>
            )}

            {pageLoading && (
              <div className="relative flex flex-col justify-center py-12 px-6 overflow-hidden rounded-md border border-border-strong bg-[#030303] min-h-[220px]">
                {/* Scanner vertical line effect */}
                <div className="scanner-line" />
                
                <div className="space-y-4 relative z-10">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-surface-raised uppercase tracking-wider animate-pulse">Scanning Active Page...</span>
                    <span className="text-[9px] text-text-inverse font-mono">EST: 1-2s</span>
                  </div>
                  
                  {/* Beautiful Skeleton layout */}
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1.5 opacity-40">
                      <div className="h-3 w-1/3 bg-text-inverse rounded-xs animate-pulse" />
                      <div className="h-2 w-3/4 bg-border-strong rounded-xs animate-pulse" />
                    </div>
                    <div className="space-y-1.5 opacity-60">
                      <div className="h-3 w-1/4 bg-text-inverse rounded-xs animate-pulse" style={{ animationDelay: '0.2s' }} />
                      <div className="h-2 w-5/6 bg-border-strong rounded-xs animate-pulse" style={{ animationDelay: '0.2s' }} />
                    </div>
                    <div className="space-y-1.5 opacity-80">
                      <div className="h-3 w-1/2 bg-text-inverse rounded-xs animate-pulse" style={{ animationDelay: '0.4s' }} />
                      <div className="h-2 w-2/3 bg-border-strong rounded-xs animate-pulse" style={{ animationDelay: '0.4s' }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {vocabLoaded && !pageLoading && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-[10px] font-semibold text-text-inverse uppercase tracking-wider">
                    Page Vocabulary
                  </h2>
                  <button
                    onClick={fetchPageWords}
                    className="text-[10px] text-surface-raised hover:underline font-semibold"
                  >
                    Refresh
                  </button>
                </div>

                {pageError && (
                  <div className="text-center py-8">
                    <p className="text-xs text-text-inverse">{pageError}</p>
                  </div>
                )}

                {!pageError && pageWords.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-xs text-text-inverse">
                      No vocabulary words found on this page. Try a page with more text content.
                    </p>
                  </div>
                )}

                {!pageError && pageWords.length > 0 && (
                  <div className="space-y-space-6 max-h-[360px] overflow-y-auto pr-0.5">
                    {pageWords.map((pw, i) => (
                      <WordCard
                        key={`${pw.word}-${i}`}
                        word={pw}
                        targetLanguage={settings.targetLanguage}
                        onSave={handleSaveWord}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "setup" && (
          <div className="px-4 py-3 space-y-3">
            <fieldset>
              <legend className="block text-[10px] font-semibold text-text-inverse mb-1.5 uppercase tracking-wider">
                Difficulty
              </legend>
              <div className="space-y-1">
                {([
                  { value: "beginner" as const, label: "Beginner", desc: "Many words" },
                  { value: "intermediate" as const, label: "Intermediate", desc: "Uncommon words" },
                  { value: "advanced" as const, label: "Advanced", desc: "Rare vocabulary" },
                ]).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer border transition-colors duration-fast ${
                      settings.difficulty === opt.value
                        ? "border-surface-raised bg-[#0f110a] text-text-primary"
                        : "border-border-strong text-text-inverse hover:border-text-inverse"
                    }`}
                  >
                    <input
                      type="radio" name="difficulty" value={opt.value}
                      checked={settings.difficulty === opt.value}
                      onChange={() => updateSetting("difficulty", opt.value)}
                      className="sr-only"
                    />
                    <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${settings.difficulty === opt.value ? "border-surface-raised" : "border-text-inverse"}`} aria-hidden="true">
                      {settings.difficulty === opt.value && <span className="w-2 h-2 rounded-full bg-surface-raised" />}
                    </span>
                    <div>
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className="text-[10px] opacity-80">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="block text-[10px] font-semibold text-text-inverse mb-1.5 uppercase tracking-wider">
                API Provider
              </legend>
              <div className="flex gap-1.5">
                {([
                  { value: "openrouter" as ApiProvider, label: "OpenRouter" },
                  { value: "gemini" as ApiProvider, label: "Gemini API" },
                ]).map((prov) => (
                  <button
                    key={prov.value}
                    onClick={() => updateSetting("apiProvider", prov.value)}
                    className={`flex-1 py-1.5 text-xs rounded-md border transition-colors duration-fast ${
                      settings.apiProvider === prov.value
                        ? "border-surface-raised bg-[#0f110a] text-surface-raised font-semibold"
                        : "border-border-strong text-text-inverse hover:border-text-inverse hover:text-text-primary"
                    }`}
                  >
                    {prov.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="openrouter-key" className="block text-[10px] font-semibold text-text-inverse mb-1 uppercase tracking-wider">
                OpenRouter API Key
              </label>
              <p className="text-[10px] text-text-inverse mb-1.5">
                Get a free key at{" "}
                <a href="https://openrouter.ai/keys" target="_blank" className="text-surface-raised underline" rel="noreferrer">
                  openrouter.ai/keys
                </a>
              </p>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input
                    id="openrouter-key"
                    type={showOpenrouterKey ? "text" : "password"}
                    value={openrouterKey}
                    onChange={(e) => setOpenrouterKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full px-2.5 py-1.5 pr-12 text-[11px] rounded-md border border-border-strong bg-surface-base text-text-primary focus:border-surface-raised focus:ring-1 focus:ring-surface-raised outline-none font-mono"
                  />
                  <button
                    onClick={() => setShowOpenrouterKey(!showOpenrouterKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-inverse hover:text-text-primary min-w-[28px] min-h-[24px]"
                    aria-label={showOpenrouterKey ? "Hide OpenRouter key" : "Show OpenRouter key"}
                  >
                    {showOpenrouterKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="gemini-key" className="block text-[10px] font-semibold text-text-inverse mb-1 uppercase tracking-wider">
                Gemini API Key
              </label>
              <p className="text-[10px] text-text-inverse mb-1.5">
                Get a free key at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" className="text-surface-raised underline" rel="noreferrer">
                  aistudio.google.com
                </a>
              </p>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input
                    id="gemini-key"
                    type={showGeminiKey ? "text" : "password"}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIza..."
                    className="w-full px-2.5 py-1.5 pr-12 text-[11px] rounded-md border border-border-strong bg-surface-base text-text-primary focus:border-surface-raised focus:ring-1 focus:ring-surface-raised outline-none font-mono"
                  />
                  <button
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-inverse hover:text-text-primary min-w-[28px] min-h-[24px]"
                    aria-label={showGeminiKey ? "Hide Gemini key" : "Show Gemini key"}
                  >
                    {showGeminiKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={saveKeys}
              className="w-full py-1.5 text-xs font-semibold bg-surface-raised hover:bg-opacity-90 text-text-secondary rounded-md transition-colors duration-fast min-h-[28px]"
            >
              Save Keys
            </button>

            <div className="border-t border-border-strong pt-3 space-y-1.5">
              <div className="flex gap-1.5">
                <button
                  onClick={testConnection}
                  disabled={testStatus === "testing"}
                  className="flex-1 py-1.5 text-xs font-semibold border border-border-strong rounded-md hover:border-text-inverse text-text-primary transition-colors duration-fast disabled:opacity-50 min-h-[28px]"
                >
                  {testStatus === "testing" ? "Testing..." : "Test Connection"}
                </button>
                <button
                  onClick={clearCache}
                  className="flex-1 py-1.5 text-xs font-semibold text-red-500 border border-red-950/60 rounded-md hover:bg-red-950/20 transition-colors duration-fast min-h-[28px]"
                >
                  Clear Cache
                </button>
              </div>
              {testMsg && (
                <div className={`mt-1.5 px-2 py-1 rounded-md text-[10px] font-mono break-all border ${
                  testStatus === "ok"
                    ? "bg-green-950/20 border-green-900/50 text-green-400"
                    : "bg-red-950/20 border-red-900/50 text-red-400"
                }`} role="alert">
                  {testMsg}
                </div>
              )}
            </div>

            {errors.length > 0 && (
              <div className="border-t border-border-strong pt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <h2 className="text-[10px] font-semibold text-text-inverse uppercase tracking-wider">
                    Errors ({errors.length})
                  </h2>
                  <button onClick={clearErrors} className="text-[10px] text-text-inverse hover:text-red-500 min-w-[28px] min-h-[24px]">
                    Clear
                  </button>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {errors.slice(0, 10).map((err, i) => (
                    <div key={i} className="px-2 py-1 rounded-md bg-red-950/20 border border-red-900/40 text-[10px] font-mono text-red-400 break-all">
                      <span className="text-red-500 mr-1">{err.time}</span>
                      {err.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "vocab" && (
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-semibold text-text-inverse uppercase tracking-wider">
                Saved ({vocab.length})
              </h2>
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => importVocab("json")}
                  className="px-2 py-1 text-[10px] border border-border-strong rounded-md text-text-inverse hover:border-text-inverse hover:text-text-primary min-h-[24px]"
                  aria-label="Import vocabulary from JSON file"
                >
                  Import
                </button>
                <button
                  onClick={() => exportVocab("json")}
                  disabled={vocab.length === 0}
                  className="px-2 py-1 text-[10px] border border-border-strong rounded-md text-text-inverse hover:border-text-inverse hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed min-h-[24px]"
                  aria-label="Export vocabulary as JSON"
                >
                  JSON
                </button>
                <button
                  onClick={() => exportVocab("csv")}
                  disabled={vocab.length === 0}
                  className="px-2 py-1 text-[10px] border border-border-strong rounded-md text-text-inverse hover:border-text-inverse hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed min-h-[24px]"
                  aria-label="Export vocabulary as CSV"
                >
                  CSV
                </button>
                <button
                  onClick={clearVocab}
                  disabled={vocab.length === 0}
                  className="px-2 py-1 text-[10px] border border-red-900/60 rounded-md text-red-500 hover:bg-red-950/20 disabled:opacity-30 disabled:cursor-not-allowed min-h-[24px]"
                  aria-label="Clear all vocabulary"
                >
                  Clear
                </button>
              </div>
            </div>

            {vocab.length > 0 && (
              <div>
                <label htmlFor="vocab-filter" className="sr-only">Filter vocabulary</label>
                <input
                  id="vocab-filter"
                  type="text"
                  value={vocabFilter}
                  onChange={(e) => setVocabFilter(e.target.value)}
                  placeholder="Filter..."
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border-strong bg-surface-base text-text-primary focus:border-surface-raised focus:ring-1 focus:ring-surface-raised outline-none"
                />
              </div>
            )}

            {filteredVocab.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-text-inverse">
                  {vocab.length === 0
                    ? "Open the Words tab, click a word, and save it to your vocabulary."
                    : "No words match your filter."}
                </p>
              </div>
            ) : (
              <div className="space-y-space-6 max-h-60 overflow-y-auto">
                {filteredVocab.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border-strong hover:border-text-inverse transition-colors duration-fast"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-text-primary truncate">{entry.word}</span>
                        <span className="text-surface-raised text-xs font-semibold truncate">→ {entry.translation}</span>
                      </div>
                      {entry.pronunciation && (
                        <span className="text-[10px] text-text-inverse">/{entry.pronunciation}/</span>
                      )}
                      {entry.forms && (entry.forms.verb || entry.forms.adjective || entry.forms.noun || entry.forms.adverb) && (
                        <div className="flex gap-1.5 flex-wrap mt-1">
                          {entry.forms.verb && (
                            <span className="text-[9px] bg-blue-950/30 border border-blue-900/40 text-blue-400 px-1 py-0.2 rounded-xs" title={`Verb: ${entry.forms.verb}`}>
                              v: {entry.forms.verb}
                            </span>
                          )}
                          {entry.forms.adjective && (
                            <span className="text-[9px] bg-amber-950/30 border border-amber-900/40 text-amber-400 px-1 py-0.2 rounded-xs" title={`Adjective: ${entry.forms.adjective}`}>
                              adj: {entry.forms.adjective}
                            </span>
                          )}
                          {entry.forms.noun && (
                            <span className="text-[9px] bg-emerald-950/30 border border-emerald-900/40 text-emerald-400 px-1 py-0.2 rounded-xs" title={`Noun: ${entry.forms.noun}`}>
                              n: {entry.forms.noun}
                            </span>
                          )}
                          {entry.forms.adverb && (
                            <span className="text-[9px] bg-purple-950/30 border border-purple-900/40 text-purple-400 px-1 py-0.2 rounded-xs" title={`Adverb: ${entry.forms.adverb}`}>
                              adv: {entry.forms.adverb}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeVocabEntry(entry.id)}
                      className="text-text-inverse hover:text-red-500 flex-shrink-0 p-1 min-w-[24px] min-h-[24px] flex items-center justify-center"
                      aria-label={`Remove ${entry.word} from vocabulary`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
