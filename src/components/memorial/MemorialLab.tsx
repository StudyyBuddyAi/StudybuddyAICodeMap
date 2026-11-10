import { useState, type ChangeEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ImagePlus, RotateCcw, X } from "lucide-react";
import { MEMORIAL, type MemorialCardId } from "@/content/memorial";
import {
  MEMORIAL_ENTRIES,
  MEMORIAL_VERSIONS,
  memorialLabUnsaved,
  resetMemorialLab,
  setMemorialCard,
  setMemorialLab,
  useMemorialLab,
} from "./memorial-lab";
import "./memorial.css";

/** Shrink a chosen photo to at most 1400px on its long side, so three of them fit in this browser's storage. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Development only: a small panel for trying the memorial out. Switch the
 * page's version, switch each entry point on or off where it lives, and put
 * your own photos and words on the cards. Everything stays in this browser.
 */
const MemorialLab = () => {
  const lab = useMemorialLab();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<MemorialCardId | null>(null);

  const onPhoto = async (id: MemorialCardId, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(id);
    try {
      setMemorialCard(id, { photo: await shrink(file) });
    } finally {
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button type="button" className="mlab-pill" onClick={() => setOpen(true)}>
        Memorial lab
      </button>
    );
  }

  return (
    <aside className="mlab" aria-label="Memorial lab">
      <div className="mlab-head">
        <p className="mlab-title">Memorial lab</p>
        <button type="button" className="mlab-icon" onClick={() => setOpen(false)} aria-label="Close the lab">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mlab-scroll">
        <fieldset className="mlab-group">
          <legend>The page</legend>
          {MEMORIAL_VERSIONS.map((v) => (
            <label key={v.id} className="mlab-option">
              <input
                type="radio"
                name="mlab-version"
                checked={lab.version === v.id}
                onChange={() => setMemorialLab({ version: v.id })}
              />
              <span>
                <b>{v.name}</b>
                <small>{v.note}</small>
              </span>
            </label>
          ))}
          {pathname !== "/in-memory" && (
            <Link to="/in-memory" className="mlab-link">
              Open the memorial page
            </Link>
          )}
        </fieldset>

        <fieldset className="mlab-group">
          <legend>Where people find it</legend>
          {MEMORIAL_ENTRIES.map((en) => (
            <label key={en.id} className="mlab-option">
              <input
                type="checkbox"
                checked={lab.entries[en.id]}
                onChange={(e) => setMemorialLab({ entries: { ...lab.entries, [en.id]: e.target.checked } })}
              />
              <span>
                <b>{en.name}</b>
                <small>{en.where}</small>
              </span>
            </label>
          ))}
          <p className="mlab-links">
            See them on <Link to="/">the landing page</Link> (signed out) or <Link to="/dashboard">the dashboard</Link>.
          </p>
        </fieldset>

        <fieldset className="mlab-group">
          <legend>Photos</legend>
          <label className="mlab-option">
            <input type="checkbox" checked={lab.mono} onChange={(e) => setMemorialLab({ mono: e.target.checked })} />
            <span>
              <b>Black and white</b>
              <small>Show every photo without colour.</small>
            </span>
          </label>
        </fieldset>

        <fieldset className="mlab-group">
          <legend>Your words and photos</legend>
          <label className="mlab-field">
            <span>Dedication</span>
            <textarea
              rows={2}
              placeholder={MEMORIAL.dedication}
              value={lab.dedication ?? ""}
              onChange={(e) => setMemorialLab({ dedication: e.target.value })}
            />
          </label>
          <label className="mlab-field">
            <span>Signed</span>
            <input
              placeholder={MEMORIAL.signature}
              value={lab.signature ?? ""}
              onChange={(e) => setMemorialLab({ signature: e.target.value })}
            />
          </label>

          {MEMORIAL.cards.map((card) => {
            const d = lab.cards[card.id] ?? {};
            return (
              <div key={card.id} className="mlab-card">
                <p className="mlab-card-title">{card.label}</p>
                <div className="mlab-photo-row">
                  {d.photo ? (
                    <img src={d.photo} alt="" className="mlab-thumb" />
                  ) : (
                    <span className="mlab-thumb mlab-thumb--empty" />
                  )}
                  <label className="mlab-button">
                    <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                    {busy === card.id ? "Adding…" : d.photo ? "Change photo" : "Add photo"}
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => onPhoto(card.id, e)} />
                  </label>
                  {d.photo && (
                    <button type="button" className="mlab-text-button" onClick={() => setMemorialCard(card.id, { photo: null })}>
                      Remove
                    </button>
                  )}
                </div>
                <label className="mlab-field">
                  <span>Names</span>
                  <input
                    placeholder={card.names}
                    value={d.names ?? ""}
                    onChange={(e) => setMemorialCard(card.id, { names: e.target.value })}
                  />
                </label>
                <label className="mlab-field">
                  <span>Line under the names</span>
                  <input
                    placeholder={card.line}
                    value={d.line ?? ""}
                    onChange={(e) => setMemorialCard(card.id, { line: e.target.value })}
                  />
                </label>
                <label className="mlab-field">
                  <span>Text (a blank line starts a new paragraph)</span>
                  <textarea
                    rows={4}
                    placeholder={card.text.join("\n\n")}
                    value={d.text ?? ""}
                    onChange={(e) => setMemorialCard(card.id, { text: e.target.value })}
                  />
                </label>
                {card.roll && (
                  <label className="mlab-field">
                    <span>Names, one per line</span>
                    <textarea
                      rows={4}
                      placeholder={card.roll.join("\n")}
                      value={d.roll ?? ""}
                      onChange={(e) => setMemorialCard(card.id, { roll: e.target.value })}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </fieldset>

        {memorialLabUnsaved() && (
          <p className="mlab-warn">These photos are too big to keep after a reload. Try smaller ones.</p>
        )}
        <p className="mlab-fine">Kept in this browser only. Nothing is uploaded.</p>
        <button type="button" className="mlab-text-button" onClick={resetMemorialLab}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset everything
        </button>
      </div>
    </aside>
  );
};

export default MemorialLab;
