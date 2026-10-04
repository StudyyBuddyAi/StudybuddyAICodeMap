import { Card, CardContent } from "@/components/ui/card";
import BrandMark from "@/components/brand/BrandMark";

const WelcomeCard = () => (
  <Card className="glass-card animate-fade-in border-primary/20">
    <CardContent className="p-7 space-y-3">
      <div className="flex items-center gap-2.5">
        <BrandMark size={40} />
        <h2 className="text-xl font-extrabold tracking-tight text-foreground md:text-2xl">
          Welcome to StudyBuddy 👋
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Generate flashcards on any medical topic — type something below and
        StudyBuddy builds you a deck in seconds. Your stats and decks unlock as
        you study.
      </p>
    </CardContent>
  </Card>
);

export default WelcomeCard;
