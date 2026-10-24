import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  FileText,
  Instagram,
  Layers,
  Linkedin,
  Menu,
  Moon,
  Play,
  Send,
  Shield,
  Sparkles,
  Stethoscope,
  Sun,
  Target,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { FilmSection, type FilmHandle } from "@/components/landing/FilmSection";
import BrandMark from "@/components/brand/BrandMark";
import { useAuth } from "@/hooks/use-auth";
import { readPendingUpgrade } from "@/lib/auth-upgrade";
import { isRecoveryPending } from "@/lib/recovery-landing";
import { useTheme } from "@/hooks/use-theme";
import GoProModal from "@/components/GoProModal";
import "@/pages/index.css";
const SOCIALS = {
  instagram: "https://www.instagram.com/getstudybuddyai/",
  linkedin: "https://www.linkedin.com/company/studdybuddyai",
  telegram: "https://t.me/studybuddyai",
};

const NAV_LINKS = [
  { href: "#tools", label: "Features" },
  { href: "#film", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const TOOLS = [
  {
    icon: FileText,
    name: "Study Sheets",
    verb: "Understand",
    desc: "Explore structured medical topics, add your notes, and dive deeper into difficult concepts.",
  },
  {
    icon: Layers,
    name: "Flashcards",
    verb: "Remember",
    desc: "Reinforce key concepts with spaced-repetition flashcards.",
  },
  {
    icon: Target,
    name: "QBank",
    verb: "Apply",
    desc: "Practice USMLE-style questions with explanations that help you learn from each answer.",
  },
];

const DEEP_FEATURES = [
  { title: "Deep dives", desc: "Open any section into a focused branch — mechanism, differentials, management — without leaving the sheet." },
  { title: "Spaced repetition", desc: "Cards come back just before you would forget them, tuned to your own memory, not a fixed 24-hour schedule." },
  { title: "Make it yours", desc: "Highlight, add notes, rewrite a line with AI, or turn any line into a flashcard." },
  { title: "One topic, three tools", desc: "Finish a sheet and practise the same topic in the QBank or add its cards to your deck in one tap." },
  { title: "Export", desc: "Download any sheet as a PDF or Word file to print or share." },
];

const FAQS = [
  {
    q: "What is StudyBuddy AI?",
    a: "An AI study platform for medical students. Name a topic and get a structured study sheet, flashcards with spaced repetition, and USMLE-style practice questions — in one place.",
  },
  {
    q: "Which exams is it for?",
    a: "USMLE Step 1 and Step 2 CK. In the QBank you choose Step 1, Step 2 CK, or a mix, and every question is a single-best-answer clinical vignette with explanations.",
  },
  {
    q: "Can I try it without an account?",
    a: "Yes. As a guest you can make 5 study sheets and 5 flashcard decks a day; guest decks stay on your device. The QBank needs a free account so your sets are saved and you can resume them.",
  },
  {
    q: "Where do the answers come from?",
    a: "Sheets are grounded in our medical reference library and show the sources they used. If a topic is not in the library, the sheet says so and asks you to check a primary source.",
  },
  {
    q: "Is my data private?",
    a: "Your sheets, decks, and sessions sync to your account. We don't sell your data or share it with third parties.",
  },
  {
    q: "Can I use it on my phone?",
    a: "Yes — StudyBuddy AI works in any mobile browser. A native app is on the roadmap.",
  },
];

const PLANS = [
  {
    key: "guest",
    kicker: "No account",
    name: "Guest",
    price: "$0",
    note: "try it now",
    features: [
      "5 study sheets a day",
      "5 flashcard decks a day, saved on this device",
      "1 sheet written by our medical AI model",
      "1 PubMed citation lookup a day",
      "QBank needs a free account",
    ],
    cta: "Try as guest",
  },
  {
    key: "free",
    kicker: "Free account",
    name: "Free",
    price: "$0",
    note: "always free",
    features: [
      "5 study sheets a day",
      "5 flashcard decks a day, synced to your account",
      "QBank: USMLE-style sets of up to 20 questions",
      "3 sheets written by our medical AI model",
      "3 PubMed citation lookups a day",
      "Progress and history saved",
    ],
    cta: "Start free",
  },
  {
    key: "pro",
    kicker: "For the serious student",
    name: "Pro",
    price: "$5",
    note: "/ month",
    features: [
      "Unlimited study sheets and flashcard decks",
      "Our medical AI model, whenever you choose it",
      "Unlimited PubMed citation lookups",
      "Make sheets yours: highlight, notes, AI rewrite",
      "Everything in Free",
    ],
    cta: "Get Pro",
  },
] as const;

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

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span className={`eyebrow ${dark ? "eyebrow-dark" : ""}`}>{children}</span>
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
  className = "",
}: {
  children: ReactNode;
  className?: string;
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
      className={`button button-${variant} ${className}`}
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
  const { user, isAnonymous, loading } = useAuth();
  const signedIn = !loading && !!user && !isAnonymous;

  // The landing page is for visitors. A signed-in student goes straight to
  // the app — unless this load is finishing something that started elsewhere:
  // a Google sign-in or a password-reset link whose callback URL isn't
  // allow-listed comes back to the Site URL, here, with the session set.
  useEffect(() => {
    if (!signedIn) return;
    if (isRecoveryPending()) navigate("/reset-password", { replace: true });
    else if (readPendingUpgrade()) navigate("/auth/callback", { replace: true });
    else navigate("/dashboard", { replace: true });
  }, [signedIn, navigate]);
  const [goProOpen, setGoProOpen] = useState(false);
  // The same theme setting the app uses, so a choice made on either side
  // survives a visit to the other and a reload.
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const startStudying = () => navigate("/dashboard?start=sheet");
  const signIn = () => navigate("/dashboard?signin=1");
  const filmRef = useRef<FilmHandle>(null);
  const closeMenu = () => setMenuOpen(false);
  const watchDemo = (event: MouseEvent) => {
    if (!filmRef.current) return;
    event.preventDefault();
    filmRef.current.playFromTop();
  };

  if (signedIn) return null;

  return (
    <div className="site-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className={`site-header ${menuOpen ? "menu-open" : ""}`}>
        <div className="container header-inner">
          <a href="#home" className="brand" onClick={closeMenu} data-testid="link-brand-home" aria-label="StudyBuddy AI home">
            <BrandMark size={44} className="brand-mark" />
            <span className="brand-name">StudyBuddy <b>AI</b></span>
            <span className="brand-beta">BETA</span>
          </a>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              <a href={link.href} key={link.href} data-testid={`link-nav-${link.href.slice(1)}`}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <button className="theme-button" type="button" onClick={toggleTheme} aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} data-testid="button-theme-toggle">
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <ButtonLink href="/dashboard?signin=1" onClick={signIn} variant="ghost" className="header-sign-in" testId="button-header-sign-in">
              Sign in
            </ButtonLink>
            <ButtonLink href="/dashboard?start=sheet" onClick={startStudying} testId="button-header-start-free">
              <span className="header-cta-label">Start free</span><ArrowRight size={15} />
            </ButtonLink>
            <button className="menu-button" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-controls="mobile-nav" aria-label={menuOpen ? "Close menu" : "Open menu"} data-testid="button-mobile-menu">
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation">
          {NAV_LINKS.map((link) => (
            <a href={link.href} key={link.href} onClick={closeMenu} data-testid={`link-mobile-${link.href.slice(1)}`}>{link.label}<ArrowUpRight size={14} /></a>
          ))}
          <ButtonLink href="/dashboard?signin=1" onClick={() => { closeMenu(); signIn(); }} variant="ghost" testId="button-mobile-sign-in">Sign in</ButtonLink>
          <ButtonLink href="/dashboard?start=sheet" onClick={() => { closeMenu(); startStudying(); }} testId="button-mobile-start-free">Start free <ArrowRight size={15} /></ButtonLink>
        </nav>
      </header>

      <main>
        <section id="home" className="hero-section">
          <div className="container hero-grid">
            <div className="hero-copy">
              <Reveal>
                <h1>Study smarter.<br />Score <em>higher.</em> Pass.</h1>
                <p className="hero-lede">Build your understanding with AI-powered Study Sheets, go deeper where you need clarity, and put your knowledge into practice with Flashcards and a USMLE-style QBank.</p>
                <div className="hero-actions">
                  <ButtonLink href="/dashboard?start=sheet" onClick={startStudying} testId="button-hero-early-access">Get early access <ArrowRight size={18} /></ButtonLink>
                  <a href="#film" className="button button-ghost" data-testid="link-hero-watch-demo" onClick={watchDemo}>
                    <Play size={15} fill="currentColor" strokeWidth={0} /> Watch demo
                  </a>
                </div>
                <p className="hero-exam">Built by an MD for medical students across MENA.</p>
              </Reveal>
            </div>
            <Reveal direction="left" delay={160} className="hero-visual-wrap">
              <SheetPreview />
              <div className="floating-note floating-note-bottom"><span className="note-icon"><BookOpen size={14} /></span><span><b>3 sources cited</b><small>Tap any source to open it</small></span></div>
            </Reveal>
          </div>
        </section>

        <div className="subject-ticker" aria-hidden="true">
          <div className="ticker-track"><span>Cardiology</span><i>·</i><span>Pharmacology</span><i>·</i><span>Pathology</span><i>·</i><span>Microbiology</span><i>·</i><span>Surgery</span><i>·</i><span>Anatomy</span><i>·</i><span>Cardiology</span><i>·</i><span>Pharmacology</span><i>·</i><span>Pathology</span><i>·</i><span>Microbiology</span><i>·</i><span>Surgery</span><i>·</i><span>Anatomy</span></div>
        </div>

        <section id="tools" className="section tools-section">
          <div className="container">
            <SectionHeading eyebrow="Core tools" title={<>Understand. Remember. <em>Apply.</em></>} center />
            <Reveal className="tools-grid">
              {TOOLS.map((tool) => {
                const Icon = tool.icon;
                return (
                  <article className="tool-card" key={tool.name} data-testid={`card-tool-${tool.name.toLowerCase().replace(" ", "-")}`}>
                    <span className="feature-icon"><Icon size={19} /></span>
                    <h3>{tool.name} <span>— {tool.verb}</span></h3>
                    <p>{tool.desc}</p>
                  </article>
                );
              })}
            </Reveal>
          </div>
        </section>

        <FilmSection ref={filmRef} onStart={startStudying} />

        <section id="deep-dives" className="section">
          <div className="container split-grid">
            <Reveal direction="right" className="split-visual">
              <DeepDivePreview />
            </Reveal>
            <Reveal>
              <SectionHeading eyebrow="Inside a sheet" title={<>Go deeper where you <em>need clarity.</em></>} />
              <ul className="bullet-list">
                {DEEP_FEATURES.map((f) => (
                  <li key={f.title}><Check size={16} /><span><b>{f.title}.</b> {f.desc}</span></li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        <section id="sources" className="section tinted-section">
          <div className="container split-grid split-grid-reverse">
            <Reveal>
              <SectionHeading eyebrow="Medical sources" title={<>Answers you can <em>check.</em></>} />
              <ul className="bullet-list">
                <li><Check size={16} /><span><b>Sources on every sheet.</b> The references a sheet used are listed at the end — textbook chapter or PubMed paper.</span></li>
                <li><Check size={16} /><span><b>One tap to verify.</b> Each PubMed source opens the original paper so you can read it yourself.</span></li>
                <li><Check size={16} /><span><b>Honest when it can't.</b> If a topic isn't in our reference library, the sheet says so and asks you to check a primary source.</span></li>
              </ul>
            </Reveal>
            <Reveal direction="left" className="split-visual">
              <SourcesPreview />
            </Reveal>
          </div>
        </section>

        <section id="pricing" className="section pricing-section">
          <div className="container">
            <SectionHeading eyebrow="Pricing" title={<>Start free. <em>Upgrade</em> when you need more.</>} center>No credit card required. Limits reset every day.</SectionHeading>
            <Reveal className="pricing-grid">
              {PLANS.map((plan) => (
                <article className={`pricing-card ${plan.key === "pro" ? "pricing-pro" : ""}`} key={plan.key} data-testid={`card-plan-${plan.key}`}>
                  {plan.key === "pro" ? <span className="popular-badge">MOST POPULAR</span> : null}
                  <span className="plan-kicker">{plan.kicker}</span>
                  <h3>{plan.name}</h3>
                  <div className="price">{plan.price} <small>{plan.note}</small></div>
                  <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul>
                  {plan.key === "pro" ? (
                    <ButtonLink href="#pricing" onClick={() => setGoProOpen(true)} variant="accent" testId="button-pricing-pro">{plan.cta} <ArrowRight size={15} /></ButtonLink>
                  ) : (
                    <ButtonLink href="/dashboard?start=sheet" onClick={plan.key === "free" ? signIn : startStudying} variant="ghost" testId={`button-pricing-${plan.key}`}>{plan.cta} <ArrowRight size={15} /></ButtonLink>
                  )}
                </article>
              ))}
            </Reveal>
          </div>
        </section>

        <section id="faq" className="section tinted-section faq-section">
          <div className="container faq-layout">
            <SectionHeading eyebrow="FAQ" title={<>Questions, <em>answered.</em></>} />
            <Reveal className="faq-list">
              {FAQS.map((faq, index) => <details className="faq-item" key={faq.q} open={index === 0}><summary data-testid={`button-faq-${index + 1}`}><span>{faq.q}</span><span className="faq-plus" aria-hidden="true">+</span></summary><p>{faq.a}</p></details>)}
            </Reveal>
          </div>
        </section>

      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand"><a href="#home" className="brand" data-testid="link-footer-home"><BrandMark size={34} className="brand-mark" /><span className="brand-name">StudyBuddy <b>AI</b></span></a><p>Study sheets, flashcards, and a USMLE-style QBank for medical students.</p></div>
            <div><h4>Product</h4><a href="#tools" data-testid="link-footer-tools">Tools</a><a href="#film" data-testid="link-footer-demo">Demo</a><a href="#pricing" data-testid="link-footer-pricing">Pricing</a></div>
            <div><h4>Resources</h4><a href="#faq" data-testid="link-footer-faq">FAQ</a></div>
            <div><h4>Connect</h4><a href={SOCIALS.instagram} target="_blank" rel="noopener noreferrer" data-testid="link-footer-instagram"><Instagram size={14} /> Instagram</a><a href={SOCIALS.linkedin} target="_blank" rel="noopener noreferrer" data-testid="link-footer-linkedin"><Linkedin size={14} /> LinkedIn</a><a href={SOCIALS.telegram} target="_blank" rel="noopener noreferrer" data-testid="link-footer-telegram"><Send size={14} /> Telegram</a></div>
          </div>
          <div className="footer-bottom"><span>© {new Date().getFullYear()} StudyBuddy AI</span><span>Built in Gaza, for medical students across MENA</span></div>
        </div>
      </footer>
      <GoProModal open={goProOpen} onOpenChange={setGoProOpen} />
    </div>
  );
}

/** A study sheet as the Sheets page renders it — the hero shows the real output, not a mock question. */
function SheetPreview() {
  return (
    <div className="sheet-preview" role="img" aria-label="A StudyBuddy study sheet on warfarin, with an overview, key points and cited sources">
      <div className="sheet-preview-head">
        <div>
          <h3>Warfarin</h3>
          <span className="sheet-preview-meta">Pharmacology · Step 1 · High-yield</span>
        </div>
        <span className="sheet-preview-chip"><Stethoscope size={13} /> Deep dives</span>
      </div>
      <div className="sheet-preview-section">
        <span className="sheet-preview-label"><BookOpen size={13} /> Overview</span>
        <p><b>Mechanism:</b> inhibits vitamin K epoxide reductase — blocks γ-carboxylation of factors II, VII, IX and X.</p>
      </div>
      <div className="sheet-preview-section">
        <span className="sheet-preview-label"><Sparkles size={13} /> Key points</span>
        <ul>
          <li>Monitor with <b>PT/INR</b> (target 2–3 for most indications)</li>
          <li>Reverse with <b>vitamin K</b>; add PCC if bleeding</li>
          <li>Teratogenic — avoid in pregnancy</li>
        </ul>
      </div>
      <div className="sheet-preview-sources">
        <span><BookOpen size={12} /> PubMed · Warfarin drug and food interactions</span>
        <span><FileText size={12} /> Katzung · Ch. 34 Anticoagulants</span>
      </div>
    </div>
  );
}

function DeepDivePreview() {
  return (
    <div className="sheet-preview sheet-preview-flat" role="img" aria-label="A sheet section opened into a deep dive on warfarin reversal">
      <span className="sheet-preview-label"><Stethoscope size={13} /> Deep dive · Reversal</span>
      <p className="deep-q">How do you reverse warfarin in a patient who is bleeding?</p>
      <ul>
        <li>Stop warfarin and give <b>IV vitamin K</b></li>
        <li>Give <b>4-factor PCC</b> for immediate reversal</li>
        <li>FFP only if PCC is unavailable</li>
      </ul>
      <div className="deep-actions">
        <span><Layers size={12} /> Turn into flashcard</span>
        <span><Target size={12} /> Practice in QBank</span>
      </div>
    </div>
  );
}

function SourcesPreview() {
  return (
    <div className="sheet-preview sheet-preview-flat" role="img" aria-label="The sources block at the end of a sheet, listing a PubMed paper and a textbook chapter">
      <span className="sheet-preview-label"><FileText size={13} /> Sources</span>
      <ol className="source-list">
        <li><b>PubMed</b> · Systematic overview of warfarin and its drug and food interactions <ArrowUpRight size={12} /></li>
        <li><b>PubMed</b> · Reversal of vitamin K antagonists <ArrowUpRight size={12} /></li>
        <li><b>Katzung</b> · Basic &amp; Clinical Pharmacology, Ch. 34</li>
      </ol>
      <div className="source-warning"><Shield size={13} /> Not in our library? The sheet tells you, so you know to check.</div>
    </div>
  );
}

export default App;