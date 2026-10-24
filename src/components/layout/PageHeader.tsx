import type { ReactNode } from "react";

/**
 * The one header every app page opens with: a short label, a short title and,
 * at most, one line under it. Same type, same spacing on every page, so moving
 * between tools never changes how a page starts.
 */
const PageHeader = ({
  label,
  title,
  description,
  aside,
}: {
  label: string;
  title: ReactNode;
  description?: ReactNode;
  /** A small action under the title, e.g. "How it works". */
  aside?: ReactNode;
}) => (
  <header>
    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-accent-ink)]">
      {label}
    </p>
    <h1 className="mt-2 text-[clamp(28px,4vw,38px)] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground">
      {title}
    </h1>
    {description && <div className="mt-2 max-w-2xl text-base text-muted-foreground">{description}</div>}
    {aside && <div className="mt-3">{aside}</div>}
  </header>
);

export default PageHeader;
