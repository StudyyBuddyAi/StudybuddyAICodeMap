import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import { MEMORIAL } from "@/content/memorial";
import MemorialPrints from "@/components/memorial/MemorialPrints";
import "@/components/memorial/memorial.css";

/**
 * In memory of the founder's family and classmates, lost in the war. Public,
 * signed in or not, and still: a plain ground over the living backdrop, no
 * prompts and nothing to sell. The words and photos are in
 * src/content/memorial.ts.
 */
const InMemory = () => {
  useEffect(() => {
    const before = document.title;
    document.title = "In memory · StudyBuddy AI";
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <div className="mem-page">
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
        <MemorialPrints content={MEMORIAL} />
      </main>
    </div>
  );
};

export default InMemory;
