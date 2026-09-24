import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useStudyHistory } from "@/hooks/use-study-history";
import { useToast } from "@/hooks/use-toast";

interface SaveButtonProps {
  input: string;
  output: string;
  modeInfo?: {
    examMode: string;
    difficulty: string;
    length: string;
  };
  /** Blocks saving while the sheet is still streaming and would persist partial. */
  disabled?: boolean;
  /** Replaces the button's own styling, for a toolbar that sets its own. */
  className?: string;
  /** Applied to the label, e.g. to hide it on a narrow screen. */
  labelClassName?: string;
}

const SaveButton = ({
  input,
  output,
  modeInfo,
  disabled = false,
  className,
  labelClassName,
}: SaveButtonProps) => {
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();
  const { saveItem } = useStudyHistory();

  const handleSave = async () => {
    try {
      await saveItem(input, output, modeInfo);
      setSaved(true);
      toast({ title: "Saved to Study History" });
    } catch (e: unknown) {
      toast({
        title: "Failed to save",
        description: e instanceof Error && e.message ? e.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const content = saved ? (
    <>
      <BookmarkCheck className="h-3.5 w-3.5" />
      <span className={labelClassName}>Saved</span>
    </>
  ) : (
    <>
      <Bookmark className="h-3.5 w-3.5" />
      <span className={labelClassName}>Save</span>
    </>
  );

  if (className) {
    return (
      <button
        type="button"
        className={className}
        onClick={handleSave}
        disabled={saved || disabled}
        aria-label={saved ? "Saved" : "Save"}
      >
        {content}
      </button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs"
      onClick={handleSave}
      disabled={saved || disabled}
    >
      {content}
    </Button>
  );
};

export default SaveButton;
