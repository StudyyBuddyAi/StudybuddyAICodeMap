import React from "react";
import "../pages/index.css";

const features = [
  {
    title: "Study between lectures",
    subtitle:
      "AI generates structured notes from your lectures and resources in seconds.",
    icon: "beaker",
  },
  {
    title: "Practice in context",
    subtitle:
      "High-yield questions aligned to what you just studied, not generic banks.",
    icon: "layers",
  },
  {
    title: "Review with flashcards",
    subtitle:
      "Spaced repetition flashcards auto-generated from your own study material.",
    icon: "doc",
  },
  {
    title: "Track your progress",
    subtitle:
      "Analytics show weak spots across subjects so you can focus where it matters.",
    icon: "chart",
  },
];

const Icon = ({ name }: { name: string }) => {
  const common = { width: 24, height: 24, fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as any;
  switch (name) {
    case "beaker":
      return (
        <svg {...common} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 2v4.2a2 2 0 0 0 .586 1.414L10.5 10v4a4 4 0 0 0 4 4 4 4 0 0 0 4-4v-4l1.914-2.386A2 2 0 0 0 20 6.2V2z" />
          <path d="M3 2h18" />
          <path d="M9 7h6" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l9 5-9 5-9-5 9-5z" />
          <path d="M3 12l9 5 9-5" />
          <path d="M3 19l9 5 9-5" />
        </svg>
      );
    case "doc":
      return (
        <svg {...common} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 13h6M9 17h6" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3v18h18" />
          <path d="M7 13v6" />
          <path d="M12 9v10" />
          <path d="M17 5v14" />
        </svg>
      );
    default:
      return null;
  }
};

const ResponsiveSection: React.FC = () => {
  return (
    <section
      aria-labelledby="hero-heading"
      className="section relative overflow-hidden"
      style={{ padding: "88px 0" }}
    >
      <div className="wrap">
        <div className="section-head text-center mx-auto">
          <span className="eyebrow mx-auto">
            <span className="dot" aria-hidden="true" />
            ONE PLATFORM
          </span>

          <h2 id="hero-heading">
            From first lecture to final exam,
            <br />
            in <span className="hl">one place.</span>
          </h2>

          <p className="mt-4">
            Stop juggling PDFs, question banks, and flashcards apps. StudyBuddy
            integrates every step of the medical learning workflow.
          </p>
        </div>

        <div className="features mt-12">
          {features.map(({ title, subtitle, icon }) => (
            <div
              key={title}
              className="feature"
              tabIndex={0}
            >
              <div className="icon">
                <Icon name={icon} />
              </div>

              <div>
                <h3>{title}</h3>
                <p>{subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ResponsiveSection;
