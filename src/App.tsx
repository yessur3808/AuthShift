import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Code2,
  Download,
  FileImage,
  FileText,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assembleBatches,
  buildBitwardenExport,
  decodeMigrationUri,
  extractMigrationUris,
  MigrationError,
  type BitwardenExport,
} from "./lib/converter";

type Phase = "idle" | "processing" | "ready" | "error";

type ModalProps = {
  children: ReactNode;
  label: string;
  onClose: () => void;
  wide?: boolean;
};

function Modal({ children, label, onClose, wide = false }: ModalProps) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`modal glass ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <button
          ref={closeButton}
          className="icon-button modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
        {children}
      </section>
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="How to use AuthShift" onClose={onClose} wide>
      <div className="modal-kicker"><CircleHelp size={15} /> Quick guide</div>
      <h2 className="modal-title">Three steps. Your secrets stay yours.</h2>
      <p className="modal-lead">
        AuthShift runs entirely in this browser tab. Nothing is uploaded to a
        server or saved after you leave.
      </p>
      <div className="help-steps">
        <article>
          <span>01</span>
          <div>
            <h3>Export from Google</h3>
            <p>
              In Google Authenticator, open <b>Transfer accounts → Export accounts</b>.
              Screenshot every QR part shown.
            </p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <h3>Add every screenshot</h3>
            <p>
              Drop all parts here together. Dense phone screenshots are cropped
              and enhanced automatically.
            </p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <h3>Import into Bitwarden</h3>
            <p>
              Download the JSON, then choose <b>Authenticator Export (JSON)</b>
              in Bitwarden Authenticator’s import screen.
            </p>
          </div>
        </article>
      </div>
      <div className="security-note">
        <ShieldCheck size={19} />
        <p>
          <strong>Handle the export like a password.</strong> Import it promptly,
          verify your codes, then delete the JSON and screenshots.
        </p>
      </div>
    </Modal>
  );
}

function PasteModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (uris: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    const uris = extractMigrationUris(value);
    if (!uris.length) {
      setError("Paste at least one otpauth-migration:// URI.");
      return;
    }
    onAdd(uris);
    onClose();
  };

  return (
    <Modal label="Paste migration URI" onClose={onClose}>
      <div className="modal-kicker"><FileText size={15} /> Advanced input</div>
      <h2 className="modal-title">Paste migration URIs</h2>
      <p className="modal-lead">
        Add one or more Google Authenticator migration links. They are processed
        locally and never sent anywhere.
      </p>
      <label className="textarea-label" htmlFor="migration-uri">Migration URI</label>
      <textarea
        id="migration-uri"
        autoFocus
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
        placeholder="otpauth-migration://offline?data=…"
        spellCheck={false}
      />
      {error && <p className="field-error">{error}</p>}
      <button className="primary-button modal-action" type="button" onClick={submit}>
        Add URI <ArrowRight size={17} />
      </button>
    </Modal>
  );
}

function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [manualUris, setManualUris] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [output, setOutput] = useState<BitwardenExport | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skipUnsupported, setSkipUnsupported] = useState(false);
  const [outputName, setOutputName] = useState("bitwarden-authenticator-import.json");
  const fileInput = useRef<HTMLInputElement>(null);
  const shell = useRef<HTMLElement>(null);

  const sourceCount = files.length + manualUris.length;
  const currentStep = phase === "ready" ? 3 : sourceCount ? 2 : 1;
  const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

  const addFiles = (incoming: File[]) => {
    const supported = incoming.filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(?:avif|bmp|gif|jpe?g|png|txt|webp)$/i.test(file.name),
    );
    setFiles((current) => {
      const existing = new Set(current.map(fileKey));
      return [...current, ...supported.filter((file) => !existing.has(fileKey(file)))];
    });
    setOutput(null);
    setPhase("idle");
    setError("");
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles([...event.dataTransfer.files]);
  };

  const removeFile = (target: File) => {
    setFiles((current) => current.filter((file) => fileKey(file) !== fileKey(target)));
    setOutput(null);
    setPhase("idle");
  };

  const reset = () => {
    setFiles([]);
    setManualUris([]);
    setOutput(null);
    setSkipped([]);
    setError("");
    setPhase("idle");
    setProgress(0);
    if (fileInput.current) fileInput.current.value = "";
  };

  const convert = async () => {
    if (!sourceCount) return;
    setPhase("processing");
    setError("");
    setOutput(null);
    setProgress(4);
    const uris = [...manualUris];

    try {
      const imageTools = files.length ? await import("./lib/qr") : null;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setProgressLabel(`Reading ${file.name}`);
        uris.push(...(await imageTools!.extractUrisFromFile(file)));
        setProgress(Math.round(((index + 1) / Math.max(1, files.length)) * 76));
      }

      const uniqueUris = [...new Set(uris)].filter((uri) =>
        uri.toLowerCase().startsWith("otpauth-migration://"),
      );
      if (!uniqueUris.length) {
        throw new MigrationError("No Google Authenticator export codes were found.");
      }

      setProgressLabel("Assembling your export");
      setProgress(88);
      const entries = assembleBatches(uniqueUris.map(decodeMigrationUri));
      const result = buildBitwardenExport(entries, skipUnsupported);
      setOutput(result.output);
      setSkipped(result.skipped);
      setProgress(100);
      setProgressLabel("Ready for Bitwarden");
      window.setTimeout(() => setPhase("ready"), 260);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong while reading the export.",
      );
      setPhase("error");
    }
  };

  const download = () => {
    if (!output) return;
    const blob = new Blob([`${JSON.stringify(output, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const safeName = outputName.trim().replace(/[\\/:*?"<>|]/g, "-");
    anchor.download = safeName.endsWith(".json")
      ? safeName
      : `${safeName || "bitwarden-authenticator-import"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    shell.current?.style.setProperty("--pointer-x", `${event.clientX}px`);
    shell.current?.style.setProperty("--pointer-y", `${event.clientY}px`);
  };

  const accountGroups = useMemo(() => output?.items ?? [], [output]);

  return (
    <main
      ref={shell}
      className="app-shell"
      onPointerMove={handlePointerMove}
      style={{ "--pointer-x": "50vw", "--pointer-y": "35vh" } as CSSProperties}
    >
      <div className="ambient" aria-hidden="true">
        <span className="orb orb-one" />
        <span className="orb orb-two" />
        <span className="orb orb-three" />
        <span className="grid-glow" />
        <span className="pointer-glow" />
      </div>

      <nav className="topbar glass">
        <a className="brand" href="#top" aria-label="AuthShift home">
          <span className="brand-mark"><Sparkles size={17} /></span>
          <span>AuthShift</span>
        </a>
        <div className="nav-links">
          <span className="local-badge"><span /> Local only</span>
          <button className="nav-action" type="button" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={17} /> Help
          </button>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow"><LockKeyhole size={14} /> 100% on-device</div>
        <h1>Move your codes.<br /><span>Keep your secrets.</span></h1>
        <p className="hero-copy">
          Turn Google Authenticator export screenshots into a Bitwarden-ready
          file—privately, right in your browser.
        </p>
        <div className="micro-steps" aria-label={`Step ${currentStep} of 3`}>
          {["Add", "Review", "Download"].map((label, index) => (
            <div className={currentStep >= index + 1 ? "active" : ""} key={label}>
              <span>{currentStep > index + 1 ? <Check size={12} /> : index + 1}</span>
              {label}
            </div>
          ))}
        </div>
      </section>

      <section className={`workspace glass phase-${phase}`} aria-label="Authenticator converter">
        {phase === "ready" && output ? (
          <div className="result-view">
            <div className="success-mark"><CheckCircle2 size={29} /></div>
            <span className="step-label">Conversion complete</span>
            <h2>{output.items.length} codes are ready to move</h2>
            <p className="result-lead">
              Review the account labels, then download your Bitwarden-compatible export.
            </p>

            <div className="account-list" aria-label="Converted accounts">
              {accountGroups.map((item) => (
                <div className="account-row" key={item.id}>
                  <span className="account-avatar" aria-hidden="true">
                    {item.name.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.login.username}</span>
                  </div>
                  <Check size={17} aria-label="Ready" />
                </div>
              ))}
            </div>

            {skipped.length > 0 && (
              <p className="skipped-note">Skipped {skipped.length} unsupported entries.</p>
            )}

            <label className="filename-field">
              <span>Download name</span>
              <input value={outputName} onChange={(event) => setOutputName(event.target.value)} />
            </label>

            <div className="result-actions">
              <button className="primary-button download-button" type="button" onClick={download}>
                <Download size={18} /> Download Bitwarden JSON
              </button>
              <button className="secondary-button" type="button" onClick={reset}>
                <RotateCcw size={17} /> Start over
              </button>
            </div>
            <p className="delete-reminder"><KeyRound size={14} /> Delete the JSON after a successful import.</p>
          </div>
        ) : (
          <>
            <div className="workspace-heading">
              <div>
                <span className="step-label">{sourceCount ? "Ready to convert" : "Step 1 of 3"}</span>
                <h2>{sourceCount ? "Check your export parts" : "Add your QR screenshots"}</h2>
                <p>
                  {sourceCount
                    ? "Every numbered QR part should appear below."
                    : "Drop every part of your Google Authenticator export."}
                </p>
              </div>
              <button className="privacy-pill" type="button" onClick={() => setHelpOpen(true)}>
                <span /> Nothing leaves this device <ChevronRight size={13} />
              </button>
            </div>

            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept="image/*,.txt"
              multiple
              onChange={(event) => addFiles([...(event.target.files ?? [])])}
            />

            {!sourceCount ? (
              <button
                className={`dropzone ${dragging ? "is-dragging" : ""}`}
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <span className="dropzone-rings" aria-hidden="true" />
                <span className="upload-icon"><Upload size={25} /></span>
                <strong>Drop screenshots here</strong>
                <span>or click to choose JPG, PNG, WEBP, or a URI text file</span>
                <em>Choose files <ArrowRight size={15} /></em>
              </button>
            ) : (
              <div className="source-list">
                {files.map((file) => (
                  <div className="source-row" key={fileKey(file)}>
                    <span className="source-icon"><FileImage size={19} /></span>
                    <div>
                      <strong>{file.name}</strong>
                      <span>{(file.size / 1024).toFixed(0)} KB · ready locally</span>
                    </div>
                    <button className="icon-button" type="button" onClick={() => removeFile(file)} aria-label={`Remove ${file.name}`}>
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
                {manualUris.map((_, index) => (
                  <div className="source-row" key={`uri-${index}`}>
                    <span className="source-icon"><FileText size={19} /></span>
                    <div><strong>Migration URI {index + 1}</strong><span>Pasted locally · ready</span></div>
                    <button className="icon-button" type="button" onClick={() => setManualUris((current) => current.filter((__, itemIndex) => itemIndex !== index))} aria-label={`Remove migration URI ${index + 1}`}>
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
                <button className="add-more" type="button" onClick={() => fileInput.current?.click()}>
                  <Upload size={16} /> Add more files
                </button>
              </div>
            )}

            <div className="under-dropzone">
              <button className="text-button" type="button" onClick={() => setPasteOpen(true)}>
                <FileText size={15} /> Paste a migration URI instead
              </button>
              <button className="text-button" type="button" onClick={() => setSettingsOpen((open) => !open)}>
                <Settings2 size={15} /> Options
              </button>
            </div>

            {settingsOpen && (
              <div className="options-panel glass-soft">
                <label className="toggle-row">
                  <span><strong>Skip unsupported entries</strong><small>Continue past HOTP or unusual algorithms.</small></span>
                  <input type="checkbox" checked={skipUnsupported} onChange={(event) => setSkipUnsupported(event.target.checked)} />
                </label>
              </div>
            )}

            {(phase === "processing" || progress > 0) && phase !== "error" && (
              <div className="progress-block" aria-live="polite">
                <div><span>{progressLabel}</span><strong>{progress}%</strong></div>
                <span className="progress-track"><span style={{ width: `${progress}%` }} /></span>
              </div>
            )}

            {phase === "error" && (
              <div className="error-banner" role="alert">
                <X size={18} />
                <div><strong>Couldn’t complete the export</strong><span>{error}</span></div>
              </div>
            )}

            {sourceCount > 0 && (
              <button className="primary-button convert-button" type="button" onClick={convert} disabled={phase === "processing"}>
                {phase === "processing" ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
                {phase === "processing" ? "Reading your export…" : "Create Bitwarden export"}
                {phase !== "processing" && <ArrowRight size={17} />}
              </button>
            )}
          </>
        )}
      </section>

      <section className="trust-row" aria-label="Privacy guarantees">
        <div><ShieldCheck size={18} /><span><strong>Private by design</strong>No uploads or analytics</span></div>
        <div><KeyRound size={18} /><span><strong>Bitwarden-ready</strong>Official JSON structure</span></div>
        <div><Code2 size={18} /><span><strong>Static & auditable</strong>Runs on GitHub Pages</span></div>
      </section>

      <footer>
        <span>AuthShift</span>
        <p>Built for a safer, calmer authenticator migration.</p>
        <button type="button" onClick={() => setHelpOpen(true)}>Need help?</button>
      </footer>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {pasteOpen && (
        <PasteModal
          onClose={() => setPasteOpen(false)}
          onAdd={(uris) => {
            setManualUris((current) => [...current, ...uris]);
            setPhase("idle");
            setError("");
          }}
        />
      )}
    </main>
  );
}

export default App;
