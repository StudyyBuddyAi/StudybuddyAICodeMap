import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { isAppPath, useActiveBackdropScene, variantForPath, type BackdropScene } from "./backdrop-scene";

const MolecularBackdrop = lazy(() => import("./MolecularBackdrop"));

const AMBIENT: BackdropScene = { mode: "ambient" };

/**
 * A still paper grain, made once per session: a 128px tile of soft noise,
 * tiled over the page at a few percent. It is what keeps a flat colour from
 * reading as a screen, and it never moves — moving grain is a distraction
 * while reading.
 */
let grainUrl: string | null = null;
function paperGrain(): string | null {
  if (grainUrl !== null) return grainUrl;
  try {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return (grainUrl = "");
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    grainUrl = c.toDataURL("image/png");
  } catch {
    grainUrl = "";
  }
  return grainUrl;
}

/**
 * The page behind every app screen: the page colour and paper grain at once,
 * and the living field and molecule when their chunk arrives. Shown while some
 * page asks for a scene (the app layout always does), so the landing and auth
 * pages keep their own backgrounds. The route picks the page's own structure
 * and colour; moving between pages morphs one into the next.
 *
 * Fixed to the viewport, below everything in the root stacking context, and
 * invisible to input, screen readers and print. It paints the page colour
 * itself, which is why the app layout's own background is transparent.
 */
export default function AppBackdrop() {
  const scene = useActiveBackdropScene();
  const { pathname } = useLocation();
  const inApp = isAppPath(pathname);
  const grain = useMemo(paperGrain, []);

  // Between two app pages the next page's chunk may still be loading, and for
  // that moment no page asks for a scene: hold the calm default rather than
  // dropping the backdrop and starting it over.
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (scene) setHolding(true);
    else if (!inApp) setHolding(false);
  }, [scene, inApp]);

  const shown = scene ?? (inApp && holding ? AMBIENT : null);
  if (!shown) return null;
  return (
    <div
      aria-hidden="true"
      data-no-print
      className="sb-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <Suspense fallback={null}>
        <MolecularBackdrop {...shown} variant={variantForPath(pathname)} />
      </Suspense>
      {grain ? <div className="sb-grain absolute inset-0" style={{ backgroundImage: `url(${grain})` }} /> : null}
    </div>
  );
}
