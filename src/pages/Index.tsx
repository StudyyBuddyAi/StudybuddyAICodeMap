import AuthModal from "@/components/AuthModal";
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
import ResponsiveSection from "@/components/ResponsiveSection";
import { useTheme } from "@/hooks/use-theme";
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
    desc: "Single-best-answer vignettes for the topic you just studied. StudyBuddy remembers what you get wrong.",
  },
  {
    name: "Review and repeat",
    desc: "Spaced repetition brings back your weak spots. Tap any concept to go deeper, and check the evidence behind it.",
  },
];

const STUDY_ANYWHERE = [
  {
    icon: Laptop,
    eyebrow: "Web app",
    title: "Full feature set in your browser",
    desc: "Nothing to install. Open it in any browser and start studying.",
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
    tags: ["Any topic", "Seconds"],
  },
  {
    icon: Target,
    title: "Smart QBank",
    desc: "Single-best-answer clinical vignettes with full explanations. Adaptive — the QBank tracks your weak spots.",
    tags: ["Adaptive", "Spaced repetition"],
  },
  {
    icon: Layers,
    title: "Flashcard Decks",
    desc: "Generate decks from any topic or import your own. Spaced repetition surfaces cards when retention is lowest.",
    tags: ["Spaced repetition", "Any topic"],
  },
  {
    icon: Shield,
    title: "PubMed Citations",
    desc: "Every study sheet links out to real papers on PubMed. Evidence you can check yourself, not invented references.",
    tags: ["Pro", "PubMed"],
  },
  {
    icon: TrendingUp,
    title: "Progress Analytics",
    desc: "Session history, subject coverage, and accuracy trends. See exactly where your knowledge gaps are.",
    tags: ["Progress", "Weak spots"],
  },
  {
    icon: Zap,
    title: "Inline Enhance",
    desc: "Highlight any term in a study sheet to pull up a deep-dive sidebar — like AMBOSS, built in.",
    tags: ["Pro", "Instant"],
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
    a: "StudyBuddy AI builds content from any topic you name — no pre-made decks to buy, no textbook to upload. Inline Enhance works like AMBOSS but sits directly inside your study sheets. And it's priced for MENA, not the US.",
  },
  {
    q: "Is my data private?",
    a: "Your study sheets, decks, and session history sync securely to your account. We don't sell your data or share it with third parties. Citations come from the NIH's public research database.",
  },
  {
    q: "Can I use it on my phone?",
    a: "Yes — StudyBuddy AI is fully mobile-optimized. A native app is on the roadmap.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. The free plan includes the full AI study sheet generator and QBank access with no credit card required. Pro ($5/mo) unlocks unlimited usage, PubMed citations, the Inline Enhance sidebar, and our most advanced medical AI model.",
  },
];

const Index = () => {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  // Shared with the in-app ThemeToggle so both stay in step; the `.dark` class
  // itself is applied before paint by the bootstrap script in index.html.
  const { isDark, toggleTheme } = useTheme();
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
    return () => {
      document.documentElement.classList.remove("openmed-page");
    };
  }, []);

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

  if (!ready) return null;

  const visibleSubjects =
    filter === "All" ? SUBJECTS : SUBJECTS.filter((s) => s.name === filter);

  return (
    <div className="openmed" ref={rootRef}>
      {/* ---------- Header ---------- */}
      <header className={menuOpen ? "nav menu-open" : "nav"}>
        <div className="container nav-inner">
          <Link to="/" className="logo" aria-label="StudyBuddy home" style={{ color: 'var(--brand)' }}>
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
              style={{ backgroundColor: 'var(--fg)', borderColor: 'var(--fg)', color: 'var(--bg-elevated)', borderRadius: '9999px', padding: '10px 20px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px' }}
           //   onClick={() => navigate("/dashboard?start=sheet")}
              onClick={() => setAuthModalOpen(true)}
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
        <section id="home" className="hero bg-grid" data-screen style={{ backgroundColor: 'var(--bg)', padding: '60px 0 80px' }}>
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
              <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '16px' }}>StudyBuddy AI · Built for Medical Students</div>
              <h1 className="display-xl hero-title " style={{ color: 'var(--fg)', fontSize: 'clamp(32px, 7vw, 56px)', lineHeight: '1.1', fontWeight: '800', marginBottom: '24px' }}>
                Study smarter. Score higher.{" "}
                <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>Pass.</span>
              </h1>
              <p className="body-lg hero-desc" style={{ color: 'var(--fg-muted)', fontSize: 'clamp(15px, 3.2vw, 18px)', lineHeight: '1.6', marginBottom: '32px' }}>
                StudyBuddy turns your curriculum into AI-powered sheets, questions, and
                explanations — so{" "}
                <span
                  style={{
                    background: "var(--brand-soft)",
                    color: "var(--brand)",
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
                  style={{ backgroundColor: 'var(--fg)', borderColor: 'var(--fg)', color: 'var(--bg-elevated)', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onClick={() => navigate("/dashboard?start=sheet")}
                >
                  Start for free
                  <ArrowRight className="icon" size={18} strokeWidth={1.6} />
                </button>
                <a className="btn btn-outline btn-lg w-full sm:w-auto justify-center" href="#playground" style={{ borderColor: 'var(--border-strong)', color: 'var(--fg)', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', backgroundColor: 'var(--bg-elevated)' }}>
                  See how it works
                </a>
              </div>

              <div className="hero-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', color: 'var(--fg-muted)', fontSize: '14px' }}>
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
              <div className="phi-card" style={{ backgroundColor: 'var(--surface-inverse)', border: '1px solid var(--border-on-inverse)', borderRadius: '20px', color: 'var(--fg-on-inverse)', overflow: 'hidden', boxShadow: 'var(--shadow-ink)' }}>
                <div className="phi-head" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-on-inverse)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: 'var(--fg-on-inverse-muted)' }}>
                  <div className="phi-head-left">
                    <span>question · cardiology</span>
                  </div>
                  <span className="phi-count" style={{ background: 'var(--surface-inverse-2)', padding: '2px 8px', borderRadius: '6px', color: 'var(--fg-on-inverse)' }}>Q 14 / 50</span>
                </div>
                <pre className="phi-body" style={{ padding: '20px', margin: '0', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6', color: 'var(--fg-on-inverse)', whiteSpace: 'pre-wrap' }}>
                  {`A 58-year-old man presents with
crushing chest pain radiating to
his left arm for 40 minutes.

ECG shows ST elevation in leads
II, III, and aVF.

`}
                  <span className="phi-token revealed" data-k="DATE" style={{ color: 'var(--brand-soft-fg)', fontWeight: '600' }}>
                    Most likely diagnosis?
                  </span>
                  {`

A. NSTEMI
B. `}
                  <span className="phi-token revealed" data-k="NAME" style={{ color: 'var(--accent-on-inverse)', fontWeight: '600', backgroundColor: 'rgba(52, 211, 153, 0.1)', padding: '2px 4px', borderRadius: '4px' }}>
                    Inferior STEMI
                  </span>
                  {`
C. Unstable angina
D. Pericarditis`}
                </pre>
                <div className="phi-foot" style={{ padding: '14px 20px', borderTop: '1px solid var(--border-on-inverse)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--fg-on-inverse-muted)' }}>
                  <span>
                    Cardiology · <span className="lang-val" style={{ color: 'var(--brand-soft-fg)' }}>USMLE Step 1</span>
                  </span>
                  <div className="phi-foot-right" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div className="phi-foot-dot" style={{ width: '8px', height: '8px', backgroundColor: 'var(--accent-on-inverse)', borderRadius: '50%' }} />
                    <span style={{ color: 'var(--accent-on-inverse)' }}>AI explanation ready</span>
                  </div>
                </div>
              </div>
              <div className="hero-caption" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', padding: '0 4px', fontSize: '13px', color: 'var(--fg-muted)' }}>
                <span>Live QBank question · adaptive mode</span>
                <span className="play" style={{ color: 'var(--brand)', fontWeight: '600', cursor: 'pointer' }}>▶ try it</span>
              </div>
            </div>
          </div>
        </section>

        <ResponsiveSection />

        {/* ---------- Stat band ---------- */}
        <section className="statband" aria-label="Traction stats" style={{ backgroundColor: 'var(--brand)', color: 'var(--bg-elevated)', padding: '48px 0' }}>
          <div className="container" style={{ textAlign: 'center' }}>
            <div className="statband-head" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              <span className="statband-eyebrow" style={{ color: 'var(--brand-soft-fg)', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Built for medical students</span>
              <span className="statband-desc" style={{ color: 'var(--bg-elevated)', fontSize: '24px', fontWeight: '700' }}>
                One workflow: study, practice, review — across every subject.
              </span>
            </div>
            <p
              className="body-lg"
              style={{
                color: "var(--brand-soft-fg)",
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
              <span className="statband-meta" style={{ color: 'var(--bg-elevated)', fontSize: '14px', fontWeight: '500' }}>Every subject, one workflow</span>
              <span className="statband-pills" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                {["Medicine", "Surgery", "Pharmacology", "Pathology", "Microbiology", "Anatomy"].map(
                  (pill) => (
                    <span className="statband-pill" key={pill} style={{ backgroundColor: 'var(--brand-pill)', color: 'var(--bg-elevated)', padding: '6px 16px', borderRadius: '9999px', fontSize: '14px', fontWeight: '500' }}>
                      {pill}
                    </span>
                  ),
                )}
              </span>
            </div>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section id="playground" data-screen style={{ backgroundColor: 'var(--bg)', padding: '80px 0' }}>
          <div className="container mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="playground-grid flex max-sm:flex-col md:flex-row" >
              <div className="playground-lead">
                <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>How it works</div>
                <h2 className="display-lg" style={{ color: 'var(--fg)', fontSize: '40px', fontWeight: '800', lineHeight: '1.2', marginBottom: '20px' }}>
                  Four steps to <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>mastery</span>.
                </h2>
                <p className="body-lg" style={{ color: 'var(--fg-muted)', fontSize: '16px', lineHeight: '1.6', marginBottom: '32px' }}>
                  No setup, no learning curve. The same loop every time: study, test, review,
                  repeat.
                </p>
                <ul className="playground-list" style={{ listStyle: 'none', padding: '0', display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '32px' }}>
                  {STEPS.map(({ name, desc }) => (
                    <li key={name} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                      <span className="playground-check" style={{ backgroundColor: 'var(--brand)', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0', marginTop: '2px' }}>
                        <Check size={16} strokeWidth={2} color="white" />
                      </span>
                      <div>
                        <code className="code-inline" style={{ color: 'var(--brand)', fontWeight: '700', fontSize: '15px' }}>{name}</code>
                        <div className="body-sm" style={{ marginTop: '4px', color: 'var(--fg-muted)', fontSize: '14px', lineHeight: '1.5' }}>
                          {desc}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <button className="btn btn-primary" style={{ backgroundColor: 'var(--fg)', borderColor: 'var(--fg)', color: 'var(--bg-elevated)', padding: '12px 24px', borderRadius: '9999px', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '8px' }} onClick={() => navigate("/qbank")}>
                  Explore the QBank
                  <ArrowUpRight className="icon" size={16} strokeWidth={1.6} />
                </button>
              </div>

              {/* Worked question card. This was previously dressed as a code
                  editor — window dots, a shell prompt and `#` comments — which
                  is template residue, not something a medical student relates
                  to. Same layout, clinical chrome. */}
              <div className="code-panel" style={{ backgroundColor: 'var(--surface-inverse)', border: '1px solid var(--border-on-inverse)', borderRadius: '20px', color: 'var(--fg-on-inverse)', overflow: 'hidden', boxShadow: 'var(--shadow-ink)' }}>
                <div className="code-head" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-on-inverse)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent-on-inverse)', fontWeight: 600 }}>
                    Question 14
                  </span>
                  <span className="code-title" style={{ fontSize: '13px', color: 'var(--fg-on-inverse-muted)' }}>Cardiology · Step 1</span>
                  <span className="code-copy" style={{ fontSize: '12px', background: 'var(--surface-inverse-2)', padding: '2px 8px', borderRadius: '6px', color: 'var(--fg-on-inverse-muted)' }}>14 / 50</span>
                </div>
                <div className="code-install" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-on-inverse)', display: 'flex', gap: '10px', alignItems: 'center', background: 'var(--surface-inverse-2)' }}>
                  <Stethoscope size={15} strokeWidth={1.8} style={{ color: 'var(--accent-on-inverse)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--fg-on-inverse)', fontSize: '13px' }}>Acute coronary syndromes</span>
                </div>
                <div className="code-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border-on-inverse)', background: 'var(--surface-inverse-2)', padding: '0 16px' }}>
                  <span style={{ padding: '10px 16px', color: 'var(--accent-on-inverse)', borderBottom: '2px solid var(--accent-on-inverse)', fontSize: '13px', fontWeight: '600' }}>
                    Question
                  </span>
                  <span style={{ padding: '10px 16px', color: 'var(--fg-on-inverse-muted)', fontSize: '13px' }}>
                    Explanation
                  </span>
                  <span style={{ padding: '10px 16px', color: 'var(--fg-on-inverse-muted)', fontSize: '13px' }}>
                    Flashcards
                  </span>
                </div>
                <div className="code-body" style={{ padding: '20px', fontSize: '14px', lineHeight: '1.65', color: 'var(--fg-on-inverse)' }}>
                  <p style={{ margin: '0 0 18px' }}>
                    A 58-year-old man presents with crushing chest pain. His ECG shows
                    ST elevation in leads II, III and aVF.
                  </p>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', marginBottom: '6px' }}>
                    <span style={{ color: 'var(--accent-on-inverse)', fontWeight: 600, minWidth: '62px' }}>Answer</span>
                    <span>B. Inferior STEMI</span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', marginBottom: '18px' }}>
                    <span style={{ color: 'var(--accent-on-inverse)', fontWeight: 600, minWidth: '62px' }}>Vessel</span>
                    <span>Right coronary artery <span style={{ color: 'var(--highlight)' }}>(80%)</span></span>
                  </div>

                  <div style={{ fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-on-inverse-muted)', marginBottom: '8px' }}>
                    Why not the others
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
                    {[
                      ["A. NSTEMI", "no ST elevation"],
                      ["C. Stable angina", "resolves at rest"],
                      ["D. Pericarditis", "diffuse elevation"],
                    ].map(([option, why]) => (
                      <li key={option} style={{ display: 'flex', gap: '10px' }}>
                        <span style={{ minWidth: '124px', color: 'var(--fg-on-inverse)' }}>{option}</span>
                        <span style={{ color: 'var(--signal-on-inverse)' }}>{why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Runtime trio ---------- */}
        <section id="anywhere" data-screen style={{ padding: '80px 0', backgroundColor: 'var(--bg-elevated)' }}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: '50px', textAlign: 'center' }}>
              <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Built to fit your study life</div>
              <h2 className="display-lg" style={{ maxWidth: "22ch", margin: '0 auto 16px', fontSize: '36px', fontWeight: '800', color: 'var(--fg)' }}>
                The same experience, everywhere you study.
              </h2>
              <p className="body-lg" style={{ maxWidth: "62ch", margin: '0 auto', color: 'var(--fg-muted)', fontSize: '16px', lineHeight: '1.6' }}>
                Between lectures, on the ward, or at 2am the night before an exam — your
                sheets, decks, and question history follow you.
              </p>
            </div>

            <div className="runtime-grid" style={{ display: 'grid', gap: '24px' }}>
              {STUDY_ANYWHERE.map(({ icon: Icon, eyebrow, title, desc, link }) => (
                <div className="runtime-cell" key={eyebrow} style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="cell-icon" style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: 'var(--brand-soft)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={22} strokeWidth={1.6} />
                  </div>
                  <div className="eyebrow muted" style={{ fontSize: '12px', fontWeight: '600', color: 'var(--fg-muted)', textTransform: 'uppercase' }}>{eyebrow}</div>
                  <h3 className="heading-md" style={{ fontSize: '20px', fontWeight: '700', color: 'var(--fg)' }}>{title}</h3>
                  <p className="body-sm" style={{ color: 'var(--fg-muted)', fontSize: '14px', lineHeight: '1.6', flex: '1' }}>{desc}</p>
                  {link ? (
                    <Link className="link-arrow" to={link.to} style={{ color: 'var(--brand)', fontWeight: '600', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
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
        <section id="features" data-screen style={{ padding: '80px 0', backgroundColor: 'var(--bg)' }}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: '50px', textAlign: 'center' }}>
              <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Core features</div>
              <h2 className="display-lg" style={{ maxWidth: "24ch", margin: '0 auto 16px', fontSize: '36px', fontWeight: '800', color: 'var(--fg)' }}>
                Clinical AI for medical education, built for{" "}
                <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>MENA</span>.
              </h2>
              <p className="body-lg" style={{ maxWidth: "62ch", margin: '0 auto', color: 'var(--fg-muted)', fontSize: '16px' }}>
                Every feature exists because a student lost hours to the problem it solves.
              </p>
            </div>

            <div className="deid-grid" style={{ display: 'grid', gap: '24px' }}>
              {FEATURES.map(({ icon: Icon, title, desc, tags }) => (
                <div className="deid-cell" key={title} style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '16px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="deid-icon" style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'var(--bg-panel)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} strokeWidth={1.6} />
                  </div>
                  <h3 className="heading-sm" style={{ fontSize: '18px', fontWeight: '700', color: 'var(--fg)' }}>{title}</h3>
                  <p className="body-sm" style={{ color: 'var(--fg-muted)', fontSize: '14px', lineHeight: '1.5', flex: '1' }}>{desc}</p>
                  <div className="tag-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto' }}>
                    {tags.map((tag) => (
                      <span className="tag" key={tag} style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--fg)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '500' }}>
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
        <section id="qbank" className="bg-panel-section" data-screen style={{ padding: '80px 0', backgroundColor: 'var(--bg-elevated)' }}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: '40px' }}>
              <div className="tail" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>QBank</div>
                  <h2 className="display-lg" style={{ maxWidth: "18ch", fontSize: '36px', fontWeight: '800', color: 'var(--fg)', lineHeight: '1.2' }}>
                    High-yield questions, by <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>subject</span>.
                  </h2>
                  <p className="body-lg" style={{ maxWidth: "58ch", marginTop: '16px', color: 'var(--fg-muted)', fontSize: '16px', lineHeight: '1.6' }}>
                    USMLE-style vignettes with domain filters, session resume, and an
                    explanation for every distractor.
                  </p>
                </div>
                <button className="btn btn-outline" style={{ borderColor: 'var(--border-strong)', color: 'var(--fg)', padding: '10px 20px', borderRadius: '9999px', fontWeight: '600', backgroundColor: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => navigate("/qbank")}>
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
                    backgroundColor: filter === name ? 'var(--fg)' : 'var(--bg-elevated)',
                    color: filter === name ? 'var(--bg-elevated)' : 'var(--fg)',
                    borderColor: filter === name ? 'var(--fg)' : 'var(--border-strong)',
                    transition: 'all 0.2s'
                  }}
                >
                  {name}
                </button>
              ))}
            </div>

            <div className="models-grid grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 2xl:gap-x-12 2xl:gap-y-16">
              {visibleSubjects.map(({ name, arch, tags }) => (
                <Link className="model-cell" to="/qbank" key={name} style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', textDecoration: 'none', color: 'inherit' }}>
                  <div className="heading-sm model-name" style={{ fontSize: '18px', fontWeight: '700', color: 'var(--fg)' }}>{name}</div>
                  <div className="model-arch" style={{ fontSize: '13px', color: 'var(--fg-muted)' }}>{arch}</div>
                  <div className="model-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0' }}>
                    {tags.map((tag) => (
                      <span className="tag" key={tag} style={{ backgroundColor: 'var(--border)', color: 'var(--fg)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '500' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="model-foot" style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                    <span className="open" style={{ color: 'var(--brand)', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
        <section id="pricing" data-screen style={{ padding: '80px 0', backgroundColor: 'var(--bg)' }}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: '50px', textAlign: 'center' }}>
              <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Pricing</div>
              <h2 className="display-lg" style={{ maxWidth: "20ch", margin: '0 auto 16px', fontSize: '36px', fontWeight: '800', color: 'var(--fg)' }}>
                Free at the core. <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>Real value.</span>
              </h2>
              <p className="body-lg" style={{ maxWidth: "66ch", margin: '0 auto', color: 'var(--fg-muted)', fontSize: '16px' }}>
                Start with everything you need to study. Upgrade only when the limits
                actually start to bite.
              </p>
            </div>

            <div className="product-duo grid grid-cols-2 gap-4 max-w-[900px] mx-auto mb-8" style={{ gap: '30px' }}>
              <div className="product-card" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '24px', padding: '36px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                <div className="product-card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="product-wordmark" style={{ fontSize: '24px', fontWeight: '800', color: 'var(--fg)' }}>Free</div>
                  <span className="product-badge" style={{ backgroundColor: 'var(--brand-soft)', color: 'var(--brand)', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600' }}>Always free</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--fg)', margin: '0' }}>Everything to get started</h3>
                <p className="pdesc" style={{ color: 'var(--fg-muted)', fontSize: '14px', lineHeight: '1.6', margin: '0' }}>
                  AI study sheets, flashcard decks with spaced repetition, QBank sessions,
                  and progress tracking. No credit card, no account required to begin.
                </p>
                <div className="product-built" style={{ fontSize: '13px', color: 'var(--fg)', backgroundColor: 'var(--bg-panel)', padding: '12px', borderRadius: '8px' }}>
                  Includes a <b>premium AI</b> generation on your first sheet.
                </div>
                <button
                  className="product-cta"
                  style={{ backgroundColor: 'var(--fg)', color: 'var(--bg-elevated)', border: 'none', padding: '14px', borderRadius: '9999px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: 'auto' }}
                  onClick={() => navigate("/dashboard?start=sheet")}
                >
                  Start for free
                  <ArrowRight size={16} strokeWidth={1.6} />
                </button>
              </div>

              <div className="product-card dark" style={{ backgroundColor: 'var(--surface-inverse)', border: '1px solid var(--border-on-inverse)', color: 'var(--fg-on-inverse)', borderRadius: '24px', padding: '36px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: 'var(--shadow-ink)' }}>
                <div className="product-card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="product-wordmark" style={{ fontSize: '24px', fontWeight: '800' }}>Pro</div>
                  <span className="product-badge" style={{ backgroundColor: 'var(--surface-inverse-2)', color: 'var(--accent-on-inverse)', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600' }}>$5/mo</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '700', margin: '0' }}>Unlimited everything</h3>
                <p className="pdesc" style={{ color: 'var(--fg-on-inverse-muted)', fontSize: '14px', lineHeight: '1.6', margin: '0' }}>
                  Unlimited study sheets, full QBank access, spaced repetition
                  analytics, PubMed citations, our most advanced medical AI model, and
                  new subjects as they are added.
                </p>
                <div className="product-built" style={{ fontSize: '13px', color: 'var(--fg-on-inverse)', backgroundColor: 'var(--surface-inverse-2)', padding: '12px', borderRadius: '8px' }}>
                  Our most advanced medical AI model on every study sheet.
                </div>
                <a className="product-cta" href={CONTACT_EMAIL} style={{ backgroundColor: 'var(--fg-on-inverse)', color: 'var(--surface-inverse)', border: 'none', padding: '14px', borderRadius: '9999px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none', marginTop: 'auto' }}>
                  Get in touch
                  <ArrowUpRight size={16} strokeWidth={1.6} />
                </a>
              </div>
            </div>

            <div className="deploy-strip" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: '20px 30px', borderRadius: '16px', maxWidth: '900px', margin: '0 auto' }}>
              <span className="body-sm" style={{ color: 'var(--fg-muted)', fontSize: '14px', fontWeight: '500' }}>
                Institutional pricing available for medical schools and NGOs.
              </span>
              <a className="btn btn-outline" href={CONTACT_EMAIL} style={{ borderColor: 'var(--border-strong)', color: 'var(--fg)', padding: '8px 16px', borderRadius: '9999px', fontWeight: '600', fontSize: '14px', backgroundColor: 'var(--bg-elevated)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                Contact us
                <ArrowUpRight className="icon" size={16} strokeWidth={1.6} />
              </a>
            </div>
          </div>
        </section>

        {/* ---------- Story ---------- */}
        <section id="story" className="research" data-screen style={{ padding: '80px 0', backgroundColor: 'var(--bg-elevated)' }}>
          <div className="container research-grid sm:grid-cols-2 lg:grid-cols-4 gap-12" style={{ display: 'grid' }}>
            <div>
              <div className="research-eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Built on evidence · since 2025</div>
              <h2 className="display-lg" style={{ fontSize: '36px', fontWeight: '800', color: 'var(--fg)', lineHeight: '1.2', marginBottom: '20px' }}>
                Started as a student problem. Grew into a{" "}
                <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>platform</span>.
              </h2>
              <p className="body-lg" style={{ color: 'var(--fg-muted)', fontSize: '16px', lineHeight: '1.6', marginBottom: '32px' }}>
                Every feature in StudyBuddy came from a real pain point — hours lost to
                passive reading, questions with no feedback, a curriculum with no
                structure. The problem got mapped before anything got built.
              </p>
              <div className="research-ctas" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <button
                  className="research-btn-solid"
                  style={{ backgroundColor: 'var(--fg)', color: 'var(--bg-elevated)', border: 'none', padding: '12px 24px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  onClick={() => navigate("/dashboard?start=sheet")}
                >
                  Start for free
                  <ArrowRight size={14} strokeWidth={1.6} />
                </button>
                <a className="research-btn-outline" href="#faq" style={{ color: 'var(--fg)', border: '1px solid var(--border-strong)', padding: '12px 24px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', backgroundColor: 'var(--bg-elevated)' }}>
                  Read the FAQ
                  <ArrowUpRight size={14} strokeWidth={1.6} />
                </a>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="research-stat" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', padding: '24px', borderRadius: '16px' }}>
                <div className="num" style={{ fontSize: '28px', fontWeight: '800', color: 'var(--fg)', marginBottom: '4px' }}>
                  USMLE
                </div>
                <div className="lbl" style={{ fontSize: '14px', fontWeight: '700', color: 'var(--fg)', marginBottom: '6px' }}>Step 1 &amp; 2 style</div>
                <div className="sub" style={{ fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.4' }}>
                  Questions tagged by subject and domain out of the box
                </div>
              </div>
              <div className="research-stat" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', padding: '24px', borderRadius: '16px' }}>
                <div className="num" style={{ fontSize: '28px', fontWeight: '800', color: 'var(--fg)', marginBottom: '4px' }}>
                  Adaptive
                </div>
                <div className="lbl" style={{ fontSize: '14px', fontWeight: '700', color: 'var(--fg)', marginBottom: '6px' }}>Spaced repetition engine</div>
                <div className="sub" style={{ fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.4' }}>SM-2 algorithm surfaces your weak spots automatically</div>
              </div>
              <div className="research-stat" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', padding: '24px', borderRadius: '16px' }}>
                <div className="num" style={{ fontSize: '28px', fontWeight: '800', color: 'var(--fg)', marginBottom: '4px' }}>
                  Free tier
                </div>
                <div className="lbl" style={{ fontSize: '14px', fontWeight: '700', color: 'var(--fg)', marginBottom: '6px' }}>No credit card required</div>
                <div className="sub" style={{ fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.4' }}>
                  Start with the full sheet generator and QBank, no payment needed
                </div>
              </div>
              <div className="research-stat" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', padding: '24px', borderRadius: '16px' }}>
                <div className="num" style={{ fontSize: '28px', fontWeight: '800', color: 'var(--fg)', marginBottom: '4px' }}>
                  MENA-first
                </div>
                <div className="lbl" style={{ fontSize: '14px', fontWeight: '700', color: 'var(--fg)', marginBottom: '6px' }}>Built in Gaza</div>
                <div className="sub" style={{ fontSize: '12px', color: 'var(--fg-muted)', lineHeight: '1.4' }}>Priced and designed for students in underserved markets</div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" data-screen style={{ padding: '80px 0', backgroundColor: 'var(--bg)' }}>
          <div className="container faq-grid sm:grid-cols-2 grid-cols-1 max-w-[100%] mx-auto px-4 py-6 sm:py-12" style={{ display: 'grid', gap: '60px' }}>
            <div className="faq-lead">
              <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>FAQ</div>
              <h2 className="display-lg" style={{ fontSize: '36px', fontWeight: '800', color: 'var(--fg)', lineHeight: '1.2', marginBottom: '16px' }}>
                Questions from students, faculty, and the{" "}
                <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>curious</span>.
              </h2>
              <p className="body-lg" style={{ color: 'var(--fg-muted)', fontSize: '16px', lineHeight: '1.6' }}>
                If yours isn't here, email us — it reaches the person who makes StudyBuddy.
              </p>
            </div>
            <div className="faq-list " style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {FAQS.map(({ q, a }, i) => (
                <div className={openFaq === i ? "faq-item open" : "faq-item"} key={q} style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                  <button
                    className="faq-row"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    aria-expanded={openFaq === i}
                    style={{ width: '100%', padding: '20px', background: 'none', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div className="heading-sm" style={{ fontSize: '16px', fontWeight: '700', color: 'var(--fg)' }}>{q}</div>
                    <div className="faq-plus" aria-hidden="true" style={{ fontSize: '20px', fontWeight: '600', color: 'var(--fg-muted)' }}>
                      {openFaq === i ? '−' : '+'}
                    </div>
                  </button>
                  {openFaq === i && (
                    <div className="faq-body" style={{ padding: '0 20px 20px 20px', color: 'var(--fg-muted)', fontSize: '14px', lineHeight: '1.6' }}>
                      <p style={{ margin: '0' }}>{a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Community CTA ---------- */}
        <section id="community" className="contribute" data-screen style={{ padding: '80px 0', backgroundColor: 'var(--bg-elevated)', textAlign: 'center' }}>
          <div className="container" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Open invitation</div>
            <h2 className="display-lg contribute-title" style={{ fontSize: '40px', fontWeight: '800', color: 'var(--fg)', marginBottom: '20px', lineHeight: '1.2' }}>
              Growing across MENA.{" "}
              <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>Built with students.</span>
            </h2>
            <p className="body-lg contribute-desc" style={{ color: 'var(--fg-muted)', fontSize: '18px', lineHeight: '1.6', marginBottom: '32px' }}>
              StudyBuddy AI started in Gaza and is growing across the Arab world. If you're
              a medical student who wants better tools — join the early access list or
              follow along on Instagram.
            </p>
            <div className="contribute-ctas" style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
              <button
                className="btn btn-primary btn-lg"
                style={{ backgroundColor: 'var(--fg)', color: 'var(--bg-elevated)', border: 'none', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
              //  onClick={() => navigate("/dashboard?start=sheet")}
              onClick={() => setAuthModalOpen(true)}
              >
                Get early access
                <ArrowRight className="icon" size={18} strokeWidth={1.6} />
              </button>
              <a
                className="btn btn-outline btn-lg"
                href={SOCIALS.instagram}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--fg)', border: '1px solid var(--border-strong)', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', backgroundColor: 'var(--bg-elevated)' }}
              >
                Follow on Instagram
                <ArrowUpRight className="icon" size={18} strokeWidth={1.6} />
              </a>
            </div>
          </div>
        </section>
      </main>
      <AuthModal
  open={authModalOpen}
  onOpenChange={setAuthModalOpen}
/>

      {/* ---------- Footer ---------- */}
      <footer className="footer py-[60px] sm:py-[60px] px-4">
        <div className="container mx-auto max-w-7xl ">
          <div className="footer-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10 mb-10">
            <div className="footer-col">
              <div className="footer-brand mb-4">
                <span className="wordmark text-[20px] font-extrabold">StudyBuddy AI</span>
              </div>
              <p className="body-sm text-[14px] leading-relaxed max-w-[38ch]">
                AI-powered study tools for medical students in MENA and beyond.
              </p>
            </div>

            <div className="footer-col">
              <div className="footer-col-head font-bold text-[14px] mb-4">Product</div>
              <ul className="list-none p-0 flex flex-col gap-2.5">
                <li>
                  <Link to="/qbank" className="no-underline text-[14px] transition-colors">QBank</Link>
                </li>
                <li>
                  <Link to="/sheets" className="no-underline text-[14px] transition-colors">Study sheets</Link>
                </li>
                <li>
                  <Link to="/flashcards" className="no-underline text-[14px] transition-colors">Flashcards</Link>
                </li>
                <li>
                  <Link to="/roadmap" className="no-underline text-[14px] transition-colors">Roadmap</Link>
                </li>
              </ul>
            </div>

            <div className="footer-col ">
              <div className="footer-col-head font-bold text-[14px] mb-4">Resources</div>
              <ul className="list-none p-0 flex flex-col gap-2.5">
                <li>
                  <a href="#playground" className="no-underline text-[14px] transition-colors">How it works</a>
                </li>
                <li>
                  <a href="#features" className="no-underline text-[14px] transition-colors">Features</a>
                </li>
                <li>
                  <a href="#pricing" className="no-underline text-[14px] transition-colors">Pricing</a>
                </li>
                <li>
                  <a href="#faq" className="no-underline text-[14px] transition-colors">FAQ</a>
                </li>
              </ul>
            </div>

            <div className="footer-col">
              <div className="footer-col-head font-bold text-[14px] mb-4">Connect</div>
              <ul className="list-none p-0 flex flex-col gap-2.5">
                <li>
                  <a href={SOCIALS.instagram} target="_blank" rel="noopener noreferrer" className="no-underline text-[14px] transition-colors">
                    Instagram
                  </a>
                </li>
                <li>
                  <a href={SOCIALS.linkedin} target="_blank" rel="noopener noreferrer" className="no-underline text-[14px] transition-colors">
                    LinkedIn
                  </a>
                </li>
                <li>
                  <a href={SOCIALS.telegram} target="_blank" rel="noopener noreferrer" className="no-underline text-[14px] transition-colors">
                    Telegram
                  </a>
                </li>
                <li>
                  <a href={CONTACT_EMAIL} className="no-underline text-[14px] transition-colors">Email us</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="footer-foot pt-5 flex flex-col sm:flex-row justify-between items-center sm:items-start text-[13px] gap-2">
            <span>© {new Date().getFullYear()} StudyBuddy AI</span>
            <span>Built by Osama Shihada · Gaza</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
