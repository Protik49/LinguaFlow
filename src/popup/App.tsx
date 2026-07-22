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
        <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Something went wrong</h1>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">LinguaFlow encountered an error. Try reloading the popup.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-3 py-1.5 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-lg"
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
    });
  };

  return (
    <div
      className={`rounded-lg border transition-colors ${
        expanded ? "border-brand-300 dark:border-brand-700" : "border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700"
      }`}
    >
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-2 px-3 py-2 text-left min-h-[36px]"
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" className={`flex-shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-xs font-medium text-gray-900 dark:text-white">{pw.word}</span>
        {result && (
          <span className="text-brand-600 dark:text-brand-400 text-xs truncate ml-auto">
            {result.translation}
          </span>
        )}
        {loading && (
          <span className="text-[10px] text-gray-400 ml-auto">Translating...</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <div className="w-3 h-3 border-2 border-gray-300 dark:border-gray-600 border-t-brand-500 rounded-full animate-spin" />
              Translating...
            </div>
          )}
          {error && (
            <div className="text-xs text-red-500">{error}</div>
          )}
          {result && (
            <>
              {result.translation && (
                <div className="text-sm font-medium text-gray-900 dark:text-white">{result.translation}</div>
              )}
              {result.definition && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 italic">{result.definition}</div>
              )}
              <div className="flex gap-2 flex-wrap">
                {result.pronunciation && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                    /{result.pronunciation}/
                  </span>
                )}
                {result.synonym && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                    ≈ {result.synonym}
                  </span>
                )}
              </div>
              <button
                onClick={handleSave}
                disabled={saved}
                className={`w-full py-1.5 text-xs font-medium rounded-lg transition-colors min-h-[28px] ${
                  saved
                    ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 cursor-default"
                    : "bg-brand-500 hover:bg-brand-600 text-white"
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
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
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

  useEffect(() => {
    fetchPageWords();
  }, [fetchPageWords]);

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
      <div className="flex flex-col w-[380px] p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center">
            <span className="text-white font-bold text-lg">L</span>
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900 dark:text-white">Welcome to LinguaFlow</h1>
            <p className="text-xs text-gray-600 dark:text-gray-400">Let&apos;s get you set up</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="onboard-provider" className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wider">
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
                  className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                    settings.apiProvider === prov.value
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-400 font-medium"
                      : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                  }`}
                >
                  {prov.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="onboard-lang" className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wider">
              Target Language
            </label>
            <select
              id="onboard-lang"
              value={settings.targetLanguage}
              onChange={(e) => updateSetting("targetLanguage", e.target.value as UserSettings["targetLanguage"])}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="onboard-key" className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wider">
              API Key
            </label>
            <p className="text-[10px] text-gray-600 dark:text-gray-400 mb-1.5">
              {settings.apiProvider === "openrouter" ? (
                <>Get a free key at <a href="https://openrouter.ai/keys" target="_blank" className="text-brand-500 underline" rel="noreferrer">openrouter.ai/keys</a></>
              ) : (
                <>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" className="text-brand-500 underline" rel="noreferrer">aistudio.google.com/apikey</a></>
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
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
            />
          </div>
        </div>

        <button
          onClick={() => { saveKeys(); completeOnboarding(); }}
          className="w-full py-2.5 text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white rounded-xl transition-colors shadow-sm"
        >
          Start Learning
        </button>
        <button
          onClick={completeOnboarding}
          className="w-full py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
        >
          Skip for now
        </button>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-5 h-5 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[380px] max-h-[520px]">
      <header className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center">
            <span className="text-white font-bold text-xs">L</span>
          </div>
          <h1 className="font-semibold text-sm text-gray-900 dark:text-white">LinguaFlow</h1>
        </div>
        <div className="flex items-center gap-2">
          {statusMsg && (
            <span className="text-[10px] text-green-600 dark:text-green-400 font-medium animate-fade-in" role="status" aria-live="polite">{statusMsg}</span>
          )}
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={settings.enabled} onChange={() => {
              const updated = { ...settings, enabled: !settings.enabled };
              setSettings(updated);
              chrome.storage.local.set({ linguaflow_settings: updated });
            }} aria-label="Toggle extension" />
            <div className="w-9 h-5 bg-gray-300 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500" />
          </label>
        </div>
      </header>

      <nav className="flex border-b border-gray-100 dark:border-gray-800 flex-shrink-0" role="tablist" aria-label="Main navigation">
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
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? "text-brand-600 dark:text-brand-400 border-b-2 border-brand-500"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="overflow-y-auto flex-1" role="tabpanel">
        {tab === "words" && (
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Page Vocabulary
              </h2>
              <button
                onClick={fetchPageWords}
                className="text-[10px] text-brand-600 dark:text-brand-400 hover:underline"
              >
                Refresh
              </button>
            </div>

            {pageLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" role="status" aria-label="Loading words" />
              </div>
            )}

            {pageError && (
              <div className="text-center py-8">
                <p className="text-xs text-gray-500 dark:text-gray-400">{pageError}</p>
              </div>
            )}

            {!pageLoading && !pageError && pageWords.length === 0 && (
              <div className="text-center py-8">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No vocabulary words found on this page. Try a page with more text content.
                </p>
              </div>
            )}

            {!pageLoading && !pageError && pageWords.length > 0 && (
              <div className="space-y-1 max-h-[360px] overflow-y-auto pr-0.5">
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
          </div>
        )}

        {tab === "setup" && (
          <div className="px-4 py-3 space-y-3">
            <div>
              <label htmlFor="target-lang" className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wider">
                Target Language
              </label>
              <select
                id="target-lang"
                value={settings.targetLanguage}
                onChange={(e) => updateSetting("targetLanguage", e.target.value as UserSettings["targetLanguage"])}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none cursor-pointer"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <fieldset>
              <legend className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wider">
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
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer border transition-colors ${
                      settings.difficulty === opt.value
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-950"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio" name="difficulty" value={opt.value}
                      checked={settings.difficulty === opt.value}
                      onChange={() => updateSetting("difficulty", opt.value)}
                      className="sr-only"
                    />
                    <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${settings.difficulty === opt.value ? "border-brand-500" : "border-gray-400 dark:border-gray-500"}`} aria-hidden="true">
                      {settings.difficulty === opt.value && <span className="w-2 h-2 rounded-full bg-brand-500" />}
                    </span>
                    <div>
                      <div className="text-xs font-medium text-gray-900 dark:text-white">{opt.label}</div>
                      <div className="text-[10px] text-gray-600 dark:text-gray-400">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wider">
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
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                      settings.apiProvider === prov.value
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-400 font-medium"
                        : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                    }`}
                  >
                    {prov.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="openrouter-key" className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wider">
                OpenRouter API Key
              </label>
              <p className="text-[10px] text-gray-600 dark:text-gray-400 mb-2">
                Get a free key at{" "}
                <a href="https://openrouter.ai/keys" target="_blank" className="text-brand-500 underline" rel="noreferrer">
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
                    className="w-full px-2.5 py-1.5 pr-12 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
                  />
                  <button
                    onClick={() => setShowOpenrouterKey(!showOpenrouterKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 min-w-[28px] min-h-[24px]"
                    aria-label={showOpenrouterKey ? "Hide OpenRouter key" : "Show OpenRouter key"}
                  >
                    {showOpenrouterKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="gemini-key" className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wider">
                Gemini API Key
              </label>
              <p className="text-[10px] text-gray-600 dark:text-gray-400 mb-2">
                Get a free key at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" className="text-brand-500 underline" rel="noreferrer">
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
                    className="w-full px-2.5 py-1.5 pr-12 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
                  />
                  <button
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 min-w-[28px] min-h-[24px]"
                    aria-label={showGeminiKey ? "Hide Gemini key" : "Show Gemini key"}
                  >
                    {showGeminiKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={saveKeys}
              className="w-full py-1.5 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors min-h-[28px]"
            >
              Save Keys
            </button>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-1.5">
              <div className="flex gap-1.5">
                <button
                  onClick={testConnection}
                  disabled={testStatus === "testing"}
                  className="flex-1 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 min-h-[28px]"
                >
                  {testStatus === "testing" ? "Testing..." : "Test Connection"}
                </button>
                <button
                  onClick={clearCache}
                  className="flex-1 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors min-h-[28px]"
                >
                  Clear Cache
                </button>
              </div>
              {testMsg && (
                <div className={`mt-1.5 px-2 py-1 rounded text-[10px] font-mono break-all ${
                  testStatus === "ok"
                    ? "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-400"
                    : "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-400"
                }`} role="alert">
                  {testMsg}
                </div>
              )}
            </div>

            {errors.length > 0 && (
              <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <h2 className="text-[10px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                    Errors ({errors.length})
                  </h2>
                  <button onClick={clearErrors} className="text-[10px] text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 min-w-[28px] min-h-[24px]">
                    Clear
                  </button>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {errors.slice(0, 10).map((err, i) => (
                    <div key={i} className="px-2 py-1 rounded bg-red-50 dark:bg-red-950/50 text-[10px] font-mono text-red-800 dark:text-red-400 break-all">
                      <span className="text-red-500 dark:text-red-500 mr-1">{err.time}</span>
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
              <h2 className="text-[10px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Saved ({vocab.length})
              </h2>
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => importVocab("json")}
                  className="px-2 py-1 text-[10px] border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 min-h-[24px]"
                  aria-label="Import vocabulary from JSON file"
                >
                  Import
                </button>
                <button
                  onClick={() => exportVocab("json")}
                  disabled={vocab.length === 0}
                  className="px-2 py-1 text-[10px] border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed min-h-[24px]"
                  aria-label="Export vocabulary as JSON"
                >
                  JSON
                </button>
                <button
                  onClick={() => exportVocab("csv")}
                  disabled={vocab.length === 0}
                  className="px-2 py-1 text-[10px] border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed min-h-[24px]"
                  aria-label="Export vocabulary as CSV"
                >
                  CSV
                </button>
                <button
                  onClick={clearVocab}
                  disabled={vocab.length === 0}
                  className="px-2 py-1 text-[10px] border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-30 disabled:cursor-not-allowed min-h-[24px]"
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
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                />
              </div>
            )}

            {filteredVocab.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {vocab.length === 0
                    ? "Open the Words tab, click a word, and save it to your vocabulary."
                    : "No words match your filter."}
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {filteredVocab.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-900 dark:text-white truncate">{entry.word}</span>
                        <span className="text-brand-600 dark:text-brand-400 text-xs font-medium truncate">→ {entry.translation}</span>
                      </div>
                      {entry.pronunciation && (
                        <span className="text-[10px] text-gray-600 dark:text-gray-400">{entry.pronunciation}</span>
                      )}
                    </div>
                    <button
                      onClick={() => removeVocabEntry(entry.id)}
                      className="text-gray-400 hover:text-red-500 flex-shrink-0 p-1 min-w-[24px] min-h-[24px] flex items-center justify-center"
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
