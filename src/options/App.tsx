import { useState, useEffect, useCallback } from "react";
import type { UserSettings, VocabularyEntry, TargetLanguage } from "@shared/types";
import { LANGUAGE_OPTIONS } from "@shared/types";
import { getVocabulary, saveVocabulary } from "@shared/storage";
import { MESSAGE_TYPES } from "@shared/constants";

type Tab = "general" | "vocabulary";

export default function App() {
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [vocab, setVocab] = useState<VocabularyEntry[]>([]);
  const [vocabFilter, setVocabFilter] = useState("");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }, (res) => {
      if (res?.success) {
        setSettings(res.data);
        setOpenrouterKey(res.data.openrouterApiKey || "");
        setGeminiKey(res.data.geminiApiKey || "");
      }
    });
    loadVocab();
  }, []);

  const loadVocab = () => {
    getVocabulary().then(setVocab).catch(() => {});
  };

  const showStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), 2500);
  }, []);

  const saveOpenrouterKey = () => {
    if (!settings) return;
    updateSetting("openrouterApiKey", openrouterKey);
  };

  const saveGeminiKey = () => {
    if (!settings) return;
    updateSetting("geminiApiKey", geminiKey);
  };

  const updateSetting = async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    chrome.storage.local.set({ linguaflow_settings: updated });
    showStatus("Saved!");
  };

  const exportVocab = (format: "json" | "csv") => {
    const data = format === "json"
      ? JSON.stringify(vocab, null, 2)
      : vocabToCSV(vocab);
    const blob = new Blob([data], { type: format === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `linguaflow-vocabulary.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus(`Exported as ${format.toUpperCase()}!`);
  };

  const clearVocab = async () => {
    if (!confirm("Delete all saved vocabulary? This cannot be undone.")) return;
    await saveVocabulary([]);
    setVocab([]);
    showStatus("Vocabulary cleared!");
  };

  const clearCache = () => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CACHE_CLEAR }, () => {
      showStatus("Translation cache cleared!");
    });
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-gray-200 dark:border-gray-700 border-t-slate-700 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center">
              <span className="text-white font-bold">L</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-white">LinguaFlow</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">Extension Settings</p>
            </div>
          </div>
          {statusMsg && (
            <span className="text-sm text-green-500 font-medium animate-fade-in px-3 py-1 bg-green-50 dark:bg-green-950 rounded-full">
              {statusMsg}
            </span>
          )}
        </div>
        <div className="max-w-4xl mx-auto px-6">
          <nav className="flex gap-1">
            {(["general", "vocabulary"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                  tab === t
                    ? "bg-gray-50 dark:bg-gray-950 text-slate-700 dark:text-slate-300 border-b-2 border-slate-700"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {t === "general" ? "General" : "Vocabulary"}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {tab === "general" && (
          <div className="space-y-8">
            {/* API Provider & API Key */}
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">API Provider</h2>
              <div className="flex gap-2 mb-4">
                {([
                  { value: "openrouter" as const, label: "OpenRouter" },
                  { value: "gemini" as const, label: "Gemini" },
                ]).map((prov) => (
                  <button
                    key={prov.value}
                    onClick={() => updateSetting("apiProvider", prov.value)}
                    className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                      settings?.apiProvider === prov.value
                        ? "border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-medium"
                        : "border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {prov.label}
                  </button>
                ))}
              </div>

              {settings?.apiProvider === "openrouter" && (
                <>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">OpenRouter API Key</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Get your free API key at{" "}
                    <a href="https://openrouter.ai/keys" target="_blank" className="text-slate-700 hover:underline" rel="noreferrer">
                      openrouter.ai/keys
                    </a>
                    . Uses the Gemma translation model.
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showKey ? "text" : "password"}
                        value={openrouterKey}
                        onChange={(e) => setOpenrouterKey(e.target.value)}
                        placeholder="sk-or-v1-..."
                        className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none font-mono"
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                      >
                        {showKey ? "Hide" : "Show"}
                      </button>
                    </div>
                    <button
                      onClick={saveOpenrouterKey}
                      className="px-5 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-800 text-white rounded-lg transition-colors"
                    >
                      Save Key
                    </button>
                  </div>
                </>
              )}

              {settings?.apiProvider === "gemini" && (
                <>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">Gemini API Key</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Get your key from{" "}
                    <a href="https://aistudio.google.com/apikey" target="_blank" className="text-slate-700 hover:underline" rel="noreferrer">
                      aistudio.google.com/apikey
                    </a>
                    .
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showKey ? "text" : "password"}
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none font-mono"
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                      >
                        {showKey ? "Hide" : "Show"}
                      </button>
                    </div>
                    <button
                      onClick={saveGeminiKey}
                      className="px-5 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-800 text-white rounded-lg transition-colors"
                    >
                      Save Key
                    </button>
                  </div>
                </>
              )}
            </section>

            {/* Language */}
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Target Language</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateSetting("targetLanguage", opt.value)}
                    className={`px-3 py-2.5 text-sm rounded-lg border transition-colors text-left ${
                      settings.targetLanguage === opt.value
                        ? "border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-medium"
                        : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Difficulty */}
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Difficulty Level</h2>
              <div className="space-y-3">
                {([
                  { value: "beginner" as const, label: "Beginner", desc: "Translates most words above 3 characters — good for early learners." },
                  { value: "intermediate" as const, label: "Intermediate", desc: "Translates uncommon words above 4 characters — good for expanding vocabulary." },
                  { value: "advanced" as const, label: "Advanced", desc: "Translates only rare words above 5 characters — good for advanced readers." },
                ]).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 px-4 py-3 rounded-lg cursor-pointer border transition-colors ${
                      settings.difficulty === opt.value
                        ? "border-slate-700 bg-slate-50 dark:bg-slate-950"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="difficulty"
                      checked={settings.difficulty === opt.value}
                      onChange={() => updateSetting("difficulty", opt.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            {/* Display */}
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Display Mode</h2>
              <div className="flex gap-3">
                {([
                  { value: "tooltip" as const, label: "Tooltip", desc: "Show translation in a floating card on hover" },
                  { value: "inline" as const, label: "Inline", desc: "Show translation beside the word in brackets" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateSetting("displayMode", opt.value)}
                    className={`flex-1 p-4 rounded-xl border transition-colors text-left ${
                      settings.displayMode === opt.value
                        ? "border-slate-700 bg-slate-50 dark:bg-slate-950"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">{opt.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </section>

            {/* Danger zone */}
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-red-200 dark:border-red-900/50 p-6">
              <h2 className="text-base font-semibold text-red-600 dark:text-red-400 mb-2">Data Management</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Clear cached translations to free up storage. This will not delete your saved vocabulary.
              </p>
              <button
                onClick={clearCache}
                className="px-4 py-2 text-sm font-medium bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
              >
                Clear Translation Cache
              </button>
            </section>
          </div>
        )}

        {tab === "vocabulary" && (
          <div className="space-y-6">
            <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">Saved Vocabulary</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {vocab.length} word{vocab.length !== 1 ? "s" : ""} saved
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => exportVocab("json")}
                    disabled={vocab.length === 0}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={() => exportVocab("csv")}
                    disabled={vocab.length === 0}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={clearVocab}
                    disabled={vocab.length === 0}
                    className="px-3 py-1.5 text-xs font-medium border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {vocab.length > 0 && (
                <input
                  type="text"
                  value={vocabFilter}
                  onChange={(e) => setVocabFilter(e.target.value)}
                  placeholder="Filter words..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none mb-4"
                />
              )}

              {filteredVocab.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-3">📖</div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {vocab.length === 0
                      ? "No words saved yet. Hover over words while browsing and click Save."
                      : "No words match your filter."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {filteredVocab.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900 dark:text-white">{entry.word}</span>
                          <span className="text-slate-700 dark:text-slate-300 font-medium text-sm">→ {entry.translation}</span>
                        </div>
                        {entry.definition && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 italic mb-1">{entry.definition}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                          {entry.pronunciation && <span>🔊 {entry.pronunciation}</span>}
                          {entry.targetLanguage && <span>{entry.targetLanguage}</span>}
                          <span>{new Date(entry.savedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const updated = vocab.filter((v) => v.id !== entry.id);
                          setVocab(updated);
                          chrome.storage.local.set({ linguaflow_vocabulary: updated });
                        }}
                        className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 p-1"
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
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
