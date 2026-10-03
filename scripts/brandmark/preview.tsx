// A standalone dev page (scripts/brandmark/preview.html), never hot-reloaded as a module.
/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import BrandMark from "@/components/brand/BrandMark";
import { pulseBrandMark, type MarkActivity } from "@/components/brand/brandmark-motion";
import "@/index.css";

const SIZES = [16, 24, 32, 40, 64, 96, 160];

function Row({ dark, activity }: { dark: boolean; activity: MarkActivity }) {
  return (
    <div className={dark ? "dark" : ""}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 28,
          padding: "28px 32px",
          background: dark ? "#0e1116" : "#f7f4ec",
          color: dark ? "#e8e4da" : "#0e1116",
        }}
      >
        {SIZES.map((s) => (
          <div key={s} style={{ display: "grid", justifyItems: "center", gap: 8 }}>
            <BrandMark size={s} activity={activity} />
            <span style={{ font: "11px ui-monospace, monospace", opacity: 0.55 }}>{s}px</span>
          </div>
        ))}
        <a href="#" onClick={(e) => e.preventDefault()} style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", color: "inherit", textDecoration: "none" }}>
          <BrandMark size={34} activity={activity} />
          <span style={{ font: "500 22px Georgia, serif", letterSpacing: "-0.02em" }}>
            StudyBuddy<i style={{ color: dark ? "#6fb5b5" : "#0d6e6e" }}> AI</i>
          </span>
        </a>
      </div>
    </div>
  );
}

function Preview() {
  const [activity, setActivity] = useState<MarkActivity>("idle");
  return (
    <div style={{ minHeight: "100vh", background: "#ddd", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 8, padding: 16, alignItems: "center" }}>
        <strong style={{ marginRight: 8 }}>Brand mark</strong>
        {(["idle", "busy", "still"] as const).map((a) => (
          <button key={a} onClick={() => setActivity(a)} style={{ fontWeight: a === activity ? 700 : 400 }}>
            {a}
          </button>
        ))}
        <button onClick={() => pulseBrandMark("full")}>pulse (full)</button>
        <button onClick={() => pulseBrandMark("twitch")}>pulse (twitch)</button>
        <span style={{ opacity: 0.6, fontSize: 13 }}>hover any mark to fire it</span>
      </div>
      <Row dark={false} activity={activity} />
      <Row dark activity={activity} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
