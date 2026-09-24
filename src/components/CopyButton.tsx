import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  text: string;
  /** Icon only, for a header that shouldn't carry a word per section. */
  compact?: boolean;
}

const CopyButton = ({ text, compact = false }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (compact) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy section"}
        title={copied ? "Copied" : "Copy section"}
        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-8 px-2.5 text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <><Check className="h-3.5 w-3.5 mr-1" /> Copied</>
      ) : (
        <><Copy className="h-3.5 w-3.5 mr-1" /> Copy</>
      )}
    </Button>
  );
};

export default CopyButton;
