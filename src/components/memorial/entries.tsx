import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MEMORIAL } from "@/content/memorial";
import { MemText, RibbonMark, TributePrint } from "./parts";
import { MEMORIAL_LIVE } from "./memorial-live";
import "./memorial.css";

/*
 * The three ways to the memorial. Each renders nothing until it goes live
 * (memorial-live.ts).
 */

const LINE = "In memory of my family";

/**
 * The footer line, on every page. Like a Stolperstein, the small brass plate
 * set into a pavement, it is always there for whoever looks down, and never
 * in the way of anyone who doesn't.
 */
export const MemorialPlaque = ({ className = "" }: { className?: string }) => {
  if (!MEMORIAL_LIVE) return null;
  return (
    <Link to="/in-memory" className={`mem-plaque ${className}`}>
      <RibbonMark size={13} className="mem-plaque-mark" />
      <span>{LINE}</span>
    </Link>
  );
};

/**
 * A small black ribbon beside the logo, the way many sites wear one on a day
 * of mourning. Seen on every page; it names itself on hover or focus and
 * opens the memorial. Its own tooltip provider, so it works in any bar.
 */
export const MemorialRibbonLink = ({ className = "" }: { className?: string }) => {
  if (!MEMORIAL_LIVE) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to="/in-memory" className={`mem-ribbon ${className}`} aria-label={LINE}>
            <RibbonMark size={17} />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">{LINE}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * The landing page ends the way a book begins: with the memorial's heading,
 * and the photos once there are any.
 */
export const MemorialClosing = () => {
  if (!MEMORIAL_LIVE) return null;
  const withPhotos = MEMORIAL.tributes.filter((t) => t.photo);
  return (
    <section className="mem-closing" aria-label="Memorial">
      <div className="mem-closing-inner">
        {withPhotos.length > 0 && (
          <ul className="mem-closing-prints" aria-hidden="true">
            {withPhotos.map((t) => (
              <li key={t.id}>
                <TributePrint tribute={t} />
              </li>
            ))}
          </ul>
        )}
        <p className="mem-closing-line">
          <MemText>{MEMORIAL.heading}</MemText>
        </p>
        <Link to="/in-memory" className="mem-closing-link">
          Visit the memorial <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
};
