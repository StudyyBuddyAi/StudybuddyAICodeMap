import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CircleDot,
  FileText,
  HeartPulse,
  Instagram,
  Laptop,
  Layers,
  Linkedin,
  Mail,
  Menu,
  Moon,
  Send,
  Shield,
  Smartphone,
  Sparkles,
  Stethoscope,
  Sun,
  Target,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ResponsiveCarousel } from "@/components/ResponsiveCarousel";
import "@/pages/index.css";
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

const SUBJECT_FILTERS = ["All", "Cardiology", "Pharmacology", "Pathology", "Surgery", "Microbiology"];
const SUBJECTS = [
  { name: "Cardiology", arch: "ECG · Heart failure · Arrhythmias", tags: ["ECG", "Heart failure", "Arrhythmias"] },
  { name: "Pharmacology", arch: "Mechanisms · Drug interactions · Toxicology", tags: ["Mechanisms", "Drug interactions"] },
  { name: "Pathology", arch: "Histology · Systemic · Neoplasia", tags: ["Histology", "Systemic"] },
  { name: "Surgery", arch: "Pre-op assessment · Post-op care · Trauma", tags: ["Pre-op", "Post-op", "Trauma"] },
  { name: "Microbiology", arch: "Bacteriology · Virology · Parasitology", tags: ["Bacteria", "Viruses", "Parasites"] },
  { name: "Anatomy", arch: "Gross anatomy · Neuroanatomy · Embryology", tags: ["Gross", "Neuroanatomy"] },
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

const TESTIMONIALS = [
  {
    name: "Ahmed Hassan",
    role: "4th Year Medical Student",
    university: "Cairo University",
    quote: "StudyBuddy helped me understand cardiology concepts that I struggled with for months. The AI explanations are clearer than my textbooks.",
    score: 15,
    avatar: "AH",
  },
  {
    name: "Fatima Al-Rashid",
    role: "USMLE Step 1 Candidate",
    university: "King Saud University",
    quote: "The spaced repetition feature is a game-changer. I went from 60% to 85% in my practice exams within 6 weeks.",
    score: 25,
    avatar: "FA",
  },
  {
    name: "Omar Khalil",
    role: "Final Year Medical Student",
    university: "University of Jordan",
    quote: "Finally, a tool built for students in our region. The pricing is perfect and the content quality rivals expensive alternatives.",
    score: 20,
    avatar: "OK",
  },
];

const FREE_FEATURES = [
  "AI study sheets (5/day limit)",
  "Flashcard decks with spaced repetition",
  "QBank sessions (10 questions/day)",
  "Basic progress tracking",
  "Community support",
];

const PRO_FEATURES = [
  "Unlimited AI study sheets",
  "Full QBank access (all questions)",
  "Advanced spaced repetition analytics",
  "PubMed citations on every sheet",
  "Inline Enhance sidebar",
  "Priority support",
  "Early access to new features",
];

function useInView() {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || !("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(node);
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, inView };
}

function Reveal({
  children,
  delay = 0,
  direction = "up",
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  direction?: "up" | "left" | "right" | "scale";
  className?: string;
}) {
  const { ref, inView } = useInView();
  const transforms = {
    up: "translateY(34px)",
    left: "translateX(34px)",
    right: "translateX(-34px)",
    scale: "scale(.94)",
  };
  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translate3d(0,0,0) scale(1)" : transforms[direction],
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const { ref, inView } = useInView();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let frame = 0;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - startedAt) / 1500, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(target * eased));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [inView, target]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span className={`eyebrow ${dark ? "eyebrow-dark" : ""}`}>
      <span className="eyebrow-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

function ButtonLink({
  children,
  href = "#",
  variant = "primary",
  onClick,
  target,
  rel,
  testId,
}: {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "accent" | "ghost" | "dark-ghost";
  onClick?: () => void;
  target?: string;
  rel?: string;
  testId: string;
}) {
  return (
    <a
      href={href}
      className={`button button-${variant}`}
      onClick={(event) => {
        if (onClick) {
          event.preventDefault();
          onClick();
        }
      }}
      target={target}
      rel={rel}
      data-testid={testId}
    >
      {children}
    </a>
  );
}

function SectionHeading({
  eyebrow,
  title,
  children,
  center = false,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`section-heading ${center ? "section-heading-center" : ""}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem("studybuddy-theme") === "dark";
    } catch {
      return false;
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try {
      localStorage.setItem("studybuddy-theme", isDark ? "dark" : "light");
    } catch {
      // Storage can be unavailable in private browsing; theme still works in-memory.
    }
  }, [isDark]);

  const visibleSubjects = useMemo(
    () => (filter === "All" ? SUBJECTS : SUBJECTS.filter((subject) => subject.name === filter)),
    [filter],
  );
  const startStudying = () => navigate("/dashboard?start=sheet");
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="site-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className={`site-header ${menuOpen ? "menu-open" : ""}`}>
        <div className="container header-inner">
          <a href="#home" className="brand" onClick={closeMenu} data-testid="link-brand-home" aria-label="StudyBuddy AI home">
            <span className="brand-mark"><HeartPulse size={18} strokeWidth={2.25} /></span>
            <span className="brand-name">StudyBuddy <b>AI</b></span>
            <span className="brand-beta">BETA</span>
          </a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              <a href={link.href} key={link.href} data-testid={`link-nav-${link.label.toLowerCase().split(" ").join("-")}`}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <button className="theme-button" type="button" onClick={() => setIsDark((value) => !value)} aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} data-testid="button-theme-toggle">
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <ButtonLink href="/dashboard?start=sheet" onClick={startStudying} testId="button-header-early-access">
              <span className="header-cta-label">Get early access</span><ArrowRight size={15} />
            </ButtonLink>
            <button className="menu-button" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-controls="mobile-nav" aria-label={menuOpen ? "Close menu" : "Open menu"} data-testid="button-mobile-menu">
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation">
          {NAV_LINKS.map((link) => (
            <a href={link.href} key={link.href} onClick={closeMenu} data-testid={`link-mobile-${link.label.toLowerCase().split(" ").join("-")}`}>{link.label}<ArrowUpRight size={14} /></a>
          ))}
          <ButtonLink  href="/dashboard?start=sheet" onClick={() => { closeMenu(); startStudying(); }}  testId="button-mobile-early-access">Start studying <ArrowRight size={15} /></ButtonLink>
        </nav>
      </header>

      <main>
        <section id="home" className="hero-section">
          <div className="container hero-grid">
            <div className="hero-copy">
              <Reveal>
                <Eyebrow>Built for medical students · MENA</Eyebrow>
                <h1>Study smarter.<br />Score <em>higher.</em> Pass.</h1>
                <p className="hero-lede">StudyBuddy turns your curriculum into AI-powered sheets, questions, and explanations — so every study hour compounds. Built by an MD for medical students across MENA.</p>
                <div className="hero-actions">
                  <ButtonLink href="/dashboard?start=sheet" onClick={startStudying} testId="button-hero-start">Start free — no card required <ArrowRight size={18} /></ButtonLink>
                  <a href="#playground" className="button button-ghost" data-testid="link-hero-how-it-works">See how it works <ChevronDown size={17} /></a>
                </div>
                <div className="trust-row" data-testid="text-trusted-students">
                  <span className="avatar-stack" aria-hidden="true"><span>AK</span><span>NR</span><span>LM</span></span>
                  <span>Trusted by <strong><AnimatedCounter target={12000} suffix="+" /></strong> medical students across 6 countries</span>
                </div>
              </Reveal>
            </div>
            <Reveal direction="left" delay={160} className="hero-visual-wrap">
              <div className="hero-visual" role="img" aria-label="Sample StudyBuddy question on acute coronary syndrome, showing the correct answer highlighted and an ECG trace">
                <div className="question-top"><span>QUESTION 14 · CARDIOLOGY</span><span className="question-tag">STEP 1</span></div>
                <div className="question-body">
                  <div className="question-meta"><CircleDot size={12} /> Adaptive practice <span>•</span> 0:42</div>
                  <span className="stem">A 58-year-old man presents with:</span>
                  <p className="question-text">crushing chest pain radiating to left arm. ECG shows ST elevation in II, III, aVF.</p>
                  <svg className="ecg-line" viewBox="0 0 400 34" preserveAspectRatio="none" aria-hidden="true"><path d="M0 17 L60 17 L72 4 L84 30 L96 17 L140 17 L152 10 L164 17 L220 17 L232 4 L244 30 L256 17 L400 17" /></svg>
                  <div className="answer-option"><span>A</span> Anterior STEMI</div>
                  <div className="answer-option"><span>B</span> Inferior STEMI</div>
                  <div className="answer-option answer-correct"><Check size={15} /> Inferior STEMI — RCA occlusion</div>
                  <div className="answer-option"><span>D</span> Unstable angina</div>
                </div>
                <div className="question-foot"><span><Sparkles size={13} /> AI explanation ready</span><span>single best answer</span></div>
              </div>
              <div className="floating-note floating-note-top"><span className="note-icon"><FileText size={14} /></span><span><b>Study sheet ready</b><small>Acute coronary syndrome</small></span></div>
              <div className="floating-note floating-note-bottom"><span className="note-icon note-icon-warm"><BarChart3 size={14} /></span><span><b>+15% this week</b><small>Cardiology accuracy</small></span></div>
            </Reveal>
          </div>
          <div className="scroll-cue" aria-hidden="true"><span>scroll to explore</span><ChevronDown size={17} /></div>
        </section>

        <div className="subject-ticker" aria-hidden="true">
          <div className="ticker-track"><span>Cardiology</span><i>·</i><span>Pharmacology</span><i>·</i><span>Pathology</span><i>·</i><span>Microbiology</span><i>·</i><span>Surgery</span><i>·</i><span>Anatomy</span><i>·</i><span>Cardiology</span><i>·</i><span>Pharmacology</span><i>·</i><span>Pathology</span><i>·</i><span>Microbiology</span><i>·</i><span>Surgery</span><i>·</i><span>Anatomy</span></div>
        </div>

        <section id="playground" className="section section-how">
          <div className="container">
            <SectionHeading eyebrow="How it works" title={<>Four steps to <em>mastery.</em></>} center>
              No setup, no learning curve. The same easy loop — study, test, review, repeat.
            </SectionHeading>
            <Reveal>
              <ResponsiveCarousel
                className="steps-carousel-wrapper"
                desktopClassName="steps-grid"
                mobileItemClassName="step-carousel-slide"
              >
                {STEPS.map((step, index) => (
                  <article className="step-card" key={step.name} data-testid={`card-step-${index + 1}`}>
                    <div className="step-number">0{index + 1}<span> / 04</span></div>
                    <div className="step-rule" />
                    <h3>{step.name}</h3>
                    <p>{step.desc}</p>
                    <div className="step-arrow" aria-hidden="true"><ArrowUpRight size={16} /></div>
                  </article>
                ))}
              </ResponsiveCarousel>
            </Reveal>
          </div>
        </section>

        {/* <section className="dark-band">
          <div className="dark-grid" aria-hidden="true" />
          <Reveal className="container dark-band-inner">
            <Eyebrow dark>One workflow, every subject</Eyebrow>
            <h2>Study, practice, review —<br /><em>across every subject.</em></h2>
            <p>Growing across MENA — medical students using StudyBuddy AI to study smarter, practice better, and walk into exams with confidence.</p>
            <div className="discipline-list">{["Medicine", "Surgery", "Pharmacology", "Pathology", "Microbiology", "Anatomy"].map((discipline) => <span key={discipline}>{discipline}</span>)}</div>
          </Reveal>
        </section> */}

        {/* <section className="section stories-section">
          <div className="container">
            <SectionHeading eyebrow="Student-backed stories" title={<>Trusted by medical students across <em>MENA.</em></>} center />
            <Reveal>
              <ResponsiveCarousel
                className="stories-carousel-wrapper"
                desktopClassName="stories-grid"
                mobileItemClassName="story-carousel-slide"
              >
                {TESTIMONIALS.map((testimonial, index) => (
                  <article className={`story-card ${index === 1 ? "story-featured" : ""}`} key={testimonial.name} data-testid={`card-testimonial-${index + 1}`}>
                    <div className="story-mark">“</div>
                    <div className="star-row" aria-label="5 out of 5 stars"><Sparkles size={14} /><Sparkles size={14} /><Sparkles size={14} /><Sparkles size={14} /><Sparkles size={14} /></div>
                    <p className="story-quote">{testimonial.quote}</p>
                    <div className="story-author"><span className="avatar-initials">{testimonial.avatar}</span><span><strong>{testimonial.name}</strong><small>{testimonial.role} · {testimonial.university}</small></span></div>
                    <span className="score-pill">Exam score improved +{testimonial.score}%</span>
                  </article>
                ))}
              </ResponsiveCarousel>
            </Reveal>
          </div>
        </section> */}

        <section className="section platform-section">
          <div className="container">
            <SectionHeading eyebrow="Built to fit your study life" title={<>The same experience, <em>everywhere</em> you study.</>} center>
              Between lectures, on the ward, or 2am the night before an exam — your sheets, decks, and question history follow you.
            </SectionHeading>
            <Reveal>
              <ResponsiveCarousel
                className="platform-carousel-wrapper"
                desktopClassName="platform-grid"
                mobileItemClassName="platform-carousel-slide"
              >
                {[
                  { icon: Laptop, eyebrow: "Web app", title: "Full feature set in your browser", desc: "Nothing to install. Open it in any browser and start studying.", action: "Open StudyBuddy →", test: "link-platform-web" },
                  { icon: Smartphone, eyebrow: "Mobile-ready", title: "Study between lectures", desc: "Optimized for the ten minutes you get on the go.", action: "Coming soon", test: "text-platform-mobile" },
                  { icon: Users, eyebrow: "Study groups", title: "Compete with classmates", desc: "Share decks and climb the leaderboard together.", action: "Coming soon", test: "text-platform-groups" },
                ].map((platform) => {
                  const Icon = platform.icon;
                  return <article className="platform-card" key={platform.eyebrow} data-testid={`card-platform-${platform.eyebrow.toLowerCase().replace(" ", "-")}`}><span className="platform-icon"><Icon size={18} /></span><span className="platform-eyebrow">{platform.eyebrow}</span><h3>{platform.title}</h3><p>{platform.desc}</p>{platform.eyebrow === "Web app" ? <button type="button" onClick={startStudying} className="text-action" data-testid={platform.test}>{platform.action}<ArrowRight size={14} /></button> : <span className="coming-soon" data-testid={platform.test}>{platform.action}</span>}</article>;
                })}
              </ResponsiveCarousel>
            </Reveal>
          </div>
        </section>
        {/* ------- features start--------- */}
        <section id="features" className="section tinted-section">
          <div className="container">
            <SectionHeading eyebrow="Core features" title={<>Clinical AI for medical education, built for <em>MENA.</em></>} children="Every feature exists because a student lost hours to the problem it solves." center/>

            <Reveal>
              <ResponsiveCarousel
                className="features-carousel-wrapper"
                desktopClassName="features-grid"
                mobileItemClassName="feature-carousel-slide"
              >
                {FEATURES.map((feature, index) => {
                  const Icon = feature.icon;
                  return <article className="feature-card" key={feature.title} data-testid={`card-feature-mobile-${index + 1}`}><span className="feature-icon"><Icon size={19} /></span><h3>{feature.title}</h3><p>{feature.desc}</p><div className="tag-row">{feature.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></article>;
                })}
              </ResponsiveCarousel>
            </Reveal>
          </div>
        </section>
        {/* ------- features end--------- */}
        {/* ------- qbank start--------- */}
        <section id="qbank" className="section qbank-section">
          <div className="container">
            <SectionHeading eyebrow="QBank" title={<>High-yield questions, by <em>subject.</em></>} children="USMLE-style vignettes with domain filters, session resume, and an explanation for every distractor." center/>
            <div className="filter-row" role="tablist" aria-label="Filter QBank subjects">
              {SUBJECT_FILTERS.map((subject) => <button type="button" role="tab" aria-selected={filter === subject} className={`filter-button ${filter === subject ? "active" : ""}`} onClick={() => setFilter(subject)} key={subject} data-testid={`button-filter-${subject.toLowerCase()}`}>{subject}</button>)}
            </div>
            <Reveal>
              <ResponsiveCarousel
                className="subject-carousel-wrapper"
                desktopClassName="subject-grid"
                mobileItemClassName="subject-carousel-slide"
              >
                {visibleSubjects.map((subject) => (
                  <button
                    type="button"
                    className="subject-card"
                    key={subject.name}
                    onClick={startStudying}
                    data-testid={`button-subject-${subject.name.toLowerCase()}`}
                  >
                    <span className="subject-index">{String(SUBJECTS.indexOf(subject) + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{subject.name}</h3>
                      <p>{subject.arch}</p>
                      <div className="subject-tags">{subject.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                    </div>
                    <ArrowUpRight className="subject-arrow" size={18} />
                  </button>
                ))}
              </ResponsiveCarousel>
            </Reveal>
          </div>
        </section>

        <section id="pricing" className="section tinted-section pricing-section">
          <div className="container">
            <SectionHeading eyebrow="Pricing" title={<>Free at the core. <em>Real value</em> where it counts.</>} center>Start with everything you need to study. Upgrade only when the limits actually start to bite.</SectionHeading>
            <Reveal className="pricing-grid">
              <article className="pricing-card">
                <span className="plan-kicker">For getting started</span><h3>Free</h3><div className="price">$0 <small>always free</small></div>
                <ul>{FREE_FEATURES.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul>
                <ButtonLink href="/dashboard?start=sheet" onClick={startStudying} variant="ghost" testId="button-pricing-free">Start for free <ArrowRight size={15} /></ButtonLink>
              </article>
              <article className="pricing-card pricing-pro"><span className="popular-badge">MOST POPULAR</span><span className="plan-kicker">For the serious student</span><h3>Pro</h3><div className="price">$5 <small>/ month</small></div>
                <ul>{PRO_FEATURES.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul>
                <ButtonLink href={CONTACT_EMAIL} variant="accent" testId="button-pricing-pro">Get Pro <ArrowRight size={15} /></ButtonLink>
              </article>
            </Reveal>
          </div>
        </section>

        <section className="section timeline-section">
          <div className="container">
            <SectionHeading eyebrow="Built as evidence, used since day one" title={<>Started as a student problem. Grew into a <em>platform.</em></>} center />
            <Reveal className="timeline-grid">
              {[
                ["USMLE", "Step 1 & 2", "Question style benchmarked against real exam vignettes, not generic trivia."],
                ["Adaptive", "Spaced repetition engine", "Self-adjusts to what you keep forgetting, not a fixed 24-hour schedule."],
                ["Free tier", "No credit card required", "Start with everything you need — upgrade only when the limits start to bite."],
                ["MENA-first", "Built in Gaza", "Priced and localized for the region it was built to serve."],
              ].map(([kicker, title, copy]) => <article className="timeline-card" key={kicker}><span>{kicker}</span><h3>{title}</h3><p>{copy}</p></article>)}
            </Reveal>
          </div>
        </section>

        <section id="faq" className="section tinted-section faq-section">
          <div className="container faq-layout">
            <SectionHeading eyebrow="FAQ" title={<>Questions from students, faculty, and the <em>curious.</em></>} children="If yours isn't here, email us — it'll likely become the next line on this list." />
            <Reveal className="faq-list">
              {FAQS.map((faq, index) => <details className="faq-item" key={faq.q} open={index === 0}><summary data-testid={`button-faq-${index + 1}`}><span>{faq.q}</span><span className="faq-plus" aria-hidden="true">+</span></summary><p>{faq.a}</p></details>)}
            </Reveal>
          </div>
        </section>

        <section className="section final-cta-section">
          <Reveal className="container">
            <div className="final-cta"><div className="cta-grid" aria-hidden="true" /><div className="final-cta-inner"><Eyebrow dark>Open invitation</Eyebrow><h2>Growing across MENA.<br />Built with <em>students.</em></h2><p>StudyBuddy AI started in Gaza and is growing across the Arab world. If you're a medical student who wants better tools — join the early access list, or follow along on Instagram.</p><div className="cta-actions"><ButtonLink href="/dashboard?start=sheet" onClick={startStudying} variant="accent" testId="button-final-early-access">Get early access <ArrowRight size={16} /></ButtonLink><ButtonLink href={SOCIALS.instagram} variant="dark-ghost" target="_blank" rel="noopener noreferrer" testId="link-final-instagram">Follow on Instagram <Instagram size={15} /></ButtonLink></div></div></div>
          </Reveal>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand"><a href="#home" className="brand" data-testid="link-footer-home"><span className="brand-mark"><HeartPulse size={18} /></span><span className="brand-name">StudyBuddy <b>AI</b></span></a><p>AI study sheets, decks, and QBank for MENA medical students.</p></div>
            <div><h4>Product</h4><a href="#playground" data-testid="link-footer-how-it-works">How it works</a><a href="#qbank" data-testid="link-footer-qbank">QBank</a><a href="#features" data-testid="link-footer-features">Features</a><a href="#pricing" data-testid="link-footer-pricing">Pricing</a></div>
            <div><h4>Resources</h4><a href="#faq" data-testid="link-footer-faq">FAQ</a><a href="#home" data-testid="link-footer-roadmap">Roadmap</a><a href={CONTACT_EMAIL} data-testid="link-footer-email"><Mail size={14} /> Email us</a></div>
            <div><h4>Connect</h4><a href={SOCIALS.instagram} target="_blank" rel="noopener noreferrer" data-testid="link-footer-instagram"><Instagram size={14} /> Instagram</a><a href={SOCIALS.linkedin} target="_blank" rel="noopener noreferrer" data-testid="link-footer-linkedin"><Linkedin size={14} /> LinkedIn</a><a href={SOCIALS.telegram} target="_blank" rel="noopener noreferrer" data-testid="link-footer-telegram"><Send size={14} /> Telegram</a></div>
          </div>
          <div className="footer-bottom"><span>© {new Date().getFullYear()} StudyBuddy AI</span><span>Built by medical students, for medical students · Gaza</span><span className="footer-status"><span />Made for the next exam</span></div>
        </div>
      </footer>
    </div>
  );
}

export default App;