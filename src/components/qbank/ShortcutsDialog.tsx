import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PlayMode } from "@/lib/qbank-types";

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd
    className="inline-flex min-w-[24px] items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-medium"
    style={{ border: "1px solid var(--border)", background: "var(--bg-subtle)", fontFamily: "var(--font-mono)" }}
  >
    {children}
  </kbd>
);

const ShortcutsDialog = ({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PlayMode;
}) => {
  const rows: [React.ReactNode, string][] = [
    [<><Kbd>A</Kbd>–<Kbd>E</Kbd></>, mode === "timed" ? "Choose an answer" : "Select an answer"],
    ...(mode === "tutor" ? ([[<Kbd key="enter">Enter</Kbd>, "Confirm the selected answer"]] as [React.ReactNode, string][]) : []),
    [<><Kbd>Shift</Kbd> + <Kbd>A</Kbd>–<Kbd>E</Kbd></>, "Strike out / restore an answer"],
    [<><Kbd>←</Kbd> <Kbd>→</Kbd></>, "Previous / next question"],
    [<Kbd key="f">F</Kbd>, "Flag / unflag the question"],
    [<Kbd key="h">H</Kbd>, "Highlight the selected text"],
    [<Kbd key="l">L</Kbd>, "Lab values"],
    [<Kbd key="k">K</Kbd>, "Calculator"],
    [<Kbd key="q">?</Kbd>, "This list"],
    [<Kbd key="esc">Esc</Kbd>, "Close a panel"],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are paused while you type in a search box or the calculator.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {rows.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between gap-4 text-sm">
              <span style={{ color: "var(--fg-muted)" }}>{label}</span>
              <span className="flex shrink-0 items-center gap-1">{keys}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
};

export default ShortcutsDialog;
