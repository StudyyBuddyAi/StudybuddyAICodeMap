import { ArrowRight, BookOpenCheck, Clock, ShieldCheck, Stethoscope } from "lucide-react";

const features = [
  {
    title: "Study between lectures",
    description:
      "Generate a sheet on the ward, revise flashcards on the bus, sit a question block before bed. Your progress follows you.",
    icon: Clock,
  },
  {
    title: "Evidence you can check",
    description:
      "Study sheets link out to the PubMed papers behind them, so you can trace any claim back to the literature.",
    icon: ShieldCheck,
  },
  {
    title: "Exam-shaped from the start",
    description:
      "Clinical vignettes, single best answers, and plausible distractors — the format you will meet on the day.",
    icon: BookOpenCheck,
  },
  {
    title: "Built by a medical student",
    description:
      "Every feature exists because a student lost hours to the problem it solves. Nothing here is filler.",
    icon: Stethoscope,
  },
];

/** A worked example rendered in markup rather than a stock photo — no external
 *  asset to load, and it re-themes with the rest of the page. */
const SheetPreview = () => (
  <div className="space-y-4" aria-hidden="true">
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
        Study sheet
      </span>
      <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
        Cardiology
      </span>
    </div>

    <h3 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
      Acute coronary syndromes
    </h3>

    <dl className="space-y-3">
      {[
        ["Presentation", "Crushing retrosternal chest pain, often radiating to the jaw or left arm."],
        ["Key finding", "ST elevation in II, III and aVF localises to the inferior wall."],
        ["First step", "Dual antiplatelet therapy and immediate reperfusion assessment."],
      ].map(([term, detail]) => (
        <div key={term} className="rounded-xl border border-border bg-card p-4">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {term}
          </dt>
          <dd className="mt-1.5 text-sm leading-6 text-foreground">{detail}</dd>
        </div>
      ))}
    </dl>

    <p className="text-xs text-muted-foreground">
      Every sheet carries an overview, pathophysiology, diagnosis and management.
    </p>
  </div>
);

const ResponsiveSection = () => {
  return (
    <section
      id="why-studybuddy"
      aria-labelledby="why-studybuddy-heading"
      className="bg-secondary text-foreground"
    >
      <div className="container mx-auto px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="grid gap-12 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
          <article className="space-y-8">
            <header>
              <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary ring-1 ring-primary/20">
                <Stethoscope className="h-4 w-4" aria-hidden="true" />
                Made for the way medical students actually study
              </p>
              <h2
                id="why-studybuddy-heading"
                className="mt-6 text-3xl font-bold leading-tight text-foreground sm:text-4xl lg:text-5xl"
              >
                From first lecture to final exam, in one place.
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg lg:text-xl">
                Name a topic and get a structured clinical sheet, a deck to drill it,
                and questions to prove you know it — without hunting through four
                different apps to get there.
              </p>
            </header>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {features.map(({ title, description, icon: Icon }) => (
                <article
                  key={title}
                  className="rounded-3xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/50 focus-within:border-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-ring"
                  tabIndex={0}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-foreground sm:text-xl">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                    {description}
                  </p>
                </article>
              ))}
            </div>

            <footer className="grid gap-4 rounded-3xl border border-border bg-card p-6 shadow-sm sm:grid-cols-[1.2fr_auto] sm:items-center">
              <div>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base">
                  Ready to try it on a topic you are revising this week? The question
                  bank is free to start, with no card required.
                </p>
              </div>
              <a
                href="#qbank"
                className="inline-flex w-full items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card sm:w-auto"
              >
                Try the QBank
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </footer>
          </article>

          <article className="relative overflow-hidden rounded-[2rem] border border-border bg-background p-6 shadow-2xl sm:p-8">
            <div
              className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-primary/15 to-transparent"
              aria-hidden="true"
            />
            <div className="relative">
              <SheetPreview />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
};

export default ResponsiveSection;
