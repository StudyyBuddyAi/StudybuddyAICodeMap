import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookMarked,
  Check,
  FileText,
  Laptop,
  Layers,
  ListChecks,
  Moon,
  Smartphone,
  Sparkles,
  Sun,
  Users,
  Stethoscope,
  Activity,
  Shield,
  Zap,
  Target,
  TrendingUp,
  HeartPulse,
  Pill,
} from "lucide-react";
import "@/styles/openmed-tokens.css";
import "@/styles/openmed-components.css";

const APP_STORAGE_KEYS = [
  "sb_welcomed",
  "sb_first_sheet_seen",
  "sb_first_deck_seen",
  "sb_sheet_hint_dismissed",
  "studybuddy_decks_v1",
  "studybuddy_history",
];

const hasUsedAppBefore = () =>
  APP_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null);

const CONTACT_EMAIL = "mailto:osama200az@gmail.com";

const SOCIALS = {
  instagram: "https://www.instagram.com/getstudybuddyai/",
  linkedin: "https://www.linkedin.com/company/studdybuddyai",
  telegram: "https://t.me/studybuddyai",
};

const NAV_LINKS = [
  { href: "#playground", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#qbank", label: "QBank" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const STEPS = [
  {
    name: "Enter a topic",
    desc: "Type any medical topic — no PDF upload needed. StudyBuddy AI maps it to your curriculum automatically.",
  },
  {
    name: "Get your study sheet",
    desc: "A structured clinical sheet with overview, pathophysiology, diagnosis, and management — in seconds.",
  },
  {
    name: "Practice with the QBank",
    desc: "Single-best-answer vignettes for the topic you just studied. The engine tracks what you get wrong.",
  },
  {
    name: "Review and repeat",
    desc: "Spaced repetition surfaces weak spots. Inline Enhance deepens any concept. PubMed links verify the evidence.",
  },
];

const RUNTIMES = [
  {
    icon: Laptop,
    eyebrow: "Web app",
    title: "Full feature set in your browser",
    desc: "No install, no setup. Open a tab and start generating.",
    link: { label: "Open StudyBuddy →", to: "/dashboard" },
  },
  {
    icon: Smartphone,
    eyebrow: "Mobile-ready",
    title: "Study between lectures",
    desc: "Optimized for the ten minutes you get on the go.",
    link: null,
  },
  {
    icon: Users,
    eyebrow: "Study groups",
    title: "Compete with classmates",
    desc: "Share decks and climb the leaderboard together.",
    link: null,
  },
];

const FEATURES = [
  {
    icon: Stethoscope,
    title: "AI Study Sheets",
    desc: "Topic name in — structured clinical sheet out. Covers overview, pathophysiology, diagnosis, and management.",
    tags: ["GPT-OSS 20B", "Instant"],
  },
  {
    icon: Target,
    title: "Smart QBank",
    desc: "Single-best-answer clinical vignettes with full explanations. Adaptive — the engine tracks your weak spots.",
    tags: ["Adaptive", "SM-2"],
  },
  {
    icon: Layers,
    title: "Flashcard Decks",
    desc: "Generate decks from any topic or import your own. Spaced repetition surfaces cards when retention is lowest.",
    tags: ["Spaced rep", "Auto-gen"],
  },
  {
    icon: Shield,
    title: "PubMed Citations",
    desc: "Every study sheet links to real PubMed sources via NIH E-utilities. Evidence-grounded, not hallucinated.",
    tags: ["Pro", "NIH API"],
  },
  {
    icon: TrendingUp,
    title: "Progress Analytics",
    desc: "Session history, subject coverage, and accuracy trends. See exactly where your knowledge gaps are.",
    tags: ["Dashboard", "Heatmap"],
  },
  {
    icon: Zap,
    title: "Inline Enhance",
    desc: "Highlight any term in a study sheet to pull up a deep-dive sidebar — like AMBOSS, built in.",
    tags: ["Pro", "Streaming"],
  },
];

const SUBJECT_FILTERS = [
  "All",
  "Cardiology",
  "Pharmacology",
  "Pathology",
  "Surgery",
  "Microbiology",
];

const SUBJECTS = [
  {
    name: "Cardiology",
    arch: "ECG · Heart failure · Arrhythmias",
    tags: ["ECG", "Heart failure", "Arrhythmias"],
  },
  {
    name: "Pharmacology",
    arch: "Mechanisms · Drug interactions · Toxicology",
    tags: ["Mechanisms", "Drug interactions"],
  },
  {
    name: "Pathology",
    arch: "Histology · Systemic · Neoplasia",
    tags: ["Histology", "Systemic"],
  },
  {
    name: "Surgery",
    arch: "Pre-op assessment · Post-op care · Trauma",
    tags: ["Pre-op", "Post-op", "Trauma"],
  },
  {
    name: "Microbiology",
    arch: "Bacteriology · Virology · Parasitology",
    tags: ["Bacteria", "Viruses", "Parasites"],
  },
  {
    name: "Anatomy",
    arch: "Gross anatomy · Neuroanatomy · Embryology",
    tags: ["Gross", "Neuroanatomy"],
  },
];

const FAQS = [
  {
    q: "What is StudyBuddy AI?",
    a: "StudyBuddy AI is an AI-powered study platform built for medical students. Enter any topic and get a structured clinical study sheet, practice questions, and flashcard decks — all in one place. Built by a final-year medical student in Gaza, priced for MENA.",
  },
  {
    q: "Is it aligned with USMLE?",
    a: "Yes. The QBank is written in USMLE Step 1 style — clinical vignette, single best answer, plausible distractors — and questions are tagged by subject and domain so you can target your practice sessions. Arab Board tagging is on the roadmap.",
  },
  {
    q: "How is this different from Anki or Amboss?",
    a: "StudyBuddy AI generates content from any topic you name — no pre-made decks to buy, no textbook to upload. The Inline Enhance feature works like AMBOSS but is built directly into your study sheets. And it's designed for MENA pricing, not US pricing.",
  },
  {
    q: "Is my data private?",
    a: "Your study sheets, decks, and session history sync to your account via Supabase. We don't sell your data or share it with third parties. PubMed citations pull from NIH's public API.",
  },
  {
    q: "Can I use it on my phone?",
    a: "Yes — StudyBuddy AI is fully mobile-optimized. A native app is on the roadmap.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. The free plan includes the full AI study sheet generator and QBank access with no credit card required. Pro ($5/mo) unlocks unlimited usage, PubMed citations, the Inline Enhance sidebar, and the Claude Haiku model tier.",
  },
];

const Index = () => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  // Same seeding rule as the in-app ThemeToggle: stored choice wins, else OS preference.
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("All");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isHomeRoute = window.location.pathname === "/" || window.location.pathname === "/home";

    if (hasUsedAppBefore() && !isHomeRoute) {
      navigate("/dashboard", { replace: true });
      return;
    }

    setReady(true);
  }, [navigate]);

  // Anchor links need smooth scrolling, but only while this page is mounted.
  useEffect(() => {
    document.documentElement.classList.add("openmed-page");
    // Apply DESIGN.md colors
    document.documentElement.style.setProperty('--clinical-blue', '#0F4C81');
    document.documentElement.style.setProperty('--vital-teal', '#008080');
    document.documentElement.style.setProperty('--serum-slate', '#64748B');
    document.documentElement.style.setProperty('--bone-white', '#F8FAFC');
    document.documentElement.style.setProperty('--surface-bg', '#F7F9FB');
    document.documentElement.style.setProperty('--surface-dim', '#d8dadc');
    return () => {
      document.documentElement.classList.remove("openmed-page");
      document.documentElement.style.removeProperty('--clinical-blue');
      document.documentElement.style.removeProperty('--vital-teal');
      document.documentElement.style.removeProperty('--serum-slate');
      document.documentElement.style.removeProperty('--bone-white');
      document.documentElement.style.removeProperty('--surface-bg');
      document.documentElement.style.removeProperty('--surface-dim');
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    if (!ready) return;
    const sections = rootRef.current?.querySelectorAll("[data-screen]");
    if (!sections?.length) return;

    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ready]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  if (!ready) return null;

  const visibleSubjects =
    filter === "All" ? SUBJECTS : SUBJECTS.filter((s) => s.name === filter);

  return (
    <div className="openmed" ref={rootRef}>
      {/* ---------- Header ---------- */}
      <header className={menuOpen ? "nav menu-open" : "nav"}>
        <div className="container nav-inner">
          <Link to="/" className="logo" aria-label="StudyBuddy home" style={{ color: '#0F4C81' }}>
            <div className="flex items-center gap-2">
              <Stethoscope size={24} strokeWidth={2} />
              <span className="wordmark">StudyBuddy AI</span>
            </div>
            <span className="version-tag">BETA</span>
          </Link>

          <nav className="nav-menu" id="primaryNav" aria-label="Primary">
            <ul className="nav-links">
              {NAV_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <a href={href} onClick={() => setMenuOpen(false)}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="nav-actions">
            <button
              className="btn btn-primary"
              style={{ backgroundColor: '#111827', borderColor: '#111827', color: '#fff', borderRadius: '9999px', padding: '10px 20px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px' }}
              onClick={() => navigate("/dashboard?start=sheet")}
            >
              <span className="btn-label">Get early access</span>
              <ArrowRight className="icon" size={16} strokeWidth={1.6} />
            </button>
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              title="Toggle theme"
            >
              {isDark ? (
                <Sun size={16} strokeWidth={1.6} />
              ) : (
                <Moon size={16} strokeWidth={1.6} />
              )}
            </button>
            <button
              className="nav-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="primaryNav"
            >
              <span className="nav-toggle-bar" aria-hidden="true" />
              <span className="nav-toggle-bar" aria-hidden="true" />
              <span className="nav-toggle-bar" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section id="home" className="hero bg-grid" data-screen style={{ backgroundColor: '#F7F9FB', padding: '60px 0 80px' }}>
          <div
            className="container hero-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
              gap: 'clamp(24px, 4vw, 40px)',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <div>
              <div className="eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '16px' }}>StudyBuddy AI · Built for Medical Students</div>
              <h1 className="display-xl hero-title " style={{ color: '#191c1e', fontSize: 'clamp(32px, 7vw, 56px)', lineHeight: '1.1', fontWeight: '800', marginBottom: '24px' }}>
                Study smarter. Score higher.{" "}
                <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: '#0F4C81' }}>Pass.</span>
              </h1>
              <p className="body-lg hero-desc" style={{ color: '#42474f', fontSize: 'clamp(15px, 3.2vw, 18px)', lineHeight: '1.6', marginBottom: '32px' }}>
                StudyBuddy turns your curriculum into AI-powered sheets, questions, and
                explanations — so{" "}
                <span
                  style={{
                    background: "#d2e4ff",
                    color: "#0F4C81",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    fontWeight: '500'
                  }}
                >
                  every study hour compounds
                </span>
                . Built by a medical student, for medical students in MENA and beyond.
              </p>

              <div className="hero-ctas flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:gap-4 sm:w-auto" style={{ display: 'flex', gap: '16px', marginBottom: '32px', alignItems: 'center' }}>
                <button
                  className="btn btn-primary btn-lg w-full sm:w-auto justify-center"
                  style={{ backgroundColor: '#111827', borderColor: '#111827', color: '#fff', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onClick={() => navigate("/dashboard?start=sheet")}
                >
                  Start for free
                  <ArrowRight className="icon" size={18} strokeWidth={1.6} />
                </button>
                <a className="btn btn-outline btn-lg w-full sm:w-auto justify-center" href="#playground" style={{ borderColor: '#d1d5db', color: '#374151', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', backgroundColor: '#fff' }}>
                  See how it works
                </a>
              </div>

              <div className="hero-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', color: '#6b7280', fontSize: '14px' }}>
                <span className="pip">AI Study Sheets</span>
                <span>·</span>
                <span className="pip">Smart QBank</span>
                <span>·</span>
                <span className="pip">USMLE-aligned</span>
                <span>·</span>
                <span className="pip">Built by an MD</span>
                <span>·</span>
                <span className="pip">Free to start</span>
              </div>
            </div>

            <div>
              <div className="phi-card" style={{ backgroundColor: '#111827', borderRadius: '20px', color: '#fff', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
                <div className="phi-head" style={{ padding: '16px 20px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#9ca3af' }}>
                  <div className="phi-head-left">
                    <span>question · cardiology</span>
                  </div>
                  <span className="phi-count" style={{ background: '#1f2937', padding: '2px 8px', borderRadius: '6px', color: '#e5e7eb' }}>Q 14 / 50</span>
                </div>
                <pre className="phi-body" style={{ padding: '20px', margin: '0', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6', color: '#e5e7eb', whiteSpace: 'pre-wrap' }}>
                  {`A 58-year-old man presents with
crushing chest pain radiating to
his left arm for 40 minutes.

ECG shows ST elevation in leads
II, III, and aVF.

`}
                  <span className="phi-token revealed" data-k="DATE" style={{ color: '#60a5fa', fontWeight: '600' }}>
                    Most likely diagnosis?
                  </span>
                  {`

A. NSTEMI
B. `}
                  <span className="phi-token revealed" data-k="NAME" style={{ color: '#34d399', fontWeight: '600', backgroundColor: 'rgba(52, 211, 153, 0.1)', padding: '2px 4px', borderRadius: '4px' }}>
                    Inferior STEMI
                  </span>
                  {`
C. Unstable angina
D. Pericarditis`}
                </pre>
                <div className="phi-foot" style={{ padding: '14px 20px', borderTop: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#9ca3af' }}>
                  <span>
                    Cardiology · <span className="lang-val" style={{ color: '#60a5fa' }}>USMLE Step 1</span>
                  </span>
                  <div className="phi-foot-right" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div className="phi-foot-dot" style={{ width: '8px', height: '8px', backgroundColor: '#34d399', borderRadius: '50%' }} />
                    <span style={{ color: '#34d399' }}>AI explanation ready</span>
                  </div>
                </div>
              </div>
              <div className="hero-caption" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', padding: '0 4px', fontSize: '13px', color: '#6b7280' }}>
                <span>Live QBank question · adaptive mode</span>
                <span className="play" style={{ color: '#0F4C81', fontWeight: '600', cursor: 'pointer' }}>▶ try it</span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Stat band ---------- */}
        <section className="statband" aria-label="Traction stats" style={{ backgroundColor: '#0F4C81', color: '#fff', padding: '48px 0' }}>
          <div className="container" style={{ textAlign: 'center' }}>
            <div className="statband-head" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              <span className="statband-eyebrow" style={{ color: '#8ebdf9', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Built for medical students</span>
              <span className="statband-desc" style={{ color: '#ffffff', fontSize: '24px', fontWeight: '700' }}>
                One workflow: study, practice, review — across every subject.
              </span>
            </div>
            <p
              className="body-lg"
              style={{
                color: "#8ebdf9",
                maxWidth: "58ch",
                margin: "16px auto 32px",
                textAlign: "center",
                fontSize: "16px"
              }}
            >
              Growing across MENA — medical students using StudyBuddy AI to study smarter,
              practice better, and walk into exams with confidence.
            </p>
            <div className="statband-foot" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
              <span className="statband-meta" style={{ color: '#ffffff', fontSize: '14px', fontWeight: '500' }}>Every subject, one workflow</span>
              <span className="statband-pills" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                {["Medicine", "Surgery", "Pharmacology", "Pathology", "Microbiology", "Anatomy"].map(
                  (pill) => (
                    <span className="statband-pill" key={pill} style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: '#ffffff', padding: '6px 16px', borderRadius: '9999px', fontSize: '14px', fontWeight: '500' }}>
                      {pill}
                    </span>
                  ),
                )}
              </span>
            </div>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section id="playground" data-screen style={{ backgroundColor: '#F7F9FB', padding: '80px 0' }}>
          <div className="container mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="playground-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '60px', alignItems: 'center' }}>
              <div className="playground-lead">
                <div className="eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>How it works</div>
                <h2 className="display-lg" style={{ color: '#191c1e', fontSize: '40px', fontWeight: '800', lineHeight: '1.2', marginBottom: '20px' }}>
                  Four steps to <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: '#0F4C81' }}>mastery</span>.
                </h2>
                <p className="body-lg" style={{ color: '#42474f', fontSize: '16px', lineHeight: '1.6', marginBottom: '32px' }}>
                  No prompting, no setup. The same loop every time: study, test, review,
                  repeat.
                </p>
                <ul className="playground-list" style={{ listStyle: 'none', padding: '0', display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '32px' }}>
                  {STEPS.map(({ name, desc }) => (
                    <li key={name} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                      <span className="playground-check" style={{ backgroundColor: '#0F4C81', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0', marginTop: '2px' }}>
                        <Check size={16} strokeWidth={2} color="white" />
                      </span>
                      <div>
                        <code className="code-inline" style={{ color: '#0F4C81', fontWeight: '700', fontSize: '15px' }}>{name}</code>
                        <div className="body-sm" style={{ marginTop: '4px', color: '#42474f', fontSize: '14px', lineHeight: '1.5' }}>
                          {desc}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <button className="btn btn-primary" style={{ backgroundColor: '#111827', borderColor: '#111827', color: '#fff', padding: '12px 24px', borderRadius: '9999px', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '8px' }} onClick={() => navigate("/qbank")}>
                  Explore the QBank
                  <ArrowUpRight className="icon" size={16} strokeWidth={1.6} />
                </button>
              </div>

              <div className="code-panel" style={{ backgroundColor: '#111827', borderRadius: '20px', color: '#fff', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
                <div className="code-head" style={{ padding: '14px 20px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="code-dots" style={{ display: 'flex', gap: '6px' }}>
                    <span className="code-dot red" style={{ width: '10px', height: '10px', backgroundColor: '#ef4444', borderRadius: '50%', display: 'inline-block' }} />
                    <span className="code-dot yellow" style={{ width: '10px', height: '10px', backgroundColor: '#f59e0b', borderRadius: '50%', display: 'inline-block' }} />
                    <span className="code-dot green" style={{ width: '10px', height: '10px', backgroundColor: '#10b981', borderRadius: '50%', display: 'inline-block' }} />
                  </div>
                  <span className="code-title" style={{ fontSize: '13px', color: '#9ca3af' }}>studybuddy · session</span>
                  <span className="code-copy" style={{ fontSize: '12px', background: '#1f2937', padding: '2px 8px', borderRadius: '6px', color: '#9ca3af' }}>50 questions</span>
                </div>
                <div className="code-install" style={{ padding: '12px 20px', borderBottom: '1px solid #1f2937', display: 'flex', gap: '10px', alignItems: 'center', background: '#030712' }}>
                  <span className="code-install-prompt" style={{ color: '#3b82f6', fontWeight: 'bold' }}>›</span>
                  <code className="code-install-cmd" style={{ color: '#e5e7eb', fontSize: '13px', fontFamily: 'monospace' }}>topic: acute coronary syndromes</code>
                </div>
                <div className="code-tabs" style={{ display: 'flex', borderBottom: '1px solid #1f2937', background: '#030712', padding: '0 16px' }}>
                  <button className="code-tab active" type="button" style={{ padding: '10px 16px', background: 'transparent', border: 'none', color: '#60a5fa', borderBottom: '2px solid #60a5fa', fontSize: '13px', fontWeight: '600' }}>
                    question
                  </button>
                  <button className="code-tab" type="button" style={{ padding: '10px 16px', background: 'transparent', border: 'none', color: '#9ca3af', fontSize: '13px' }}>
                    explanation
                  </button>
                  <button className="code-tab" type="button" style={{ padding: '10px 16px', background: 'transparent', border: 'none', color: '#9ca3af', fontSize: '13px' }}>
                    flashcards
                  </button>
                </div>
                <pre className="code-body" style={{ padding: '20px', margin: '0', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6', color: '#e5e7eb', whiteSpace: 'pre-wrap' }}>
                  <span className="cm" style={{ color: '#6b7280' }}>{`# Q14 · Cardiology · Step 1\n`}</span>
                  {`A 58-year-old man, crushing chest pain,\nST elevation in II, III, aVF.\n\n`}
                  <span className="kw" style={{ color: '#60a5fa', fontWeight: 'bold' }}>{`Answer`}</span>
                  {`  B. Inferior STEMI\n`}
                  <span className="kw" style={{ color: '#60a5fa', fontWeight: 'bold' }}>{`Vessel`}</span>
                  {`  right coronary artery `}
                  <span className="num" style={{ color: '#f59e0b' }}>{`(80%)`}</span>
                  {`\n\n`}
                  <span className="cm" style={{ color: '#6b7280' }}>{`# Why not the others\n`}</span>
                  {`A. NSTEMI      `}
                  <span className="str" style={{ color: '#f43f5e' }}>{`no ST elevation`}</span>
                  {`\nC. Angina      `}
                  <span className="str" style={{ color: '#f43f5e' }}>{`resolves at rest`}</span>
                  {`\nD. Pericarditis `}
                  <span className="str" style={{ color: '#f43f5e' }}>{`diffuse elevation`}</span>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Runtime trio ---------- */}
        <section id="anywhere" data-screen style={{ padding: '80px 0', backgroundColor: '#fff' }}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: '50px', textAlign: 'center' }}>
              <div className="eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Built to fit your study life</div>
              <h2 className="display-lg" style={{ maxWidth: "22ch", margin: '0 auto 16px', fontSize: '36px', fontWeight: '800', color: '#111827' }}>
                The same experience, everywhere you study.
              </h2>
              <p className="body-lg" style={{ maxWidth: "62ch", margin: '0 auto', color: '#4b5563', fontSize: '16px', lineHeight: '1.6' }}>
                Between lectures, on the ward, or at 2am the night before an exam — your
                sheets, decks, and question history follow you.
              </p>
            </div>

            <div className="runtime-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
              {RUNTIMES.map(({ icon: Icon, eyebrow, title, desc, link }) => (
                <div className="runtime-cell" key={eyebrow} style={{ backgroundColor: '#F7F9FB', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="cell-icon" style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#e0f2fe', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={22} strokeWidth={1.6} />
                  </div>
                  <div className="eyebrow muted" style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' }}>{eyebrow}</div>
                  <h3 className="heading-md" style={{ fontSize: '20px', fontWeight: '700', color: '#111827' }}>{title}</h3>
                  <p className="body-sm" style={{ color: '#4b5563', fontSize: '14px', lineHeight: '1.6', flex: '1' }}>{desc}</p>
                  {link ? (
                    <Link className="link-arrow" to={link.to} style={{ color: '#0F4C81', fontWeight: '600', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
                      {link.label} →
                    </Link>
                  ) : (
                    <span className="body-sm" style={{ color: "var(--fg-subtle)", fontSize: '14px', fontWeight: '500' }}>
                      Coming soon
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Features ---------- */}
        <section id="features" data-screen style={{ padding: '80px 0', backgroundColor: '#F7F9FB' }}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: '50px', textAlign: 'center' }}>
              <div className="eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Core features</div>
              <h2 className="display-lg" style={{ maxWidth: "24ch", margin: '0 auto 16px', fontSize: '36px', fontWeight: '800', color: '#111827' }}>
                Clinical AI for medical education, built for{" "}
                <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: '#0F4C81' }}>MENA</span>.
              </h2>
              <p className="body-lg" style={{ maxWidth: "62ch", margin: '0 auto', color: '#4b5563', fontSize: '16px' }}>
                Every feature exists because a student lost hours to the problem it solves.
              </p>
            </div>

            <div className="deid-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
              {FEATURES.map(({ icon: Icon, title, desc, tags }) => (
                <div className="deid-cell" key={title} style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="deid-icon" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#f3f4f6', color: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} strokeWidth={1.6} />
                  </div>
                  <h3 className="heading-sm" style={{ fontSize: '18px', fontWeight: '700', color: '#111827' }}>{title}</h3>
                  <p className="body-sm" style={{ color: '#4b5563', fontSize: '14px', lineHeight: '1.5', flex: '1' }}>{desc}</p>
                  <div className="tag-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto' }}>
                    {tags.map((tag) => (
                      <span className="tag" key={tag} style={{ backgroundColor: '#f3f4f6', color: '#374151', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '500' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- QBank ---------- */}
        <section id="qbank" className="bg-panel-section" data-screen style={{ padding: '80px 0', backgroundColor: '#fff' }}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: '40px' }}>
              <div className="tail" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <div className="eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>QBank</div>
                  <h2 className="display-lg" style={{ maxWidth: "18ch", fontSize: '36px', fontWeight: '800', color: '#111827', lineHeight: '1.2' }}>
                    High-yield questions, by <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: '#0F4C81' }}>subject</span>.
                  </h2>
                  <p className="body-lg" style={{ maxWidth: "58ch", marginTop: '16px', color: '#4b5563', fontSize: '16px', lineHeight: '1.6' }}>
                    USMLE-style vignettes with domain filters, session resume, and an
                    explanation for every distractor.
                  </p>
                </div>
                <button className="btn btn-outline" style={{ borderColor: '#d1d5db', color: '#111827', padding: '10px 20px', borderRadius: '9999px', fontWeight: '600', backgroundColor: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => navigate("/qbank")}>
                  Open the QBank
                  <ArrowUpRight className="icon" size={16} strokeWidth={1.6} />
                </button>
              </div>
            </div>

            <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '32px' }}>
              {SUBJECT_FILTERS.map((name) => (
                <button
                  key={name}
                  className={filter === name ? "chip active" : "chip"}
                  onClick={() => setFilter(name)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '9999px',
                    fontSize: '14px',
                    fontWeight: '600',
                    border: '1px solid',
                    cursor: 'pointer',
                    backgroundColor: filter === name ? '#111827' : '#fff',
                    color: filter === name ? '#fff' : '#374151',
                    borderColor: filter === name ? '#111827' : '#d1d5db',
                    transition: 'all 0.2s'
                  }}
                >
                  {name}
                </button>
              ))}
            </div>

            <div className="models-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
              {visibleSubjects.map(({ name, arch, tags }) => (
                <Link className="model-cell" to="/qbank" key={name} style={{ backgroundColor: '#F7F9FB', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', textDecoration: 'none', color: 'inherit' }}>
                  <div className="heading-sm model-name" style={{ fontSize: '18px', fontWeight: '700', color: '#111827' }}>{name}</div>
                  <div className="model-arch" style={{ fontSize: '13px', color: '#6b7280' }}>{arch}</div>
                  <div className="model-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0' }}>
                    {tags.map((tag) => (
                      <span className="tag" key={tag} style={{ backgroundColor: '#e5e7eb', color: '#374151', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '500' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="model-foot" style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' }}>
                    <span className="open" style={{ color: '#0F4C81', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Open
                      <ArrowUpRight className="icon" size={12} strokeWidth={1.6} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Pricing ---------- */}
        <section id="pricing" data-screen style={{ padding: '80px 0', backgroundColor: '#F7F9FB' }}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: '50px', textAlign: 'center' }}>
              <div className="eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Pricing</div>
              <h2 className="display-lg" style={{ maxWidth: "20ch", margin: '0 auto 16px', fontSize: '36px', fontWeight: '800', color: '#111827' }}>
                Free at the core. <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: '#0F4C81' }}>Real value.</span>
              </h2>
              <p className="body-lg" style={{ maxWidth: "66ch", margin: '0 auto', color: '#4b5563', fontSize: '16px' }}>
                Start with everything you need to study. Upgrade only when the limits
                actually start to bite.
              </p>
            </div>

            <div className="product-duo" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '30px', maxWidth: '900px', margin: '0 auto 40px' }}>
              <div className="product-card" style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '24px', padding: '36px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                <div className="product-card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="product-wordmark" style={{ fontSize: '24px', fontWeight: '800', color: '#111827' }}>Free</div>
                  <span className="product-badge" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600' }}>Always free</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#111827', margin: '0' }}>Everything to get started</h3>
                <p className="pdesc" style={{ color: '#4b5563', fontSize: '14px', lineHeight: '1.6', margin: '0' }}>
                  AI study sheets, flashcard decks with spaced repetition, QBank sessions,
                  and progress tracking. No credit card, no account required to begin.
                </p>
                <div className="product-built" style={{ fontSize: '13px', color: '#374151', backgroundColor: '#f9fafb', padding: '12px', borderRadius: '8px' }}>
                  Includes a <b>premium AI</b> generation on your first sheet.
                </div>
                <button
                  className="product-cta"
                  style={{ backgroundColor: '#111827', color: '#fff', border: 'none', padding: '14px', borderRadius: '9999px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: 'auto' }}
                  onClick={() => navigate("/dashboard?start=sheet")}
                >
                  Start for free
                  <ArrowRight size={16} strokeWidth={1.6} />
                </button>
              </div>

              <div className="product-card dark" style={{ backgroundColor: '#111827', color: '#fff', borderRadius: '24px', padding: '36px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
                <div className="product-card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="product-wordmark" style={{ fontSize: '24px', fontWeight: '800' }}>Pro</div>
                  <span className="product-badge" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#60a5fa', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600' }}>$5/mo</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '700', margin: '0' }}>Unlimited everything</h3>
                <p className="pdesc" style={{ color: '#9ca3af', fontSize: '14px', lineHeight: '1.6', margin: '0' }}>
                  Unlimited AI case generation, full QBank access, spaced repetition
                  analytics, PubMed citations, priority model tier (Claude Haiku), and new
                  subjects as they ship.
                </p>
                <div className="product-built" style={{ fontSize: '13px', color: '#d1d5db', backgroundColor: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px' }}>
                  Powered by <b>Claude Haiku 4.5</b> on every generation.
                </div>
                <a className="product-cta" href={CONTACT_EMAIL} style={{ backgroundColor: '#fff', color: '#111827', border: 'none', padding: '14px', borderRadius: '9999px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none', marginTop: 'auto' }}>
                  Get in touch
                  <ArrowUpRight size={16} strokeWidth={1.6} />
                </a>
              </div>
            </div>

            <div className="deploy-strip" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', backgroundColor: '#fff', border: '1px solid #e5e7eb', padding: '20px 30px', borderRadius: '16px', maxWidth: '900px', margin: '0 auto' }}>
              <span className="body-sm" style={{ color: '#4b5563', fontSize: '14px', fontWeight: '500' }}>
                Institutional pricing available for medical schools and NGOs.
              </span>
              <a className="btn btn-outline" href={CONTACT_EMAIL} style={{ borderColor: '#d1d5db', color: '#111827', padding: '8px 16px', borderRadius: '9999px', fontWeight: '600', fontSize: '14px', backgroundColor: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                Contact us
                <ArrowUpRight className="icon" size={16} strokeWidth={1.6} />
              </a>
            </div>
          </div>
        </section>

        {/* ---------- Story ---------- */}
        <section id="story" className="research" data-screen style={{ padding: '80px 0', backgroundColor: '#fff' }}>
          <div className="container research-grid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '60px', alignItems: 'center' }}>
            <div>
              <div className="research-eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Built on evidence · since 2025</div>
              <h2 className="display-lg" style={{ fontSize: '36px', fontWeight: '800', color: '#111827', lineHeight: '1.2', marginBottom: '20px' }}>
                Started as a student problem. Grew into a{" "}
                <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: '#0F4C81' }}>platform</span>.
              </h2>
              <p className="body-lg" style={{ color: '#4b5563', fontSize: '16px', lineHeight: '1.6', marginBottom: '32px' }}>
                Every feature in StudyBuddy came from a real pain point — hours lost to
                passive reading, questions with no feedback, a curriculum with no
                structure. The problem got mapped before anything got built.
              </p>
              <div className="research-ctas" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <button
                  className="research-btn-solid"
                  style={{ backgroundColor: '#111827', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  onClick={() => navigate("/dashboard?start=sheet")}
                >
                  Start for free
                  <ArrowRight size={14} strokeWidth={1.6} />
                </button>
                <a className="research-btn-outline" href="#faq" style={{ color: '#374151', border: '1px solid #d1d5db', padding: '12px 24px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', backgroundColor: '#fff' }}>
                  Read the FAQ
                  <ArrowUpRight size={14} strokeWidth={1.6} />
                </a>
              </div>
            </div>
            <div className="research-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
              <div className="research-stat" style={{ backgroundColor: '#F7F9FB', border: '1px solid #e5e7eb', padding: '24px', borderRadius: '16px' }}>
                <div className="num" style={{ fontSize: '28px', fontWeight: '800', color: '#111827', marginBottom: '4px' }}>
                  USMLE
                </div>
                <div className="lbl" style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '6px' }}>Step 1 &amp; 2 style</div>
                <div className="sub" style={{ fontSize: '12px', color: '#6b7280', lineHeight: '1.4' }}>
                  Questions tagged by subject and domain out of the box
                </div>
              </div>
              <div className="research-stat" style={{ backgroundColor: '#F7F9FB', border: '1px solid #e5e7eb', padding: '24px', borderRadius: '16px' }}>
                <div className="num" style={{ fontSize: '28px', fontWeight: '800', color: '#111827', marginBottom: '4px' }}>
                  Adaptive
                </div>
                <div className="lbl" style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '6px' }}>Spaced repetition engine</div>
                <div className="sub" style={{ fontSize: '12px', color: '#6b7280', lineHeight: '1.4' }}>SM-2 algorithm surfaces your weak spots automatically</div>
              </div>
              <div className="research-stat" style={{ backgroundColor: '#F7F9FB', border: '1px solid #e5e7eb', padding: '24px', borderRadius: '16px' }}>
                <div className="num" style={{ fontSize: '28px', fontWeight: '800', color: '#111827', marginBottom: '4px' }}>
                  Free tier
                </div>
                <div className="lbl" style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '6px' }}>No credit card required</div>
                <div className="sub" style={{ fontSize: '12px', color: '#6b7280', lineHeight: '1.4' }}>
                  Start with the full sheet generator and QBank, no payment needed
                </div>
              </div>
              <div className="research-stat" style={{ backgroundColor: '#F7F9FB', border: '1px solid #e5e7eb', padding: '24px', borderRadius: '16px' }}>
                <div className="num" style={{ fontSize: '28px', fontWeight: '800', color: '#111827', marginBottom: '4px' }}>
                  MENA-first
                </div>
                <div className="lbl" style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '6px' }}>Built in Gaza</div>
                <div className="sub" style={{ fontSize: '12px', color: '#6b7280', lineHeight: '1.4' }}>Priced and designed for students in underserved markets</div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" data-screen style={{ padding: '80px 0', backgroundColor: '#F7F9FB' }}>
          <div className="container faq-grid" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: '60px' }}>
            <div className="faq-lead">
              <div className="eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>FAQ</div>
              <h2 className="display-lg" style={{ fontSize: '36px', fontWeight: '800', color: '#111827', lineHeight: '1.2', marginBottom: '16px' }}>
                Questions from students, faculty, and the{" "}
                <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: '#0F4C81' }}>curious</span>.
              </h2>
              <p className="body-lg" style={{ color: '#4b5563', fontSize: '16px', lineHeight: '1.6' }}>
                If yours isn't here, email us — it reaches the person who builds the thing.
              </p>
            </div>
            <div className="faq-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {FAQS.map(({ q, a }, i) => (
                <div className={openFaq === i ? "faq-item open" : "faq-item"} key={q} style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden' }}>
                  <button
                    className="faq-row"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    aria-expanded={openFaq === i}
                    style={{ width: '100%', padding: '20px', background: 'none', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div className="heading-sm" style={{ fontSize: '16px', fontWeight: '700', color: '#111827' }}>{q}</div>
                    <div className="faq-plus" aria-hidden="true" style={{ fontSize: '20px', fontWeight: '600', color: '#6b7280' }}>
                      {openFaq === i ? '−' : '+'}
                    </div>
                  </button>
                  {openFaq === i && (
                    <div className="faq-body" style={{ padding: '0 20px 20px 20px', color: '#4b5563', fontSize: '14px', lineHeight: '1.6' }}>
                      <p style={{ margin: '0' }}>{a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Community CTA ---------- */}
        <section id="community" className="contribute" data-screen style={{ padding: '80px 0', backgroundColor: '#fff', textAlign: 'center' }}>
          <div className="container" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div className="eyebrow" style={{ color: '#64748B', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Open invitation</div>
            <h2 className="display-lg contribute-title" style={{ fontSize: '40px', fontWeight: '800', color: '#111827', marginBottom: '20px', lineHeight: '1.2' }}>
              Growing across MENA.{" "}
              <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: '#0F4C81' }}>Built in the open.</span>
            </h2>
            <p className="body-lg contribute-desc" style={{ color: '#4b5563', fontSize: '18px', lineHeight: '1.6', marginBottom: '32px' }}>
              StudyBuddy AI started in Gaza and is growing across the Arab world. If you're
              a medical student who wants better tools — join the early access list or
              follow the build on Instagram.
            </p>
            <div className="contribute-ctas" style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
              <button
                className="btn btn-primary btn-lg"
                style={{ backgroundColor: '#111827', color: '#fff', border: 'none', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                onClick={() => navigate("/dashboard?start=sheet")}
              >
                Get early access
                <ArrowRight className="icon" size={18} strokeWidth={1.6} />
              </button>
              <a
                className="btn btn-outline btn-lg"
                href={SOCIALS.instagram}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#111827', border: '1px solid #d1d5db', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', backgroundColor: '#fff' }}
              >
                Follow on Instagram
                <ArrowUpRight className="icon" size={18} strokeWidth={1.6} />
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ---------- Footer ---------- */}
      <footer className="footer" style={{ backgroundColor: '#F7F9FB', borderTop: '1px solid #e5e7eb', padding: '60px 0 30px' }}>
        <div className="container">
          <div className="footer-grid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: '40px', marginBottom: '40px' }}>
            <div className="footer-col">
              <div className="footer-brand" style={{ marginBottom: '16px' }}>
                <span className="wordmark" style={{ fontSize: '20px', fontWeight: '800', color: '#0F4C81' }}>StudyBuddy AI</span>
              </div>
              <p className="body-sm" style={{ maxWidth: "38ch", color: '#6b7280', fontSize: '14px', lineHeight: '1.6' }}>
                AI-powered study tools for medical students in MENA and beyond.
              </p>
            </div>

            <div className="footer-col">
              <div className="footer-col-head" style={{ fontWeight: '700', fontSize: '14px', color: '#111827', marginBottom: '16px' }}>Product</div>
              <ul  style={{ listStyle: 'none', padding: '0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <li>
                  <Link to="/qbank" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>QBank</Link>
                </li>
                <li>
                  <Link to="/sheets" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>Study sheets</Link>
                </li>
                <li>
                  <Link to="/flashcards" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>Flashcards</Link>
                </li>
                <li>
                  <Link to="/roadmap" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>Roadmap</Link>
                </li>
              </ul>
            </div>

            <div className="footer-col">
              <div className="footer-col-head" style={{ fontWeight: '700', fontSize: '14px', color: '#111827', marginBottom: '16px' }}>Resources</div>
              <ul style={{ listStyle: 'none', padding: '0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <li>
                  <a href="#playground" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>How it works</a>
                </li>
                <li>
                  <a href="#features" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>Features</a>
                </li>
                <li>
                  <a href="#pricing" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>Pricing</a>
                </li>
                <li>
                  <a href="#faq" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>FAQ</a>
                </li>
              </ul>
            </div>

            <div className="footer-col">
              <div className="footer-col-head" style={{ fontWeight: '700', fontSize: '14px', color: '#111827', marginBottom: '16px' }}>Connect</div>
              <ul style={{ listStyle: 'none', padding: '0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <li>
                  <a href={SOCIALS.instagram} target="_blank" rel="noopener noreferrer" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>
                    Instagram
                  </a>
                </li>
                <li>
                  <a href={SOCIALS.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>
                    LinkedIn
                  </a>
                </li>
                <li>
                  <a href={SOCIALS.telegram} target="_blank" rel="noopener noreferrer" style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>
                    Telegram
                  </a>
                </li>
                <li>
                  <a href={CONTACT_EMAIL} style={{ color: '#4b5563', textDecoration: 'none', fontSize: '14px' }}>Email us</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="footer-foot" style={{ borderTop: '1px solid #e5e7eb', paddingTop: '20px', display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: '13px' }}>
            <span>© {new Date().getFullYear()} StudyBuddy AI</span>
            <span>Built by Osama Shihada · Gaza</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
