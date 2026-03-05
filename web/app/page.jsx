'use client';

import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'cf_ai_resume_jd_history_v1';
const DRAFT_KEY = 'cf_ai_resume_jd_draft_v1';
const PROD_WORKER_BASE = 'https://cd-ai-forgeai.mohitkumargurnani.workers.dev';
const LOCAL_WORKER_BASE = 'http://127.0.0.1:8787';
const LOADING_STEPS = [
  'Parsing resume',
  'Analyzing job description',
  'Writing cover letter',
  'Optimizing skills',
  'Drafting email',
];

export default function HomePage() {
  const [resume, setResume] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [tone, setTone] = useState('professional');
  const [apiBase, setApiBase] = useState(LOCAL_WORKER_BASE);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [coverLetter, setCoverLetter] = useState('');
  const [skills, setSkills] = useState([]);
  const [email, setEmail] = useState('');
  const [history, setHistory] = useState([]);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editingValue, setEditingValue] = useState('');

  const [step, setStep] = useState(1);
  const [currentStep, setCurrentStep] = useState(0);
  const [copiedCover, setCopiedCover] = useState(false);
  const [copiedSkills, setCopiedSkills] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (!document.getElementById('forge-fonts')) {
      const link = document.createElement('link');
      link.id = 'forge-fonts';
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    const storedApiBase = localStorage.getItem('apiBase');
    if (storedApiBase) {
      setApiBase(storedApiBase);
    } else if (typeof window !== 'undefined') {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      setApiBase(isLocalhost ? LOCAL_WORKER_BASE : PROD_WORKER_BASE);
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized = parsed.map((item, idx) => normalizeHistoryEntry(item, idx));
          setHistory(normalized);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        }
      } catch {
        // Ignore malformed local history.
      }
    }

    const draftRaw = localStorage.getItem(DRAFT_KEY);
    if (draftRaw) {
      try {
        const draft = JSON.parse(draftRaw);
        if (typeof draft?.resume === 'string') {
          setResume(draft.resume);
        }
        if (typeof draft?.jobDescription === 'string') {
          setJobDescription(draft.jobDescription);
        }
        if (typeof draft?.tone === 'string') {
          setTone(draft.tone);
        }
      } catch {
        // Ignore malformed draft state.
      }
    }

    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const nextDraft = {
      jobDescription,
      tone,
    };

    if (resume.trim()) {
      nextDraft.resume = resume;
    }

    localStorage.setItem(DRAFT_KEY, JSON.stringify(nextDraft));
  }, [resume, jobDescription, tone, hasHydrated]);

  const hasHistory = useMemo(() => history.length > 0, [history]);
  const parsedEmail = useMemo(() => parseEmailContent(email), [email]);

  async function handleGenerate() {
    const trimmedResume = resume.trim();
    const trimmedJd = jobDescription.trim();
    const trimmedApiBase = apiBase.trim() || LOCAL_WORKER_BASE;

    localStorage.setItem('apiBase', trimmedApiBase);

    if (!trimmedResume || !trimmedJd) {
      setStatus('Resume and job description are required.');
      return;
    }

    setIsLoading(true);
    setStatus('');
    setCurrentStep(0);
    setCopiedCover(false);
    setCopiedSkills(false);
    setCopiedEmail(false);
    setCoverLetter('');
    setSkills([]);
    setEmail('');

    let stepInterval;

    try {
      const fetchPromise = fetch(`${trimmedApiBase}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: trimmedResume,
          job_description: trimmedJd,
          tone,
        }),
      });

      stepInterval = setInterval(() => {
        setCurrentStep((prev) => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
      }, 1200);

      const response = await fetchPromise;
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Request failed');
      }

      const nextCover = json.cover_letter || '';
      const nextSkills = Array.isArray(json.skills) ? json.skills : [];
      const nextEmail = json.email || '';

      setCoverLetter(nextCover);
      setSkills(nextSkills);
      setEmail(nextEmail);
      setHasGenerated(true);

      const entry = {
        id: createHistoryId(),
        createdAt: new Date().toISOString(),
        tone,
        title: '',
        collapsed: false,
        resumePreview: trimmedResume.slice(0, 110),
        jdPreview: trimmedJd.slice(0, 110),
        result: {
          cover_letter: nextCover,
          skills: nextSkills,
          email: nextEmail,
        },
      };

      persistHistory([entry, ...history].slice(0, 10));
      setStatus('Done.');
    } catch (error) {
      setStatus(`Error: ${error.message || 'Unknown error'}`);
    } finally {
      if (stepInterval) {
        clearInterval(stepInterval);
      }
      setCurrentStep(0);
      setIsLoading(false);
    }
  }

  function clearSavedResume() {
    setResume('');

    try {
      const draftRaw = localStorage.getItem(DRAFT_KEY);
      if (!draftRaw) {
        return;
      }
      const draft = JSON.parse(draftRaw);
      if (!draft || typeof draft !== 'object') {
        return;
      }
      delete draft.resume;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore malformed draft state.
    }
  }

  async function copyToClipboard(text, setCopied) {
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus('Copy failed. Clipboard permission denied.');
    }
  }

  function loadFromHistory(item) {
    setCoverLetter(item?.result?.cover_letter || '');
    setSkills(Array.isArray(item?.result?.skills) ? item.result.skills : []);
    setEmail(item?.result?.email || '');
    setHasGenerated(true);
    setStatus('Loaded from local history.');
  }

  function clearHistory() {
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
    setEditingId('');
    setEditingValue('');
    setStatus('Local history cleared.');
  }

  function persistHistory(nextHistory) {
    setHistory(nextHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
  }

  function toggleCollapse(id) {
    const nextHistory = history.map((item) => {
      if (item.id !== id) {
        return item;
      }
      return { ...item, collapsed: !item.collapsed };
    });
    persistHistory(nextHistory);
  }

  function beginRename(item) {
    setEditingId(item.id);
    setEditingValue(item.title || defaultHistoryTitle(item));
  }

  function saveRename(id) {
    const value = editingValue.trim();
    const nextHistory = history.map((item) => {
      if (item.id !== id) {
        return item;
      }
      return { ...item, title: value };
    });
    persistHistory(nextHistory);
    setEditingId('');
    setEditingValue('');
  }

  function cancelRename() {
    setEditingId('');
    setEditingValue('');
  }

  function updateEmailBody(nextBodyText) {
    if (parsedEmail.hasSubject) {
      setEmail(`Subject: ${parsedEmail.subject}\n\n${nextBodyText}`.trim());
      return;
    }

    setEmail(nextBodyText);
  }

  const showCoverPanel = hasGenerated || coverLetter.trim();
  const showSkillsPanel = hasGenerated || skills.length > 0;
  const showEmailPanel = hasGenerated || email.trim();

  return (
    <>
      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #04101a;
          --surface: #0a1524;
          --border: #123247;
          --border-hover: #1f5a7d;
          --text: #e8f4ff;
          --muted: #86a4bb;
          --accent: #11efd2;
          --accent-dim: #073a36;
          --success: #22C55E;
          --mono: 'JetBrains Mono', 'Fira Code', monospace;
          --sans: 'DM Sans', system-ui, sans-serif;
          --display: 'Playfair Display', Georgia, serif;
        }

        body {
          background-color: var(--bg);
          background-image:
            radial-gradient(circle at 80% 20%, rgba(17, 239, 210, 0.14), transparent 36%),
            radial-gradient(circle at 15% 85%, rgba(0, 170, 255, 0.1), transparent 34%),
            linear-gradient(rgba(16, 94, 126, 0.16) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16, 94, 126, 0.16) 1px, transparent 1px);
          background-size: auto, auto, 32px 32px, 32px 32px;
          color: var(--text);
          font-family: var(--sans);
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
        }

        .app {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1rem;
          overflow-x: hidden;
        }

        .layout {
          width: 100%;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
          gap: 1rem;
          align-items: start;
        }

        .content {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .panel { min-width: 0; }

        @media (max-width: 1100px) {
          .layout { grid-template-columns: 1fr; }
        }

        .hero { padding: 3rem 0 2rem; }

        h1.kicker {
          font-family: var(--display);
          font-size: 2.8rem;
          background: linear-gradient(135deg, #f7fdff 0%, #96fff2 45%, var(--accent) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 0.5rem;
        }

        .subtitle {
          color: var(--muted);
          font-size: 1rem;
          max-width: 520px;
          line-height: 1.6;
        }

        .panel {
          background: linear-gradient(135deg, rgba(10, 21, 36, 0.94) 0%, rgba(8, 23, 42, 0.94) 58%, rgba(9, 39, 59, 0.86) 100%);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 1.5rem;
          box-shadow: 0 0 0 1px rgba(17, 239, 210, 0.08), 0 14px 34px rgba(0, 0, 0, 0.35);
        }

        .panel:hover {
          border-color: var(--border-hover);
          transition: border-color 0.2s;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          margin-bottom: 1rem;
        }

        label {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        textarea, input, select {
          background: #050f1d;
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: var(--sans);
          font-size: 0.9rem;
          padding: 0.75rem 1rem;
          width: 100%;
          resize: vertical;
          outline: none;
          transition: border-color 0.2s;
        }

        button { width: auto; }

        textarea:focus, input:focus, select:focus { border-color: var(--accent); }
        select option { background: var(--surface); }

        .progress-bar { display: flex; align-items: center; gap: 0; margin-bottom: 2rem; }
        .progress-step { display: flex; flex-direction: column; align-items: center; flex: 1; position: relative; }
        .progress-step::after {
          content: '';
          position: absolute;
          top: 12px;
          left: 50%;
          width: 100%;
          height: 1px;
          background: var(--border);
          z-index: 0;
        }

        .progress-step:last-child::after { display: none; }

        .step-circle {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 1.5px solid var(--border);
          background: var(--bg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          z-index: 1;
          color: var(--muted);
          transition: all 0.2s;
        }

        .step-circle.active {
          border-color: var(--accent);
          color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-dim);
        }

        .step-circle.done {
          background: var(--accent);
          border-color: var(--accent);
          color: white;
        }

        .step-label {
          font-size: 0.7rem;
          color: var(--muted);
          margin-top: 0.3rem;
          text-align: center;
          white-space: nowrap;
        }

        .step-label.active { color: var(--text); }

        button[type=button].generate-btn {
          width: 100%;
          padding: 0.85rem;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 8px;
          font-family: var(--sans);
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.1s;
        }

        button[type=button].generate-btn:hover:not(:disabled) { opacity: 0.88; }
        button[type=button].generate-btn:active:not(:disabled) { transform: scale(0.99); }
        button[type=button].generate-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .nav-btns { display: flex; gap: 0.75rem; margin-top: 0.5rem; }
        .nav-btns > button { width: 100%; }

        .btn-secondary {
          flex: 1;
          padding: 0.75rem;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: var(--sans);
          font-size: 0.9rem;
          cursor: pointer;
          transition: border-color 0.2s;
        }

        .btn-secondary:hover { border-color: var(--border-hover); }
        .btn-primary { flex: 2; }

        .step-indicator {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          margin-bottom: 1.25rem;
        }

        .step-row { display: flex; align-items: center; gap: 0.75rem; }

        .step-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 1.5px solid var(--border);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.65rem;
        }

        .step-dot.done { background: var(--success); border-color: var(--success); color: white; }
        .step-dot.active { border-color: var(--accent); animation: pulse 1s infinite; }
        .step-dot.pending { opacity: 0.3; }
        .step-text { font-size: 0.82rem; color: var(--muted); }
        .step-text.active { color: var(--text); }

        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--accent-dim); }
          50% { box-shadow: 0 0 0 5px var(--accent-dim); }
        }

        .resume-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: #0D2B0D;
          border: 1px solid #22C55E33;
          border-radius: 20px;
          padding: 0.25rem 0.75rem;
          font-size: 0.78rem;
          color: var(--success);
          margin-bottom: 0.5rem;
        }

        .resume-pill button {
          background: none;
          border: none;
          color: var(--muted);
          font-size: 0.75rem;
          cursor: pointer;
          padding: 0;
          margin-left: 0.25rem;
        }

        .resume-pill button:hover { color: var(--text); }

        .output-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }

        .output-header h2 {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .copy-btn {
          width: auto;
          min-width: 72px;
          padding: 0.3rem 0.75rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--muted);
          font-size: 0.78rem;
          cursor: pointer;
          transition: all 0.15s;
          font-family: var(--sans);
        }

        .copy-btn:hover { border-color: var(--border-hover); color: var(--text); }
        .copy-btn.copied { border-color: var(--success); color: var(--success); }

        .output-editable {
          font-family: var(--mono);
          font-size: 0.85rem;
          line-height: 1.7;
          color: var(--text);
          white-space: pre-wrap;
          outline: none;
          border-radius: 6px;
          padding: 0.5rem;
          border: 1px solid transparent;
          min-height: 80px;
        }

        .output-editable:focus {
          border-color: var(--border);
          background: var(--bg);
        }

        .edit-hint {
          font-size: 0.72rem;
          color: var(--muted);
          margin-top: 0.4rem;
        }

        .empty-output {
          color: var(--muted);
          font-size: 0.85rem;
          font-style: italic;
          padding: 1rem 0;
        }

        .email-subject-row {
          display: flex;
          align-items: baseline;
          gap: 0.75rem;
          padding: 0.6rem 0.75rem;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          margin-bottom: 0.75rem;
        }

        .email-subject-label {
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          white-space: nowrap;
        }

        .email-subject-text {
          font-size: 0.88rem;
          color: var(--text);
          font-family: var(--mono);
        }

        .skills-chips {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.25rem 0;
          width: 100%;
        }

        .chip {
          background: var(--accent-dim);
          border: 1px solid #11efd255;
          color: var(--accent);
          padding: 0.3rem 0.75rem;
          border-radius: 20px;
          font-size: 0.8rem;
          font-family: var(--mono);
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          max-width: 100%;
          width: fit-content;
        }

        .sidebar { position: sticky; top: 1.5rem; min-width: 0; }

        .sidebar-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.25rem;
        }

        .sidebar-head h2 {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .clear-btn {
          background: none;
          border: none;
          color: var(--muted);
          font-size: 0.78rem;
          cursor: pointer;
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
        }

        .clear-btn:hover { color: var(--text); }

        .sidebar-sub {
          font-size: 0.78rem;
          color: var(--muted);
          margin-bottom: 1rem;
          line-height: 1.4;
        }

        .history { display: flex; flex-direction: column; gap: 0.75rem; }

        .history-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.75rem;
          transition: border-color 0.15s;
        }

        .history-card:hover { border-color: var(--border-hover); }

        .history-card-top {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          margin-bottom: 0.4rem;
        }

        .history-title-btn {
          background: none;
          border: none;
          color: var(--text);
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          text-align: left;
          padding: 0;
          font-family: var(--sans);
        }

        .history-title-btn:hover { color: var(--accent); }

        .history-meta { font-size: 0.72rem; color: var(--muted); }

        .history-preview {
          font-size: 0.75rem;
          color: var(--muted);
          line-height: 1.4;
          margin-bottom: 0.5rem;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .history-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }

        .mini-btn {
          width: auto;
          padding: 0.2rem 0.55rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--muted);
          font-size: 0.72rem;
          cursor: pointer;
          font-family: var(--sans);
          transition: all 0.15s;
        }

        .mini-btn:hover { border-color: var(--border-hover); color: var(--text); }
        .mini-btn.ghost { background: transparent; }

        .history-rename-row {
          display: flex;
          gap: 0.4rem;
          align-items: center;
          margin-top: 0.4rem;
        }

        .history-rename-input {
          flex: 1;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--text);
          font-size: 0.78rem;
          padding: 0.25rem 0.5rem;
          font-family: var(--sans);
        }

        .status {
          font-size: 0.8rem;
          color: var(--muted);
          margin-top: 0.5rem;
          min-height: 1.2em;
        }
      `}</style>

      <main className="app">
        <header className="hero panel">
          <h1 className="kicker">forgeAI</h1>
          <p className="subtitle">
            Generate a cover letter, role-matched skills, and recruiter email from your resume and target job description.
          </p>
        </header>

        <div className="layout">
          <section className="content">
            <section className="panel form-panel">
              <div className="progress-bar">
                {['Resume', 'Job Description', 'Tone & Generate'].map((label, idx) => {
                  const node = idx + 1;
                  const isDone = step > node;
                  const isActive = step === node;
                  return (
                    <div className="progress-step" key={label}>
                      <div className={`step-circle ${isDone ? 'done' : isActive ? 'active' : ''}`}>{isDone ? '✓' : node}</div>
                      <div className={`step-label ${isActive ? 'active' : ''}`}>{label}</div>
                    </div>
                  );
                })}
              </div>

              {step === 1 && (
                <>
                  {hasHydrated && resume.trim() && (
                    <div className="resume-pill">
                      ✓ Resume saved
                      <button type="button" onClick={clearSavedResume}>
                        · Clear
                      </button>
                    </div>
                  )}

                  <div className="field">
                    <label htmlFor="resume">Resume text</label>
                    <textarea
                      id="resume"
                      rows={9}
                      placeholder="Paste your resume — it'll be remembered"
                      value={resume}
                      onChange={(e) => setResume(e.target.value)}
                    />
                  </div>

                  <div className="nav-btns">
                    <button
                      type="button"
                      className="generate-btn btn-primary"
                      disabled={!resume.trim()}
                      onClick={() => setStep(2)}
                    >
                      Next →
                    </button>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="field">
                    <label htmlFor="jobDescription">Job description text</label>
                    <textarea
                      id="jobDescription"
                      rows={9}
                      placeholder="Paste job description text"
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                    />
                  </div>

                  <div className="nav-btns">
                    <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                      ← Back
                    </button>
                    <button
                      type="button"
                      className="generate-btn btn-primary"
                      disabled={!jobDescription.trim()}
                      onClick={() => setStep(3)}
                    >
                      Next →
                    </button>
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="field">
                    <label htmlFor="tone">Tone (optional)</label>
                    <select id="tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                      <option value="professional">Professional</option>
                      <option value="confident">Confident</option>
                      <option value="friendly">Friendly</option>
                    </select>
                  </div>

                  {isLoading && (
                    <div className="step-indicator">
                      {LOADING_STEPS.map((label, idx) => {
                        const isDone = idx < currentStep;
                        const isActive = idx === currentStep;
                        const dotClass = isDone ? 'done' : isActive ? 'active' : 'pending';
                        const symbol = isDone ? '✓' : isActive ? '●' : '○';
                        return (
                          <div className="step-row" key={label}>
                            <div className={`step-dot ${dotClass}`}>{symbol}</div>
                            <div className={`step-text ${isActive ? 'active' : ''}`}>{label}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="nav-btns">
                    <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                      ← Back
                    </button>
                    <button type="button" className="generate-btn btn-primary" onClick={handleGenerate} disabled={isLoading}>
                      {isLoading ? 'Generating...' : 'Generate'}
                    </button>
                  </div>
                </>
              )}

              <p className="status">{status}</p>
            </section>

            {showCoverPanel && (
              <section className="panel output">
                <div className="output-header">
                  <h2>Cover Letter</h2>
                  {coverLetter.trim() && (
                    <button
                      className={`copy-btn ${copiedCover ? 'copied' : ''}`}
                      type="button"
                      onClick={() => copyToClipboard(coverLetter, setCopiedCover)}
                    >
                      {copiedCover ? 'Copied ✓' : 'Copy'}
                    </button>
                  )}
                </div>

                {coverLetter.trim() ? (
                  <>
                    <div
                      key={coverLetter.slice(0, 20)}
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => setCoverLetter(e.currentTarget.innerText)}
                      className="output-editable"
                    >
                      {coverLetter}
                    </div>
                    <p className="edit-hint">Click to edit</p>
                  </>
                ) : (
                  <p className="empty-output">Nothing generated yet.</p>
                )}
              </section>
            )}

            {showSkillsPanel && (
              <section className="panel output">
                <div className="output-header">
                  <h2>Relevant Skills</h2>
                  {skills.length > 0 && (
                    <button
                      className={`copy-btn ${copiedSkills ? 'copied' : ''}`}
                      type="button"
                      onClick={() => copyToClipboard(skills.join('\n'), setCopiedSkills)}
                    >
                      {copiedSkills ? 'Copied ✓' : 'Copy'}
                    </button>
                  )}
                </div>

                {skills.length > 0 ? (
                  <div className="skills-chips">
                    {skills.map((skill, idx) => (
                      <span className="chip" key={`${skill}-${idx}`}>
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="empty-output">Nothing generated yet.</p>
                )}
              </section>
            )}

            {showEmailPanel && (
              <section className="panel output">
                <div className="output-header">
                  <h2>Recruiter Email</h2>
                  {email.trim() && (
                    <button
                      className={`copy-btn ${copiedEmail ? 'copied' : ''}`}
                      type="button"
                      onClick={() => copyToClipboard(email, setCopiedEmail)}
                    >
                      {copiedEmail ? 'Copied ✓' : 'Copy'}
                    </button>
                  )}
                </div>

                {email.trim() ? (
                  <>
                    {parsedEmail.hasSubject && (
                      <div className="email-subject-row">
                        <span className="email-subject-label">Subject</span>
                        <span className="email-subject-text">{parsedEmail.subject}</span>
                      </div>
                    )}
                    <div
                      key={email.slice(0, 20)}
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => updateEmailBody(e.currentTarget.innerText)}
                      className="output-editable"
                    >
                      {parsedEmail.body}
                    </div>
                    <p className="edit-hint">Click to edit</p>
                  </>
                ) : (
                  <p className="empty-output">Nothing generated yet.</p>
                )}
              </section>
            )}
          </section>

          <aside className="panel sidebar">
            <div className="sidebar-head">
              <h2>Application History</h2>
              <button className="clear-btn" type="button" onClick={clearHistory}>
                Clear
              </button>
            </div>
            <p className="sidebar-sub">Recent local generations. Click any item to load its output.</p>
            <div className="history">
              {!hasHistory ? (
                <p className="empty-output">No previous generations yet.</p>
              ) : (
                history.map((item, index) => {
                  const date = new Date(item.createdAt);
                  const labelDate = Number.isNaN(date.getTime()) ? item.createdAt : date.toLocaleString();
                  const displayTitle = item.title || defaultHistoryTitle(item);
                  const isEditing = editingId === item.id;
                  return (
                    <div className="history-item" key={item.id || `${item.createdAt}-${index}`}>
                      <div className="history-card">
                        <div className="history-card-top">
                          <button className="history-title-btn" type="button" onClick={() => loadFromHistory(item)}>
                            {displayTitle}
                          </button>
                          <span className="history-meta">{labelDate}</span>
                        </div>

                        {!item.collapsed && (
                          <div className="history-preview">
                            {item.resumePreview || ''} | {item.jdPreview || ''}
                          </div>
                        )}

                        {isEditing ? (
                          <div className="history-rename-row">
                            <input
                              className="history-rename-input"
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              maxLength={80}
                            />
                            <button className="mini-btn" type="button" onClick={() => saveRename(item.id)}>
                              Save
                            </button>
                            <button className="mini-btn ghost" type="button" onClick={cancelRename}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="history-actions">
                            <button className="mini-btn" type="button" onClick={() => loadFromHistory(item)}>
                              Load
                            </button>
                            <button className="mini-btn ghost" type="button" onClick={() => beginRename(item)}>
                              Rename
                            </button>
                            <button className="mini-btn ghost" type="button" onClick={() => toggleCollapse(item.id)}>
                              {item.collapsed ? 'Expand' : 'Collapse'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function createHistoryId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `hist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultHistoryTitle(item) {
  return `Application (${item?.tone || 'professional'})`;
}

function normalizeHistoryEntry(item, idx) {
  const safe = item && typeof item === 'object' ? item : {};
  return {
    id:
      typeof safe.id === 'string' && safe.id
        ? safe.id
        : `hist_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: typeof safe.createdAt === 'string' ? safe.createdAt : new Date().toISOString(),
    tone: typeof safe.tone === 'string' ? safe.tone : 'professional',
    title: typeof safe.title === 'string' ? safe.title : '',
    collapsed: Boolean(safe.collapsed),
    resumePreview: typeof safe.resumePreview === 'string' ? safe.resumePreview : '',
    jdPreview: typeof safe.jdPreview === 'string' ? safe.jdPreview : '',
    result:
      safe.result && typeof safe.result === 'object'
        ? safe.result
        : {
            cover_letter: '',
            skills: [],
            email: '',
          },
  };
}

function parseEmailContent(rawEmail) {
  if (typeof rawEmail !== 'string') {
    return { hasSubject: false, subject: '', body: '' };
  }

  const trimmed = rawEmail.trim();
  if (!trimmed.toLowerCase().startsWith('subject:')) {
    return { hasSubject: false, subject: '', body: rawEmail };
  }

  const splitIndex = trimmed.indexOf('\n\n');
  if (splitIndex === -1) {
    const subjectOnly = trimmed.replace(/^subject:\s*/i, '').trim();
    return { hasSubject: true, subject: subjectOnly, body: '' };
  }

  const subjectPart = trimmed.slice(0, splitIndex).replace(/^subject:\s*/i, '').trim();
  const bodyPart = trimmed.slice(splitIndex + 2);

  return {
    hasSubject: true,
    subject: subjectPart,
    body: bodyPart,
  };
}
