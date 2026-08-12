import { ArrowRight, Check, Laptop, Shield, Smartphone } from "lucide-react";

const features = [
  {
    title: "Mobile-first layout",
    description: "A single source of truth for spacing, typography, and breakpoints keeps the UI smooth from small phones to 2xl screens.",
    icon: Smartphone,
  },
  {
    title: "Semantic content",
    description: "Section, header, article, and footer provide clear structure for accessibility and screen reader navigation.",
    icon: Shield,
  },
  {
    title: "Adaptive grids",
    description: "Responsive Tailwind utilities shift from stacked to multi-column layouts at sm/md/lg/xl breakpoints.",
    icon: Laptop,
  },
  {
    title: "Fast interactions",
    description: "Buttons, links, and cards are keyboard-friendly, focus-visible, and optimized for readability.",
    icon: Check,
  },
];

const ResponsiveSection = () => {
  return (
    <section
      id="responsive-showcase"
      aria-labelledby="responsive-showcase-heading"
      className="bg-slate-50 text-slate-900"
    >
      <div className="container mx-auto px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="grid gap-12 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
          <article className="space-y-8">
            <header>
              <p className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200">
                <Shield className="h-4 w-4" aria-hidden="true" />
                Responsive UI for every screen
              </p>
              <h2
                id="responsive-showcase-heading"
                className="mt-6 text-3xl font-bold leading-tight text-slate-950 sm:text-4xl lg:text-5xl"
              >
                Built with Tailwind breakpoints for all screen sizes.
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg lg:text-xl">
                This section uses mobile-first spacing, semantic layout tags, and responsive grid/flex utilities so content adapts fluidly from portrait phones to wide desktop displays.
              </p>
            </header>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {features.map(({ title, description, icon: Icon }) => (
                <article
                  key={title}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 focus-within:border-slate-400 focus-within:outline-none focus-within:ring-2 focus-within:ring-slate-300"
                  tabIndex={0}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900 sm:text-xl">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">{description}</p>
                </article>
              ))}
            </div>

            <footer className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-[1.2fr_auto] sm:items-center">
              <div>
                <p className="text-sm leading-6 text-slate-600 sm:text-base">
                  Ready to use a responsive section that scales from mobile to 2xl displays? It is optimized for readability, spacing, and interaction.
                </p>
              </div>
              <a
                href="#qbank"
                className="inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 sm:w-auto"
              >
                Try the QBank
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </footer>
          </article>

          <article className="relative overflow-hidden rounded-[2rem] bg-slate-950 shadow-2xl ring-1 ring-slate-900/5">
            <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-emerald-500/20 to-transparent" aria-hidden="true" />
            <img
              className="h-72 w-full object-cover sm:h-96 lg:h-[520px]"
              src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80"
              alt="Medical student using a tablet with a responsive study app"
              loading="lazy"
            />
            <div className="absolute inset-x-0 bottom-0 bg-slate-950/90 px-6 py-7 backdrop-blur-sm sm:px-8">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">Mobile-first imagery</p>
              <h3 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Fluid visuals with `object-cover`, `w-full`, and `h-auto`.
              </h3>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                Images are lazy-loaded and sized for every breakpoint, so the layout stays crisp while preserving performance.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
};

export default ResponsiveSection;
