import { Link } from "react-router-dom";

const SOCIALS = [
  { href: "https://www.instagram.com/getstudybuddyai/", label: "Instagram" },
  { href: "https://www.linkedin.com/company/studdybuddyai", label: "LinkedIn" },
  { href: "https://t.me/studybuddyai", label: "Telegram" },
];

/** Closes every app page: who we are on one side, where to go next on the other. */
const AppFooter = () => (
  <footer className="border-t border-border">
    <div className="mx-auto flex max-w-[var(--max-w,1280px)] flex-col gap-3 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>
        <span className="font-semibold text-foreground">StudyBuddy AI</span> — medical education and active recall
        · © {new Date().getFullYear()}
      </p>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
        <Link to="/roadmap" className="hover:text-foreground">
          Roadmap
        </Link>
        <Link to="/library" className="hover:text-foreground">
          Library
        </Link>
        {SOCIALS.map((s) => (
          <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            {s.label}
          </a>
        ))}
      </nav>
    </div>
  </footer>
);

export default AppFooter;
