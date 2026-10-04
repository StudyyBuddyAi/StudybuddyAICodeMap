import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import BrandMark from "@/components/brand/BrandMark";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <BrandMark size={64} className="mx-auto mb-5" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">404</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a
          href="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-4"
        >
          Return home →
        </a>
      </div>
    </div>
  );
};

export default NotFound;
