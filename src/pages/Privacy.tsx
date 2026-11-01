import { useEffect, type ReactNode } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import AppFooter from "@/components/layout/AppFooter";
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_INTRO,
  PRIVACY_LAST_UPDATED,
  PRIVACY_SECTIONS,
  PRIVACY_SUMMARY,
  type PrivacyBlock,
  type PrivacyListItem,
} from "@/content/privacy";

const MAILTO = `mailto:${PRIVACY_CONTACT_EMAIL}`;

/** Plain text, with the contact address made a mailto link wherever it appears. */
const Text = ({ children }: { children: string }) => {
  const parts = children.split(PRIVACY_CONTACT_EMAIL);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <a href={MAILTO} className="font-medium text-primary underline underline-offset-4">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          )}
        </span>
      ))}
    </>
  );
};

const ListItem = ({ item }: { item: PrivacyListItem }) =>
  typeof item === "string" ? (
    <li>
      <Text>{item}</Text>
    </li>
  ) : (
    <li>
      <span className="font-semibold text-foreground">{item.term}</span> <Text>{item.text}</Text>
    </li>
  );

const Block = ({ block }: { block: PrivacyBlock }) => {
  if (typeof block === "string") {
    return (
      <p className="text-[15px] leading-7 text-muted-foreground">
        <Text>{block}</Text>
      </p>
    );
  }
  if ("subheading" in block) {
    return <h3 className="pt-2 text-base font-semibold text-foreground">{block.subheading}</h3>;
  }
  if ("list" in block) {
    return (
      <ul className="list-disc space-y-2 ps-5 text-[15px] leading-7 text-muted-foreground marker:text-primary">
        {block.list.map((item, i) => (
          <ListItem key={i} item={item} />
        ))}
      </ul>
    );
  }
  if ("note" in block) {
    return (
      <p
        role="note"
        className="rounded-lg border-s-4 border-warning bg-warning-soft px-4 py-3 text-[15px] leading-7 text-foreground"
      >
        {block.note}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-start text-sm">
        <thead className="bg-muted/60">
          <tr>
            {block.table.head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 text-start font-semibold text-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row) => (
            <tr key={row[0]} className="border-t border-border align-top">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`px-4 py-3 leading-6 ${i === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-border bg-card p-6 ${className}`}>{children}</div>
);

/**
 * The privacy policy: public, signed in or not, linked from the landing
 * footer, every app page's footer and the apps' Settings. The text lives in
 * src/content/privacy.ts.
 */
const Privacy = () => {
  // The page loads lazily, after the browser looked for #delete-account:
  // scroll to a linked section once it exists.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border print:hidden">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-5 py-4">
          <a href="/" aria-label="StudyBuddy AI home" className="flex items-center gap-2.5">
            <BrandMark size={32} />
            <span className="text-[15px] font-semibold tracking-tight text-foreground">StudyBuddy AI</span>
          </a>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
            Back to StudyBuddy
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 py-12 sm:py-16">
        <div className="max-w-[760px] space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Legal</p>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <div className="flex gap-1.5">
              <dt>Effective date:</dt>
              <dd className="font-medium text-foreground">{PRIVACY_EFFECTIVE_DATE}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Last updated:</dt>
              <dd className="font-medium text-foreground">{PRIVACY_LAST_UPDATED}</dd>
            </div>
          </dl>
          {PRIVACY_INTRO.map((p) => (
            <p key={p} className="text-[15px] leading-7 text-foreground">
              {p}
            </p>
          ))}
        </div>

        <Card className="mt-10 max-w-[760px]">
          <h2 className="text-base font-semibold text-foreground">Summary</h2>
          <ul className="mt-3 list-disc space-y-2 ps-5 text-[15px] leading-7 text-muted-foreground marker:text-primary">
            {PRIVACY_SUMMARY.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            This summary is for convenience. The full policy below is what applies.
          </p>
        </Card>

        <div className="mt-12 grid gap-12 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="Contents" className="print:hidden">
            <div className="lg:sticky lg:top-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contents</p>
              <ol className="space-y-1.5 text-sm">
                {PRIVACY_SECTIONS.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="flex gap-2 rounded-md py-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <span className="w-5 shrink-0 tabular-nums text-muted-foreground/70">{i + 1}.</span>
                      <span>{s.heading}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          <article className="max-w-[760px] space-y-12">
            {PRIVACY_SECTIONS.map((section, i) => (
              <section key={section.id} id={section.id} className="scroll-mt-8 space-y-4">
                <h2 className="flex gap-3 text-xl font-semibold tracking-tight text-foreground">
                  <span aria-hidden className="tabular-nums text-primary">
                    {i + 1}.
                  </span>
                  <span>{section.heading}</span>
                </h2>
                {section.body.map((block, j) => (
                  <Block key={j} block={block} />
                ))}
              </section>
            ))}

            <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-foreground">Questions about your privacy?</p>
                <p className="text-sm text-muted-foreground">We reply to every request within 30 days.</p>
              </div>
              <a
                href={MAILTO}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Mail className="h-4 w-4" aria-hidden />
                {PRIVACY_CONTACT_EMAIL}
              </a>
            </Card>
          </article>
        </div>
      </main>

      <AppFooter />
    </div>
  );
};

export default Privacy;
