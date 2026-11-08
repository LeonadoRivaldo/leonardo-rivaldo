"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { CircleHelp, Eye, Plus, X } from "lucide-react";

type DocumentSummary = {
  path: string;
  title: string;
};

type DocumentContent = DocumentSummary & {
  content: string;
};

const PREVIEW_ORIGIN = "http://127.0.0.1:5175";

function getPreviewPath(documentPath: string) {
  const route = documentPath.replace(/\.md$/, "");

  if (route === "index") {
    return "/";
  }

  if (route.endsWith("/index")) {
    return `/${route.slice(0, -"/index".length)}/`;
  }

  return `/${route}`;
}

function formatPath(documentPath: string) {
  if (documentPath === "index.md") {
    return "Bio";
  }

  if (documentPath === "skills.md") {
    return "Skills";
  }

  return documentPath
    .replace(/^experiencias\//, "")
    .replace(/\.md$/, "")
    .replace(/-/g, " ");
}

export default function Home() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [addExperienceOpen, setAddExperienceOpen] = useState(false);
  const [creatingExperience, setCreatingExperience] = useState(false);
  const [experienceError, setExperienceError] = useState("");
  const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const markdownHelpRef = useRef<HTMLDivElement>(null);

  const selectedDocument = documents.find((document) => document.path === selectedPath);
  const isDirty = content !== savedContent;

  useEffect(() => {
    async function loadDocuments() {
      try {
        const response = await fetch("/api/documents", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Não foi possível carregar a lista de páginas.");
        }

        const data = (await response.json()) as { documents: DocumentSummary[] };
        setDocuments(data.documents);

        const initialDocument = data.documents.find((document) => document.path === "index.md")
          ?? data.documents[0];

        if (initialDocument) {
          await selectDocument(initialDocument.path, true);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Erro ao carregar páginas.");
      } finally {
        setLoading(false);
      }
    }

    void loadDocuments();
    // The initial document is loaded once when the local editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!previewOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previewTrigger = previewTriggerRef.current;
    document.body.style.overflow = "hidden";
    previewCloseRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previewTrigger?.focus();
    };
  }, [previewOpen]);

  useEffect(() => {
    if (!addExperienceOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !creatingExperience) {
        setAddExperienceOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [addExperienceOpen, creatingExperience]);

  useEffect(() => {
    if (!markdownHelpOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!markdownHelpRef.current?.contains(event.target as Node)) {
        setMarkdownHelpOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMarkdownHelpOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [markdownHelpOpen]);

  async function selectDocument(documentPath: string, initial = false) {
    if (!initial && isDirty && !window.confirm("Descartar as alterações não salvas?")) {
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/documents?path=${encodeURIComponent(documentPath)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as DocumentContent | { error: string };

      if (!response.ok || !("content" in data)) {
        throw new Error("error" in data ? data.error : "Não foi possível abrir esta página.");
      }

      setSelectedPath(data.path);
      setContent(data.content);
      setSavedContent(data.content);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao abrir página.");
    } finally {
      setLoading(false);
    }
  }

  async function saveDocument() {
    if (!selectedPath || !isDirty || saving) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/documents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, content }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Não foi possível salvar esta página.");
      }

      setSavedContent(content);
      setNotice("Salvo. A prévia será atualizada pelo VitePress.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Erro ao salvar página.");
    } finally {
      setSaving(false);
    }
  }

  async function createExperience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingExperience) return;

    const formData = new FormData(event.currentTarget);
    const payload = {
      title: formData.get("title"),
      role: formData.get("role"),
      period: formData.get("period"),
      location: formData.get("location"),
      projectContext: formData.get("projectContext"),
      contributions: formData.get("contributions"),
      technologies: formData.get("technologies"),
    };

    setCreatingExperience(true);
    setExperienceError("");

    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { path?: string; error?: string };

      if (!response.ok || !data.path) {
        throw new Error(data.error ?? "Could not create this experience.");
      }

      const documentsResponse = await fetch("/api/documents", { cache: "no-store" });
      if (!documentsResponse.ok) {
        throw new Error("Experience was created, but the page list could not be refreshed.");
      }
      const documentsData = (await documentsResponse.json()) as { documents: DocumentSummary[] };
      setDocuments(documentsData.documents);
      setAddExperienceOpen(false);
      await selectDocument(data.path, true);
      setNotice("Experience created. Index and CV files regenerated.");
    } catch (createError) {
      setExperienceError(createError instanceof Error ? createError.message : "Could not create this experience.");
    } finally {
      setCreatingExperience(false);
    }
  }

  const experienceDocuments = documents.filter((document) => document.path.startsWith("experiencias/"));
  const profileDocuments = documents.filter((document) => !document.path.startsWith("experiencias/"));

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">LR</div>
          <div>
            <p className="eyebrow">LEONARDO RIVALDO</p>
            <h1>Content desk</h1>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="local-indicator"><span /> Local only</span>
          <span className={`save-state ${isDirty ? "is-dirty" : ""}`}>
            {saving ? "Saving" : isDirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button
            ref={previewTriggerRef}
            className="preview-trigger"
            type="button"
            onClick={() => setPreviewOpen(true)}
            disabled={!selectedPath}
            title="Open site preview"
          >
            <Eye size={16} aria-hidden="true" />
            <span>Preview</span>
          </button>
          <button className="save-button" type="button" onClick={saveDocument} disabled={!isDirty || saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar" aria-label="Content pages">
          <div className="sidebar-heading">
            <span>CONTENT</span>
            <span className="document-count">{documents.length}</span>
          </div>

          <nav>
            <p className="nav-group-label">PROFILE</p>
            {profileDocuments.map((document) => (
              <button
                className={`document-link ${selectedPath === document.path ? "is-selected" : ""}`}
                key={document.path}
                type="button"
                onClick={() => void selectDocument(document.path)}
              >
                <span className="document-type">M</span>
                <span>{formatPath(document.path)}</span>
              </button>
            ))}

            <div className="experience-nav-heading">
              <p className="nav-group-label experience-label">EXPERIENCES</p>
              <button
                className="add-experience-button"
                type="button"
                onClick={() => {
                  setExperienceError("");
                  setAddExperienceOpen(true);
                }}
                title="Add experience"
              >
                <Plus size={14} aria-hidden="true" />
                <span>Add experience</span>
              </button>
            </div>
            {experienceDocuments.map((document) => (
              <button
                className={`document-link ${selectedPath === document.path ? "is-selected" : ""}`}
                key={document.path}
                type="button"
                onClick={() => void selectDocument(document.path)}
                title={document.title}
              >
                <span className="document-type">M</span>
                <span>{document.title || formatPath(document.path)}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <span className="folder-glyph" aria-hidden="true">/</span>
            <span>src/docs</span>
          </div>
        </aside>

        <section className="editor-panel" aria-label="Markdown editor">
          <div className="panel-heading editor-heading">
            <div>
              <p className="eyebrow">{selectedDocument?.path ?? "DOCUMENT"}</p>
              <h2>{selectedDocument?.title ?? "Select a page"}</h2>
            </div>
            <span className="markdown-badge">MARKDOWN</span>
          </div>

          <div className="editor-toolbar">
            <div className="editor-toolbar-leading">
              <span><span className="toolbar-dot" /> Source</span>
              <div className="markdown-help" ref={markdownHelpRef}>
                <button
                  className="help-trigger"
                  type="button"
                  aria-label="Markdown reference"
                  aria-expanded={markdownHelpOpen}
                  aria-controls="markdown-reference"
                  title="Markdown reference"
                  onClick={() => setMarkdownHelpOpen((isOpen) => !isOpen)}
                >
                  <CircleHelp size={15} aria-hidden="true" />
                </button>
                {markdownHelpOpen && (
                  <div className="markdown-help-popover" id="markdown-reference" role="region" aria-label="Markdown quick reference">
                    <div className="markdown-help-heading">
                      <div>
                        <p className="eyebrow">EDITOR REFERENCE</p>
                        <h3>Markdown basics</h3>
                      </div>
                      <button
                        className="help-close"
                        type="button"
                        aria-label="Close Markdown reference"
                        onClick={() => setMarkdownHelpOpen(false)}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                    <dl className="markdown-reference-list">
                      <div><dt>Heading</dt><dd><code>{"## Section"}</code></dd></div>
                      <div><dt>Bold</dt><dd><code>{"**important**"}</code></dd></div>
                      <div><dt>Italic</dt><dd><code>{"*emphasis*"}</code></dd></div>
                      <div><dt>Link</dt><dd><code>{"[label](https://...)"}</code></dd></div>
                      <div><dt>List</dt><dd><code>{"- Item"}</code></dd></div>
                      <div><dt>Quote</dt><dd><code>{"> Quote"}</code></dd></div>
                      <div><dt>Inline code</dt><dd><code>{"`code`"}</code></dd></div>
                      <div><dt>Code block</dt><dd><code className="code-block-example">{"```ts\nconst ready = true\n```"}</code></dd></div>
                    </dl>
                  </div>
                )}
              </div>
            </div>
            <span className="line-count">{content.split("\n").length} lines</span>
          </div>

          {loading ? (
            <div className="editor-message">Loading document...</div>
          ) : (
            <textarea
              aria-label="Markdown source"
              className="markdown-editor"
              spellCheck={false}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={!selectedPath}
            />
          )}

          <div className="editor-footer" aria-live="polite">
            <span className={error ? "message-error" : "message-notice"}>{error || notice || "Changes are saved to the local Markdown file."}</span>
            <span>UTF-8 · LF</span>
          </div>
        </section>

      </div>

      {addExperienceOpen && (
        <div
          className="experience-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creatingExperience) {
              setAddExperienceOpen(false);
            }
          }}
        >
          <section className="experience-dialog" role="dialog" aria-modal="true" aria-labelledby="experience-dialog-title">
            <header className="experience-dialog-header">
              <div>
                <p className="eyebrow">NEW MARKDOWN PAGE</p>
                <h2 id="experience-dialog-title">Add experience</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close add experience form"
                title="Close"
                disabled={creatingExperience}
                onClick={() => setAddExperienceOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <form className="experience-form" onSubmit={createExperience}>
              <div className="experience-form-grid">
                <label>
                  <span>Title</span>
                  <input name="title" required maxLength={120} placeholder="Capgemini – Project" />
                </label>
                <label>
                  <span>Role</span>
                  <input name="role" required maxLength={120} placeholder="Software Engineer" />
                </label>
                <label>
                  <span>Period</span>
                  <input name="period" required maxLength={80} placeholder="August 2024–March 2026" />
                </label>
                <label>
                  <span>Location</span>
                  <input name="location" required maxLength={100} placeholder="Fundão" />
                </label>
                <label className="experience-form-wide">
                  <span>Project context</span>
                  <textarea name="projectContext" required rows={3} maxLength={3000} />
                </label>
                <label className="experience-form-wide">
                  <span>My contribution</span>
                  <textarea name="contributions" required rows={5} maxLength={8000} />
                </label>
                <label className="experience-form-wide">
                  <span>Technologies and skills</span>
                  <textarea name="technologies" required rows={4} maxLength={3000} />
                </label>
              </div>
              {experienceError && <p className="experience-form-error" role="alert">{experienceError}</p>}
              <footer className="experience-form-footer">
                <button className="cancel-button" type="button" disabled={creatingExperience} onClick={() => setAddExperienceOpen(false)}>
                  Cancel
                </button>
                <button className="save-button" type="submit" disabled={creatingExperience}>
                  {creatingExperience ? "Creating..." : "Create experience"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {previewOpen && selectedPath && (
        <div
          className="preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPreviewOpen(false);
            }
          }}
        >
          <section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
            <header className="preview-dialog-header">
              <div>
                <p className="eyebrow">LIVE SITE · {selectedDocument?.path}</p>
                <h2 id="preview-title">{selectedDocument?.title ?? "Preview"}</h2>
              </div>
              <div className="preview-dialog-actions">
                <span className="preview-indicator"><span /> 127.0.0.1:5175</span>
                <button
                  ref={previewCloseRef}
                  className="icon-button"
                  type="button"
                  aria-label="Close preview"
                  title="Close preview"
                  onClick={() => setPreviewOpen(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </header>
            <iframe
              key={selectedPath}
              className="preview-dialog-frame"
              src={`${PREVIEW_ORIGIN}${getPreviewPath(selectedPath)}`}
              title={`Preview: ${selectedDocument?.title ?? selectedPath}`}
            />
          </section>
        </div>
      )}
    </main>
  );
}
