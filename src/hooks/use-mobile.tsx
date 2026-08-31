import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * True in the tablet band (768–1023px), where the split-pane pages collapse the
 * configurator into a slide-out drawer.
 *
 * The drawers used to be gated purely by `hidden md:max-lg:block`. That works
 * for painting, but a Radix Sheet portals to <body> and cannot inherit an
 * ancestor's responsive `display`, so the band has to be known in JS to close
 * the drawer when the viewport leaves it.
 */
export function useIsTabletBand() {
  const [inBand, setInBand] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const onChange = () => setInBand(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return inBand;
}
