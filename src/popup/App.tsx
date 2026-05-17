import { useState, useEffect, useCallback } from "react";
import type { UserSettings, VocabularyEntry } from "@shared/types";
import { LANGUAGE_OPTIONS } from "@shared/types";
import { MESSAGE_TYPES } from "@shared/constants";

type Tab = "learn" | "setup" | "vocab";

const DIFFICULTY_OPTIONS = [
  { value: "beginner" as const, label: "Beginner", desc: "Many words" },
  { value: "intermediate" as const, label: "Intermediate", desc: "Uncommon words" },
  { value: "advanced" as const, label: "Advanced", desc: "Rare vocabulary" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("learn");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [vocab, setVocab] = useState<VocabularyEntry[]>([]);
  const [vocabFilter, setVocabFilter] = useState("");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }, (res) => {
      if (res?.success) {
        setSettings(res.data);
        setApiKey(res.data.apiKey || "");
      }
    });
    chrome.storage.local.get("linguaflow_vocabulary", (result) => {
      setVocab(result.linguaflow_vocabulary || []);
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

  const saveApiKey = () => {
    chrome.storage.local.get("linguaflow_settings", (result) => {
      const current = result.linguaflow_settings || {};
      chrome.storage.local.set({ linguaflow_settings: { ...current, apiKey } });
      showStatus("API key saved!");
    });
  };

  const toggleEnabled = () => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.TOGGLE_ENABLED }, (res) => {
      if (res?.success && settings) {
        setSettings({ ...settings, enabled: res.data.enabled });
      }
    });
  };

  const clearCache = () => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CACHE_CLEAR }, () => {
      showStatus("Cache cleared!");
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
    const data =
      format === "json"
        ? JSON.stringify(vocab, null, 2)
        : vocabToCSV(vocab);
    const blob = new Blob([data], { type: format === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `linguaflow-vocabulary.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus(`Exported ${format.toUpperCase()}!`);
  };

  const filteredVocab = vocabFilter
    ? vocab.filter(
        (v) =>
          v.word.toLowerCase().includes(vocabFilter.toLowerCase()) ||
          v.translation.toLowerCase().includes(vocabFilter.toLowerCase())
      )
    : vocab;

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-5 h-5 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[380px] max-h-[520px]">
      {/* Header */}
      <header className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center">
            <span className="text-white font-bold text-xs">L</span>
          </div>
          <div>
            <h1 className="font-semibold text-sm text-gray-900 dark:text-white">LinguaFlow</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {statusMsg && (
            <span className="text-[10px] text-green-500 font-medium animate-fade-in">{statusMsg}</span>
          )}
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={settings.enabled} onChange={toggleEnabled} />
            <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500" />
          </label>
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="flex border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        {([
          { id: "learn" as Tab, label: "Learn" },
          { id: "setup" as Tab, label: "Setup" },
          { id: "vocab" as Tab, label: `Vocab${vocab.length ? ` (${vocab.length})` : ""}` },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? "text-brand-600 dark:text-brand-400 border-b-2 border-brand-500"
                : "text-gray-400 dark:text-gray-500 hover:text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <div className="overflow-y-auto flex-1">
        {tab === "learn" && (
          <div className="px-4 py-3 space-y-3">
            {/* Language */}
            <div>
              <label className="block text-[10px] font-medium text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wider">
                Target Language
              </label>
              <select
                value={settings.targetLanguage}
                onChange={(e) => updateSetting("targetLanguage", e.target.value as UserSettings["targetLanguage"])}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none cursor-pointer"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Difficulty */}
            <div>
              <label className="block text-[10px] font-medium text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wider">
                Difficulty
              </label>
              <div className="space-y-1">
                {DIFFICULTY_OPTIONS.map((opt) => (
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
                    <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${settings.difficulty === opt.value ? "border-brand-500" : "border-gray-300"}`}>
                      {settings.difficulty === opt.value && <span className="w-2 h-2 rounded-full bg-brand-500" />}
                    </span>
                    <div>
                      <div className="text-xs font-medium text-gray-900 dark:text-white">{opt.label}</div>
                      <div className="text-[10px] text-gray-400">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Display Mode */}
            <div>
              <label className="block text-[10px] font-medium text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wider">
                Display Mode
              </label>
              <div className="flex gap-1.5">
                {(["tooltip", "inline"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updateSetting("displayMode", mode)}
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                      settings.displayMode === mode
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-400 font-medium"
                        : "border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {mode === "tooltip" ? "Tooltip" : "Inline"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "setup" && (
          <div className="px-4 py-3 space-y-4">
            {/* API Key */}
            <div>
              <label className="block text-[10px] font-medium text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wider">
                OpenRouter API Key
              </label>
              <p className="text-[10px] text-gray-400 mb-2">
                Get a free key at{" "}
                <a href="https://openrouter.ai/keys" target="_blank" className="text-brand-500 underline" rel="noreferrer">
                  openrouter.ai/keys
                </a>
              </p>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full px-2.5 py-1.5 pr-12 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 hover:text-gray-600"
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
                <button
                  onClick={saveApiKey}
                  className="px-3 py-1.5 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors flex-shrink-0"
                >
                  Save
                </button>
              </div>
            </div>

            {/* Cache */}
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
              <label className="block text-[10px] font-medium text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wider">
                Data
              </label>
              <button
                onClick={clearCache}
                className="w-full py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                Clear Translation Cache
              </button>
            </div>
          </div>
        )}

        {tab === "vocab" && (
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Saved ({vocab.length})
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => exportVocab("json")}
                  disabled={vocab.length === 0}
                  className="px-2 py-0.5 text-[10px] border border-gray-200 dark:border-gray-700 rounded text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  JSON
                </button>
                <button
                  onClick={() => exportVocab("csv")}
                  disabled={vocab.length === 0}
                  className="px-2 py-0.5 text-[10px] border border-gray-200 dark:border-gray-700 rounded text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  CSV
                </button>
                <button
                  onClick={clearVocab}
                  disabled={vocab.length === 0}
                  className="px-2 py-0.5 text-[10px] border border-red-200 dark:border-red-800 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>
            </div>

            {vocab.length > 0 && (
              <input
                type="text"
                value={vocabFilter}
                onChange={(e) => setVocabFilter(e.target.value)}
                placeholder="Filter..."
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
              />
            )}

            {filteredVocab.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-gray-400">
                  {vocab.length === 0
                    ? "Hover a word and click Save to add it here."
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
                        <span className="text-brand-500 dark:text-brand-400 text-xs font-medium truncate">→ {entry.translation}</span>
                      </div>
                      {entry.pronunciation && (
                        <span className="text-[10px] text-gray-400">{entry.pronunciation}</span>
                      )}
                    </div>
                    <button
                      onClick={() => removeVocabEntry(entry.id)}
                      className="text-gray-300 hover:text-red-400 flex-shrink-0 p-0.5"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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

function vocabToCSV(vocab: VocabularyEntry[]): string {
  const headers = ["Word", "Translation", "Definition", "Pronunciation", "Synonym", "Context", "Language", "Saved At"];
  const rows = vocab.map((v) =>
    [
      `"${v.word.replace(/"/g, '""')}"`,
      `"${v.translation.replace(/"/g, '""')}"`,
      `"${v.definition.replace(/"/g, '""')}"`,
      `"${v.pronunciation.replace(/"/g, '""')}"`,
      `"${v.synonym.replace(/"/g, '""')}"`,
      `"${v.context.replace(/"/g, '""')}"`,
      `"${v.targetLanguage}"`,
      `"${new Date(v.savedAt).toISOString()}"`,
    ].join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}
