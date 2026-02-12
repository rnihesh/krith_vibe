import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { getSettings, saveSettings, testConnection } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
  onToast: (type: "success" | "error" | "info", message: string) => void;
}

export function SettingsModal({ open, onClose, onToast }: Props) {
  const [rootFolder, setRootFolder] = useState("~/sefs_root");
  const [provider, setProvider] = useState<"ollama" | "openai">("ollama");
  const [ollamaHost, setOllamaHost] = useState("http://localhost:11434");
  const [ollamaEmbedModel, setOllamaEmbedModel] = useState("nomic-embed-text");
  const [ollamaLlmModel, setOllamaLlmModel] = useState("llama3");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [openaiEmbedModel, setOpenaiEmbedModel] = useState(
    "text-embedding-3-small",
  );
  const [openaiKeySet, setOpenaiKeySet] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      getSettings()
        .then((s) => {
          setRootFolder((s.root_folder as string) || "~/sefs_root");
          setProvider((s.provider as string) === "openai" ? "openai" : "ollama");
          setOllamaHost((s.ollama_host as string) || "http://localhost:11434");
          setOllamaEmbedModel(
            (s.ollama_embed_model as string) || "nomic-embed-text",
          );
          setOllamaLlmModel((s.ollama_llm_model as string) || "llama3");
          setOpenaiKey("");
          setOpenaiKeySet(Boolean((s as any).openai_api_key_set));
          setOpenaiModel((s.openai_model as string) || "gpt-4o-mini");
          setOpenaiEmbedModel(
            (s.openai_embed_model as string) || "text-embedding-3-small",
          );
        })
        .catch(() => {
          onToast("error", "Failed to load settings");
        });
      setTestResult(null);
    }
  }, [open, onToast]);

  const buildPayload = () => ({
    root_folder: rootFolder,
    provider,
    ollama_host: ollamaHost,
    ollama_embed_model: ollamaEmbedModel,
    ollama_llm_model: ollamaLlmModel,
    openai_api_key: openaiKey,
    openai_model: openaiModel,
    openai_embed_model: openaiEmbedModel,
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(buildPayload());
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: "Test request failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(buildPayload());
      onToast("success", "Settings saved");
      onClose();
    } catch {
      onToast("error", "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150]"
            style={{
              background: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(4px)",
            }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed z-[151] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md"
          >
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--bg-border)",
                boxShadow: "0 25px 60px rgba(0,0,0,0.25)",
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 h-14 border-b"
                style={{ borderColor: "var(--bg-border)" }}
              >
                <h2 className="text-[15px] font-semibold text-text-primary">
                  Settings
                </h2>
                <button
                  onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary cursor-pointer border-none bg-transparent"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Watched Folder */}
                <div>
                  <label className="text-xs text-text-tertiary font-semibold uppercase tracking-wider block mb-1.5">
                    Watched Folder
                  </label>
                  <input
                    type="text"
                    value={rootFolder}
                    onChange={(e) => setRootFolder(e.target.value)}
                    placeholder="~/sefs_root"
                    className="w-full h-9 px-3 rounded-lg text-sm text-text-primary border-none outline-none"
                    style={{
                      background: "var(--bg-dark)",
                      border: "1px solid var(--bg-border)",
                    }}
                  />
                  <p className="text-xs text-text-tertiary mt-1">
                    Changes take effect after clicking Rescan.
                  </p>
                </div>

                {/* Provider toggle */}
                <div>
                  <label className="text-xs text-text-tertiary font-semibold uppercase tracking-wider block mb-2">
                    Provider
                  </label>
                  <div
                    className="flex rounded-lg overflow-hidden"
                    style={{ border: "1px solid var(--bg-border)" }}
                  >
                    {(["ollama", "openai"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setProvider(p);
                          setTestResult(null);
                        }}
                        className={`flex-1 py-2 text-[13px] font-medium cursor-pointer border-none ${
                          provider === p
                            ? "bg-accent text-white"
                            : "bg-transparent text-text-secondary hover:bg-bg-dark"
                        }`}
                      >
                        {p === "ollama" ? "Ollama (Local)" : "OpenAI"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ollama fields */}
                {provider === "ollama" && (
                  <>
                    <Field
                      label="Ollama Host"
                      value={ollamaHost}
                      onChange={setOllamaHost}
                      placeholder="http://localhost:11434"
                    />
                    <Field
                      label="Embedding Model"
                      value={ollamaEmbedModel}
                      onChange={setOllamaEmbedModel}
                      placeholder="nomic-embed-text"
                    />
                    <Field
                      label="LLM Model"
                      value={ollamaLlmModel}
                      onChange={setOllamaLlmModel}
                      placeholder="llama3"
                    />
                  </>
                )}

                {/* OpenAI fields */}
                {provider === "openai" && (
                  <>
                    <Field
                      label="API Key"
                      value={openaiKey}
                      onChange={setOpenaiKey}
                      placeholder={openaiKeySet ? "Saved (enter to replace)" : "sk-..."}
                      type="password"
                    />
                    <Field
                      label="Model"
                      value={openaiModel}
                      onChange={setOpenaiModel}
                      placeholder="gpt-4o-mini"
                    />
                    <Field
                      label="Embedding Model"
                      value={openaiEmbedModel}
                      onChange={setOpenaiEmbedModel}
                      placeholder="text-embedding-3-small"
                    />
                  </>
                )}

                {/* Test result */}
                {testResult && (
                  <div
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                      testResult.success
                        ? "text-success"
                        : "text-error"
                    }`}
                    style={{ background: "var(--bg-dark)" }}
                  >
                    {testResult.success ? (
                      <CheckCircle size={14} />
                    ) : (
                      <AlertTriangle size={14} />
                    )}
                    {testResult.message}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-medium cursor-pointer border-none text-text-primary"
                    style={{ background: "var(--bg-dark)" }}
                  >
                    {testing ? (
                      <Loader2 size={14} className="animate-spin-slow" />
                    ) : null}
                    Test Connection
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-medium cursor-pointer border-none bg-accent hover:bg-accent-hover text-white"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-text-tertiary font-semibold uppercase tracking-wider block mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 rounded-lg text-sm text-text-primary border-none outline-none"
        style={{
          background: "var(--bg-dark)",
          border: "1px solid var(--bg-border)",
        }}
      />
    </div>
  );
}
