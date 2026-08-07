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
    focus: string;
    length: string;
  };
  /** Blocks saving while the sheet is still streaming and would persist partial. */
  disabled?: boolean;
}

const SaveButton = ({ input, output, modeInfo, disabled = false }: SaveButtonProps) => {
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();
  const { saveItem } = useStudyHistory();

  const handleSave = async () => {
    try {
      await saveItem(input, output, modeInfo);
      setSaved(true);
      toast({ title: "Saved to Study History" });
    } catch (e: any) {
      toast({
        title: "Failed to save",
        description: e?.message ?? "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs"
      onClick={handleSave}
      disabled={saved || disabled}
    >
      {saved ? (
        <>
          <BookmarkCheck className="h-3.5 w-3.5" />
          Saved
        </>
      ) : (
        <>
          <Bookmark className="h-3.5 w-3.5" />
          Save
        </>
      )}
    </Button>
  );
};

export default SaveButton;
