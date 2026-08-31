import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronDown } from "lucide-react";

type ResponsiveCarouselProps = {
  children: React.ReactNode;
  className?: string;
  desktopClassName?: string;
  mobileItemClassName?: string;
  loop?: boolean;
  slidesToScroll?: number;
};

export function ResponsiveCarousel({
  children,
  className,
  desktopClassName,
  mobileItemClassName,
  loop = true,
  slidesToScroll = 1,
}: ResponsiveCarouselProps) {
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== "undefined" ? window.innerWidth <= 700 : false));
  const [carouselRef, emblaApi] = useEmblaCarousel({
    loop,
    align: "start",
    slidesToScroll,
  });
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);

  React.useEffect(() => {
    const updateIsMobile = () => setIsMobile(window.innerWidth <= 700);
    updateIsMobile();

    window.addEventListener("resize", updateIsMobile);
    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

  const onSelect = React.useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  React.useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);

    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  const items = React.Children.toArray(children).filter(Boolean);

  if (!isMobile) {
    return <div className={desktopClassName ?? ""}>{children}</div>;
  }

  return (
    <div className={`responsive-carousel ${className ?? ""}`}>
      <div className="responsive-carousel__viewport" ref={carouselRef}>
        <div className="responsive-carousel__container">
          {items.map((item, index) => (
            <div
              key={typeof item === "object" && item !== null && "key" in item ? String(item.key ?? index) : index}
              className={`responsive-carousel__slide ${mobileItemClassName ?? ""}`.trim()}
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="responsive-carousel__nav responsive-carousel__nav--prev"
        onClick={() => emblaApi?.scrollPrev()}
        disabled={!canScrollPrev}
        aria-label="Previous items"
      >
        <ChevronDown size={20} style={{ transform: "rotate(-90deg)" }} />
      </button>

      <button
        type="button"
        className="responsive-carousel__nav responsive-carousel__nav--next"
        onClick={() => emblaApi?.scrollNext()}
        disabled={!canScrollNext}
        aria-label="Next items"
      >
        <ChevronDown size={20} style={{ transform: "rotate(90deg)" }} />
      </button>
    </div>
  );
}
