import { useEffect, type ComponentType } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import type { MemorialContent } from "@/content/memorial";
import {
  getMemorialLab,
  isMemorialVersion,
  setMemorialLab,
  useMemorialContent,
  useMemorialLab,
  type MemorialVersion,
} from "@/components/memorial/memorial-lab";
import DedicationVersion from "@/components/memorial/versions/DedicationVersion";
import PrintsVersion from "@/components/memorial/versions/PrintsVersion";
import IndexCardsVersion from "@/components/memorial/versions/IndexCardsVersion";
import AlbumVersion from "@/components/memorial/versions/AlbumVersion";
import "@/components/memorial/memorial.css";

const VERSIONS: Record<MemorialVersion, ComponentType<{ content: MemorialContent }>> = {
  dedication: DedicationVersion,
  prints: PrintsVersion,
  cards: IndexCardsVersion,
  album: AlbumVersion,
};

/**
 * In memory of the founder's family and classmates. Public, signed in or
 * not, and still: a plain ground with no moving backdrop, no prompts and
 * nothing to sell. `?v=prints` (or dedication, cards, album) opens a version.
 */
const InMemory = () => {
  const lab = useMemorialLab();
  const content = useMemorialContent();
  const [params] = useSearchParams();

  useEffect(() => {
    const v = params.get("v");
    if (isMemorialVersion(v) && v !== getMemorialLab().version) setMemorialLab({ version: v });
  }, [params]);

  useEffect(() => {
    const before = document.title;
    document.title = "In memory · StudyBuddy AI";
    return () => {
      document.title = before;
    };
  }, []);

  const Version = VERSIONS[lab.version];

  return (
    <div className={`mem-page${lab.mono ? " mem-mono" : ""}`} data-version={lab.version}>
      <header className="mem-bar">
        <Link to="/" aria-label="StudyBuddy AI home" className="mem-brand">
          <BrandMark size={28} />
          <span>StudyBuddy AI</span>
        </Link>
        <Link to="/" className="mem-back">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to StudyBuddy
        </Link>
      </header>
      <main className="mem-main">
        <Version key={lab.version} content={content} />
      </main>
    </div>
  );
};

export default InMemory;
