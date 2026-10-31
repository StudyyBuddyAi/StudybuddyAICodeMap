import { useEffect } from "react";
import BrandMark from "@/components/brand/BrandMark";
import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_INTRO,
  PRIVACY_SECTIONS,
  type PrivacyBlock,
} from "@/content/privacy";

const Block = ({ block }: { block: PrivacyBlock }) =>
  typeof block === "string" ? (
    <p className="text-[15px] leading-7 text-muted-foreground">{block}</p>
  ) : (
    <ul className="list-disc space-y-2 ps-5 text-[15px] leading-7 text-muted-foreground">
      {block.list.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );

/**
 * The privacy policy: public, signed in or not, and linked from the apps'
 * Settings. The text lives in src/content/privacy.ts.
 */
const Privacy = () => {
  // The page loads lazily, after the browser looked for #delete-account:
  // scroll to a linked section once it exists.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <main className="min-h-screen bg-background px-4 py-12 sm:py-16">
      <article className="mx-auto max-w-[720px] space-y-10">
        <header className="space-y-4">
          <a href="/" aria-label="StudyBuddy AI home" className="inline-block">
            <BrandMark size={40} />
          </a>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Privacy policy
          </h1>
          <p className="text-sm text-muted-foreground">
            Effective date: {PRIVACY_EFFECTIVE_DATE}
          </p>
          {PRIVACY_INTRO.map((p) => (
            <p key={p} className="text-[15px] leading-7 text-foreground">
              {p}
            </p>
          ))}
        </header>
        {PRIVACY_SECTIONS.map((section) => (
          <section
            key={section.heading}
            id={section.id}
            className="scroll-mt-6 space-y-3"
          >
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {section.heading}
            </h2>
            {section.body.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </section>
        ))}
      </article>
    </main>
  );
};

export default Privacy;
