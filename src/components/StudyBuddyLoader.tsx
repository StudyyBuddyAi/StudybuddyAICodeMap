import BrandMark from "@/components/brand/BrandMark";

interface StudyBuddyLoaderProps {
  message?: string;
  fullPage?: boolean;
}

const StudyBuddyLoader = ({
  message = "Loading...",
  fullPage = true,
}: StudyBuddyLoaderProps) => {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullPage ? "min-h-[60vh]" : "py-12"
      }`}
    >
      <BrandMark size={64} activity="busy" interactive={false} />

      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-primary/60"
            style={{
              animation: "studybuddy-bounce 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>

      {message && (
        <p className="text-xs font-medium text-muted-foreground tracking-wide">
          {message}
        </p>
      )}

      <style>{`
        @keyframes studybuddy-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default StudyBuddyLoader;
