import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileText,
  FlaskConical,
  Flame,
  Layers,
  LockKeyhole,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import "./dashboard.css"
import DashboardLayout from "@/components/dashboard/DashboardLayout";
type StatValueProps = {
  value: ReactNode;
  label: string;
  icon: ReactNode;
  tone: "teal" | "warm" | "slate";
  testId: string;
};

function StatValue({ value, label, icon, tone, testId }: StatValueProps) {
  return (
    <div className="dashboard-stat" data-testid={testId}>
      <span className={`dashboard-stat-icon dashboard-stat-icon-${tone}`}>{icon}</span>
      <div>
        <div className="dashboard-stat-value">{value}</div>
        <div className="dashboard-stat-label">{label}</div>
      </div>
    </div>
  );
}

type ToolCardProps = {
  icon: ReactNode;
  title: string;
  description: string;
  stat: ReactNode;
  href: string;
  featured?: boolean;
  testId: string;
};

function ToolCard({ icon, title, description, stat, href, featured = false, testId }: ToolCardProps) {
  return (
    <Link
      to={href}
      className={`dashboard-tool-card ${featured ? "dashboard-tool-card-featured" : ""}`}
      data-testid={testId}
    >
      <div className="dashboard-tool-content">
        <span className="dashboard-tool-icon">{icon}</span>
        <div className="dashboard-tool-kicker">{featured ? "Recommended starting point" : "Study tool"}</div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="dashboard-tool-footer">
        <span className="dashboard-tool-stat">{stat}</span>
        <span className="dashboard-tool-open">Open <ArrowRight size={14} /></span>
      </div>
    </Link>
  );
}

function ComingSoonCard() {
  return (
    <div className="dashboard-tool-card dashboard-tool-card-disabled" data-testid="card-tool-clinical-cases">
      <div className="dashboard-tool-content">
        <div className="dashboard-tool-topline">
          <span className="dashboard-tool-icon"><Stethoscope size={18} /></span>
          <span className="dashboard-coming-soon"><LockKeyhole size={10} /> Coming soon</span>
        </div>
        <div className="dashboard-tool-kicker">Next on the roadmap</div>
        <h3>Clinical Cases</h3>
        <p>Train for OSCE exams with history, examination, investigations, and management in one flow.</p>
      </div>
      <div className="dashboard-tool-footer">
        <span className="dashboard-tool-stat">In development</span>
      </div>
    </div>
  );
}

function DashboardHeader() {
  const navigate = useNavigate();
  return (
    <header className="dashboard-header">
      <div className="dashboard-header-inner">
        <button type="button" className="dashboard-back-link" onClick={() => navigate("/")} data-testid="button-dashboard-home">
          <ArrowLeft size={15} />
          <span>StudyBuddy <b>AI</b></span>
        </button>
        <div className="dashboard-header-meta">
          <span className="dashboard-online-dot" />
          <span>Student workspace</span>
          <span className="dashboard-avatar" aria-label="Guest account">G</span>
        </div>
      </div>
    </header>
  );
}

function Dashboard() {
  const [statsLoading, setStatsLoading] = useState(true);
  const [isAnonymous] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setStatsLoading(false), 520);
    return () => window.clearTimeout(timeout);
  }, []);

  const anonymousMessage = (
    <span className="dashboard-stat-muted">Sign in to track</span>
  );
  const sheetStat = statsLoading ? <span className="dashboard-stat-loading" aria-label="Loading">•••</span> : (
    <><strong>0</strong> sheets this week</>
  );
  const flashcardStat = statsLoading ? <span className="dashboard-stat-loading" aria-label="Loading">•••</span> : (
    isAnonymous ? anonymousMessage : <><strong>0</strong> cards due today</>
  );
  const qbankStat = statsLoading ? <span className="dashboard-stat-loading" aria-label="Loading">•••</span> : (
    <><strong>0</strong> questions ready</>
  );

  return (
  <>
    <DashboardLayout >
      {/* <DashboardHeader /> */}
      <main className="dashboard-main">
        <div className="dashboard-container">
          <section className="dashboard-welcome" aria-labelledby="dashboard-title">
            <div>
              <div className="dashboard-eyebrow"><span className="dashboard-eyebrow-dot" /> Your study space</div>
              <h1 id="dashboard-title">Make today’s study hour <em>count.</em></h1>
              <p>Pick up where you left off, or start with a focused study sheet.</p>
            </div>
            <div className="dashboard-date" data-testid="text-dashboard-date">
              <span>SESSION 01</span>
              <strong>Ready when you are</strong>
            </div>
          </section>

          <section className="dashboard-pro-banner" aria-label="StudyBuddy Pro offer" data-testid="banner-go-pro">
            <div className="dashboard-pro-icon"><Sparkles size={17} className="text-white"/></div>
            <div className="dashboard-pro-copy">
              <strong>Unlock Claude + unlimited generations</strong>
              <span>Go Pro for Anthropic's AI and no limits.</span>
            </div>
            <button type="button" className="dashboard-pro-button text-white" onClick={() => window.location.href = "mailto:osama200az@gmail.com"} data-testid="button-go-pro">Go Pro</button>
            <span className="dashboard-pro-dismiss" aria-hidden="true">×</span>
          </section>

          <section className="dashboard-progress-panel" aria-labelledby="progress-title">
            <div className="dashboard-section-label" id="progress-title">Your progress</div>
            <div className="dashboard-stats-grid">
              <StatValue icon={<FileText size={17} />} tone="slate" value={sheetStat} label="" testId="stat-sheets-week" />
              <StatValue icon={<Layers size={17} />} tone="teal" value={flashcardStat} label="" testId="stat-cards-due" />
              <StatValue icon={<Flame size={17} />} tone="warm" value={statsLoading ? <span className="dashboard-stat-loading">•••</span> : <><strong>0</strong> days streak</>} label="" testId="stat-days-streak" />
              <div className="dashboard-progress-note">
                <BarChart3 size={14} />
                <span>{statsLoading ? "Preparing your overview" : "A small session today keeps momentum going."}</span>
              </div>
            </div>
          </section>

          <section className="dashboard-tools-section" aria-labelledby="tools-title">
            <div className="dashboard-tools-heading">
              <div>
                <div className="dashboard-section-label" id="tools-title">Tools · Study smarter</div>
                <p>Everything you need, in one place</p>
              </div>
              <span className="dashboard-tools-count">03 active tools</span>
            </div>

            <div className="dashboard-tools-grid">
              <ToolCard
                icon={<FileText size={19} />}
                title="Study Sheet"
                description="Generate a high-yield, exam-ready study sheet on any medical topic in seconds."
                stat={sheetStat}
                href="/sheets"
                featured
                testId="card-tool-study-sheet"
              />
              <ToolCard
                icon={<Layers size={19} />}
                title="Flashcards"
                description="Build a spaced-repetition deck on any topic and drill until it sticks."
                stat={flashcardStat}
                href="/flashcards"
                testId="card-tool-flashcards"
              />
              <ToolCard
                icon={<FlaskConical size={19} />}
                title="QBank"
                description="USMLE-style questions for Step 1 and Step 2, human-verified and built for clinical reasoning."
                stat={qbankStat}
                href="/qbank"
                testId="card-tool-qbank"
              />
              <ComingSoonCard />
            </div>
          </section>

          <section className="dashboard-footnote" aria-label="Study tip">
            <CheckCircle2 size={16} />
            <span><strong>Tip:</strong> start with a topic you found difficult today — the best next session is usually the one you almost put off.</span>
          </section>
        </div>
      </main>
    </DashboardLayout>
    </>
  );
}

export default Dashboard;