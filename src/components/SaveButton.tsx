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
}

const SaveButton = ({ input, output, modeInfo }: SaveButtonProps) => {
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

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs"
      onClick={handleSave}
      disabled={saved}
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
