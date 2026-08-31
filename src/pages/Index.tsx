import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Layers,
  Moon,
  Sun,
  Stethoscope,
  Shield,
  Zap,
  Target,
  TrendingUp,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import HeroDemo, { HeroDemoText } from "@/components/landing/HeroDemo";
import { LIMITS, formatPrice } from "@/config/product";
import { t } from "@/config/i18n";
import "@/styles/openmed-tokens.css";
import "@/styles/openmed-components.css";
import "@/styles/hero.css";

const CONTACT_EMAIL = "mailto:osama200az@gmail.com";

/**
 * Where every "start generating" CTA points.
 *
 * These used to target `/dashboard?start=sheet`, but nothing ever read that
 * query param — Dashboard has no `useSearchParams` — so the buttons landed on
 * the tool grid and made the user pick "Study Sheet" themselves. Point them at
 * the generator the copy actually promises.
 */
const START_SHEET_ROUTE = "/sheets";

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
    title: t("citations.featureTitle"),
    // Was "Every study sheet …" tagged Pro — both halves wrong: citations are
    // metered daily, and the free tier gets some.
    desc: t("citations.featureBody"),
    tags: [`${LIMITS.citations.free}/day free`, "PubMed"],
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
    // Was "no credit card required" with no mention that an account is, and
    // quoted $5 as a literal. Both now come from config.
    a: t("free.planLine", {
      sheets: LIMITS.sheets.free,
      cards: LIMITS.cards.free,
      citations: LIMITS.citations.free,
      price: formatPrice(),
    }),
  },
];

const Index = () => {
  const navigate = useNavigate();
  // Shared with the in-app ThemeToggle so both stay in step; the `.dark` class
  // itself is applied before paint by the bootstrap script in index.html.
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("All");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // A returning-user redirect to /dashboard used to live here, gated on
  // `!isHomeRoute`. This component is only ever routed at "/" and "/home" —
  // both of which *are* home routes — so the branch could never run. It took a
  // `ready` flag with it, which held the whole page at `return null` for a
  // frame on every visit. Sending returning users straight past the marketing
  // page is a product decision; it is not made here.

  // Anchor links need smooth scrolling, but only while this page is mounted.
  useEffect(() => {
    document.documentElement.classList.add("openmed-page");
    return () => {
      document.documentElement.classList.remove("openmed-page");
    };
  }, []);

  useEffect(() => {
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
  }, []);

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
              style={{ backgroundColor: 'var(--fg)', borderColor: 'var(--fg)', color: 'var(--bg-elevated)', borderRadius: '9999px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px' }}
              onClick={() => navigate(START_SHEET_ROUTE)}
            >
              <span className="btn-label">Start free</span>
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
              aria-label={menuOpen ? "Close menu" : "Open menu"}
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
        {/* ---------- Hero ----------
            Opens on ink, hands over to paper at the fold. The right-hand panel
            performs what the product does rather than picturing it: the topic
            types itself and the sheet resolves section by section. See
            HeroDemo for the pacing, and hero.css for why it is dark. */}
        <section id="home" className="hero" data-screen>
          <div className="container hero-grid">
            <div>
              <p className="hero-eyebrow">Built for medical students</p>

              <h1 className="hero-title">
                Type a topic.<br />
                Get a <em>sheet.</em>
              </h1>

              <p className="hero-desc">
                A structured clinical sheet, a deck to drill it, and questions
                to prove you know it — from nothing but the topic name.
              </p>

              <div className="hero-ctas">
                <button
                  type="button"
                  className="hero-btn hero-btn--primary"
                  onClick={() => navigate(START_SHEET_ROUTE)}
                >
                  Start for free
                  <ArrowRight size={17} strokeWidth={1.8} />
                </button>
                <a className="hero-btn hero-btn--ghost" href="#playground">
                  See how it works
                </a>
              </div>

              <p className="hero-note">
                USMLE-aligned · No card required · Built by a medical student in Gaza
              </p>

              <HeroDemoText />
            </div>

            <HeroDemo />
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section id="playground" data-screen style={{ backgroundColor: 'var(--bg)' }}>
          <div className="container mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="playground-grid">
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

        {/* ---------- Features ---------- */}
        <section id="features" data-screen style={{ backgroundColor: 'var(--bg)' }}>
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

            <div className="deid-grid">
              {FEATURES.map(({ icon: Icon, title, desc, tags }) => (
                <div className="deid-cell" key={title} style={{ backgroundColor: 'var(--bg-elevated)', padding: '28px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
        <section id="qbank" className="bg-panel-section" data-screen style={{ backgroundColor: 'var(--bg-elevated)' }}>
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

            <div className="models-grid">
              {visibleSubjects.map(({ name, arch, tags }) => (
                <Link className="model-cell" to="/qbank" key={name} style={{ backgroundColor: 'var(--bg)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', textDecoration: 'none', color: 'inherit' }}>
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
        <section id="pricing" data-screen style={{ backgroundColor: 'var(--bg)' }}>
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

            <div className="product-duo">
              <div className="product-card" style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '24px', padding: '36px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                <div className="product-card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="product-wordmark" style={{ fontSize: '24px', fontWeight: '800', color: 'var(--fg)' }}>Free</div>
                  <span className="product-badge" style={{ backgroundColor: 'var(--brand-soft)', color: 'var(--brand)', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600' }}>{t("pricing.freeBadge")}</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--fg)', margin: '0' }}>{t("pricing.freeTitle")}</h3>
                <p className="pdesc" style={{ color: 'var(--fg-muted)', fontSize: '14px', lineHeight: '1.6', margin: '0' }}>
                  {/* Was "no account required to begin" — the QBank hard-blocks
                      anonymous users, so that was false for a third of the product. */}
                  {t("pricing.freeBody")}
                </p>
                <div className="product-built" style={{ fontSize: '13px', color: 'var(--fg)', backgroundColor: 'var(--bg-panel)', padding: '12px', borderRadius: '8px' }}>
                  {t("pricing.freeNote", { sheets: LIMITS.sheets.free, cards: LIMITS.cards.free })}
                </div>
                <button
                  className="product-cta"
                  style={{ backgroundColor: 'var(--fg)', color: 'var(--bg-elevated)', border: 'none', padding: '14px', borderRadius: '9999px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: 'auto' }}
                  onClick={() => navigate(START_SHEET_ROUTE)}
                >
                  Start for free
                  <ArrowRight size={16} strokeWidth={1.6} />
                </button>
              </div>

              <div className="product-card dark" style={{ backgroundColor: 'var(--surface-inverse)', border: '1px solid var(--border-on-inverse)', color: 'var(--fg-on-inverse)', borderRadius: '24px', padding: '36px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: 'var(--shadow-ink)' }}>
                <div className="product-card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="product-wordmark" style={{ fontSize: '24px', fontWeight: '800' }}>Pro</div>
                  <span className="product-badge" style={{ backgroundColor: 'var(--surface-inverse-2)', color: 'var(--accent-on-inverse)', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600' }}>{t("pricing.proBadge", { price: formatPrice() })}</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '700', margin: '0' }}>{t("pricing.proTitle")}</h3>
                <p className="pdesc" style={{ color: 'var(--fg-on-inverse-muted)', fontSize: '14px', lineHeight: '1.6', margin: '0' }}>
                  {t("pricing.proBody")}
                </p>
                <div className="product-built" style={{ fontSize: '13px', color: 'var(--fg-on-inverse)', backgroundColor: 'var(--surface-inverse-2)', padding: '12px', borderRadius: '8px' }}>
                  {t("pricing.proNote")}
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
        <section id="story" className="research" data-screen style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <div className="container research-grid">
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
                  onClick={() => navigate(START_SHEET_ROUTE)}
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
            {/*
              A four-card stat grid stood here. Three of its four claims were
              already made elsewhere on this page — "Step 1 & 2 style" in the
              QBank section and the FAQ, "spaced repetition" in the feature
              grid, "no credit card" in pricing. The fourth, built in Gaza, is
              now in the hero.

              What was missing was the thing only this section can say, so the
              repetition is replaced by the actual note from the person who
              built it.
            */}
            {/*
              A four-card stat grid stood here. Three of its four claims were
              already made elsewhere on this page — "Step 1 & 2 style" in the
              QBank section and the FAQ, "spaced repetition" in the feature
              grid, "no credit card" in pricing. The fourth, built in Gaza, is
              now in the hero.

              A founder quote is the right shape for this slot, but the copy has
              to come from the founder — writing one and attributing it to a
              named real person would be putting words in their mouth. The panel
              below states only what the repo already evidences; swap it for a
              real quote when there is one.
            */}
            <div
              style={{
                padding: '28px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderInlineStart: '3px solid var(--accent)',
                borderRadius: 'var(--r-lg)',
              }}
            >
              <p className="ds-label">Why it exists</p>
              <p
                style={{
                  margin: '14px 0 0',
                  fontFamily: 'var(--font-display)',
                  fontSize: '20px',
                  lineHeight: 1.5,
                  letterSpacing: '-0.012em',
                  color: 'var(--fg)',
                }}
              >
                Built by a final-year medical student in Gaza, for students
                revising under the same constraints — limited time, limited
                bandwidth, and exams that do not move.
              </p>
              <p style={{ marginTop: '18px', fontSize: '13px', color: 'var(--fg-muted)' }}>
                <span style={{ color: 'var(--fg)', fontWeight: 500 }}>Osama Shihada</span>
                {" · Maker of StudyBuddy AI"}
              </p>
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" data-screen style={{ backgroundColor: 'var(--bg)' }}>
          <div className="container faq-grid">
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
        <section id="community" className="contribute" data-screen style={{ backgroundColor: 'var(--bg-elevated)', textAlign: 'center' }}>
          <div className="container" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div className="eyebrow" style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '12px' }}>Open invitation</div>
            <h2 className="display-lg contribute-title" style={{ fontSize: '40px', fontWeight: '800', color: 'var(--fg)', marginBottom: '20px', lineHeight: '1.2' }}>
              Growing across MENA.{" "}
              <span className="serif-italic" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: '400', color: 'var(--brand)' }}>Built with students.</span>
            </h2>
            <p className="body-lg contribute-desc" style={{ color: 'var(--fg-muted)', fontSize: '18px', lineHeight: '1.6', marginBottom: '32px' }}>
              StudyBuddy AI started in Gaza and is growing across the Arab world. If you're
              a medical student who wants better tools, it is free to start —
              or follow along on Instagram.
            </p>
            <div className="contribute-ctas" style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
              <button
                className="btn btn-primary btn-lg"
                style={{ backgroundColor: 'var(--fg)', color: 'var(--bg-elevated)', border: 'none', padding: '14px 28px', borderRadius: '9999px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                onClick={() => navigate(START_SHEET_ROUTE)}
              >
                Start for free
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

      {/* ---------- Footer ---------- */}
      <footer className="footer py-[60px] sm:py-[60px] px-4">
        <div className="container mx-auto max-w-7xl ">
          <div className="footer-grid">
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
