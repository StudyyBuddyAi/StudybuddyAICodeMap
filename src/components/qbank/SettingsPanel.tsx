import { useId } from "react";
import { Keyboard, Minus, Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/hooks/use-theme";
import { QBANK_TEXT_SCALES, type useQBankPrefs } from "@/hooks/use-qbank-prefs";

type Prefs = ReturnType<typeof useQBankPrefs>;

/**
 * The exam's settings menu: text size up to 200%, light or dark, and the
 * clock. Lives behind the gear in the top bar, and inside Tools on a phone.
 */
const SettingsPanel = ({ prefs, onShortcuts }: { prefs: Prefs; onShortcuts?: () => void }) => {
  const { isDark, setTheme } = useTheme();
  const textId = useId();
  const themeId = useId();
  const timerId = useId();
  const pct = Math.round(QBANK_TEXT_SCALES[prefs.textStep] * 100);

  return (
    <div className="qb-settings">
      <div className="qb-setting" role="group" aria-labelledby={textId}>
        <span className="qb-setting-label" id={textId}>
          Text size
        </span>
        <div className="qb-setting-row">
          <button
            type="button"
            className="qb-btn qb-btn--outline qb-btn--icon"
            onClick={() => prefs.changeText(-1)}
            disabled={prefs.textStep <= 0}
            aria-label="Smaller text"
          >
            <Minus />
          </button>
          <span className="qb-stepper-value" aria-live="polite">
            {pct}%
          </span>
          <button
            type="button"
            className="qb-btn qb-btn--outline qb-btn--icon"
            onClick={() => prefs.changeText(1)}
            disabled={prefs.textStep >= prefs.maxTextStep}
            aria-label="Larger text"
          >
            <Plus />
          </button>
          <button type="button" className="qb-btn" onClick={prefs.resetText} disabled={prefs.textStep === 0}>
            Reset
          </button>
        </div>
      </div>

      <div className="qb-setting">
        <span className="qb-setting-label" id={themeId}>
          Theme
        </span>
        <div className="qb-segment" role="radiogroup" aria-labelledby={themeId}>
          <button type="button" role="radio" aria-checked={!isDark} onClick={() => setTheme("light")}>
            Light
          </button>
          <button type="button" role="radio" aria-checked={isDark} onClick={() => setTheme("dark")}>
            Dark
          </button>
        </div>
      </div>

      <div className="qb-setting">
        <div className="qb-setting-row" style={{ justifyContent: "space-between" }}>
          <label className="qb-setting-label" htmlFor={timerId}>
            Show the clock
          </label>
          <Switch id={timerId} checked={!prefs.timerHidden} onCheckedChange={(on) => prefs.setTimerHidden(!on)} />
        </div>
        <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>Hidden, it still appears in the last five minutes.</span>
      </div>

      {onShortcuts && (
        <button type="button" className="qb-btn qb-btn--outline" onClick={onShortcuts} style={{ justifySelf: "start" }}>
          <Keyboard /> Keyboard shortcuts
        </button>
      )}
    </div>
  );
};

export default SettingsPanel;
