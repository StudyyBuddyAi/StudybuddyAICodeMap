import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MemText, MemorialPhoto, RibbonMark } from "./parts";
import { useMemorialContent, useMemorialEntry } from "./memorial-lab";
import "./memorial.css";

const LINE = "In memory of my family and classmates";

/**
 * 1, the plaque: one line in the footer of every page. Like a Stolperstein,
 * the small brass plate set into a pavement, it is always there for whoever
 * looks down, and never in the way of anyone who doesn't.
 */
export const MemorialPlaque = ({ className = "" }: { className?: string }) => {
  const on = useMemorialEntry("plaque");
  if (!on) return null;
  return (
    <Link to="/in-memory" className={`mem-plaque ${className}`}>
      <RibbonMark size={13} className="mem-plaque-mark" />
      <span>{LINE}</span>
    </Link>
  );
};

/**
 * 2, the ribbon: a small black ribbon beside the logo, the way many sites
 * wear one on a day of mourning. Seen on every page; it names itself on hover
 * or focus and opens the memorial.
 */
export const MemorialRibbonLink = ({ className = "" }: { className?: string }) => {
  const on = useMemorialEntry("ribbon");
  if (!on) return null;
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <Link to="/in-memory" className={`mem-ribbon ${className}`} aria-label={LINE}>
          <RibbonMark size={17} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{LINE}</TooltipContent>
    </Tooltip>
  );
};

/**
 * 3, the closing dedication: the landing page ends the way a book begins,
 * with one line to the people it is for, and their three photos.
 */
export const MemorialClosing = () => {
  const on = useMemorialEntry("closing");
  const content = useMemorialContent();
  if (!on) return null;
  return (
    <section className="mem-closing" aria-label="In memory">
      <div className="mem-closing-inner">
        <ul className="mem-closing-prints" aria-hidden="true">
          {content.cards.map((card) => (
            <li key={card.id}>
              <MemorialPhoto card={card} className="mem-closing-photo" />
            </li>
          ))}
        </ul>
        <p className="mem-closing-line">
          <MemText>{content.dedication}</MemText>
        </p>
        <Link to="/in-memory" className="mem-closing-link">
          Visit the memorial <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
};
