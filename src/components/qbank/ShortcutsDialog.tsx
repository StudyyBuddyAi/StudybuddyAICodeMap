import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PlayMode } from "@/lib/qbank-types";

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd
    className="inline-flex min-w-[24px] items-center justify-center rounded px-1.5 py-0.5 text-[12px] font-medium"
    style={{ border: "1px solid var(--border-strong)", background: "var(--bg-panel)", fontFamily: "var(--font-sans)" }}
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
    [<><Kbd>A</Kbd>–<Kbd>E</Kbd></>, "Choose an answer"],
    [<><Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>Space</Kbd></>, "Move through the answers, and choose one"],
    [<Kbd key="enter">Enter</Kbd>, mode === "tutor" ? "Submit the answer, then go on to the next" : "Next question"],
    [<><Kbd>Shift</Kbd> + <Kbd>A</Kbd>–<Kbd>E</Kbd></>, "Strike out or restore an answer (or right-click it)"],
    [<><Kbd>←</Kbd> <Kbd>→</Kbd></>, "Previous or next question"],
    [<Kbd key="f">F</Kbd>, "Mark the question for review"],
    [<Kbd key="h">H</Kbd>, "Highlight the selected text"],
    [<Kbd key="n">N</Kbd>, "Notes"],
    [<Kbd key="l">L</Kbd>, "Lab values"],
    [<Kbd key="k">K</Kbd>, "Calculator"],
    [<Kbd key="q">?</Kbd>, "This list"],
    [<Kbd key="esc">Esc</Kbd>, "Close a panel"],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="qb-exam-portal max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts pause while you type in notes, a search box or the calculator.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2.5">
          {rows.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between gap-4 text-[14px]">
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
