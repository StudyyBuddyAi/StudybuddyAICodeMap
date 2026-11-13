/**
 * The memorial at /in-memory: the page's heading and one tribute per person,
 * in this order: father, mother, brother.
 *
 * The tributes are the family's own words, final and reviewed. Edit them here
 * and only here (the page reads this file and adds nothing of its own), and
 * keep them exactly as written: no rephrasing, the en dash in the years, the
 * paragraph breaks as they are.
 *
 * Photos are optional. They live in public/memorial/, cut from the family's
 * collages so the page can lay them out in its own frame. With none, nothing
 * stands in for one.
 */
export type MemorialTributeId = "father" | "mother" | "brother";

export interface MemorialPhoto {
  /** A path under public/. */
  src: string;
  /** The file's width ÷ height. */
  aspect: number;
  /** Who the photo shows, for screen readers: names only. */
  alt: string;
  /** What to keep in frame if a layout trims the photo (CSS object-position). */
  focus?: string;
}

export interface MemorialTribute {
  id: MemorialTributeId;
  /** The tribute's heading. */
  name: string;
  /** e.g. "1953 – 2024", with an en dash. */
  years: string;
  /** The tribute itself, one string per paragraph. */
  paragraphs: string[];
  photos: MemorialPhoto[];
  /**
   * How the photos are laid out. "stack": each whole, one under the other.
   * "mosaic": the first photo tall on the right, the rest down the left, as
   * the family's own collage had them.
   */
  collage?: "stack" | "mosaic";
  /** The photo that stands for the tribute where only one fits. Default 0. */
  cover?: number;
}

export interface MemorialContent {
  /** The page's heading, and the landing page's closing line. */
  heading: string;
  tributes: MemorialTribute[];
}

export const MEMORIAL: MemorialContent = {
  heading: "StudyBuddy AI was made in memory of those who saw education as their message to the world.",
  tributes: [
    {
      id: "father",
      name: "Dr. Ibrahim Mustafa Shihada",
      years: "1953 – 2024",
      paragraphs: [
        "Dr. Ibrahim Mustafa Shihada was born in 1953 in a refugee camp in Khan Younis. He was an outstanding student at every stage of school. In his final year of high school he ranked first across the Gaza Strip and the Sinai Peninsula, and that earned him a scholarship to study medicine at Kasr Al Ainy in Cairo. He graduated with first-class honors.",
        "He returned to Gaza to build his life there and married Ruwaida Muhammad Hussein at 28. Over the following decades he became one of the pioneers of obstetrics and gynecology in Gaza. He led the OB/GYN department at Nasser Medical Complex until he retired, and along the way he trained many of the doctors who now carry on that work. He cared for thousands of women and brought modern prenatal ultrasound to the Strip. In the late 1990s he earned a diploma in ultrasonography and in vitro fertilization in Vienna, and he brought that knowledge home to his patients.",
        "Retiring didn't stop him. He kept seeing patients at his own clinic, and when the war came he still kept going. As his health got worse, the treatment he needed was no longer available in Gaza. He passed away from heart failure in 2024, the day after a long shift at his clinic, where he had treated dozens of patients displaced by the war.",
        "He gave his life to caring for others, right up to the very last day.",
      ],
      photos: [
        { src: "/memorial/father-1.jpg", aspect: 0.7858, alt: "Dr. Ibrahim Mustafa Shihada" },
        { src: "/memorial/father-2.jpg", aspect: 1.7904, alt: "Dr. Ibrahim Mustafa Shihada" },
      ],
      collage: "stack",
    },
    {
      id: "mother",
      name: "Ruwaida Muhammad Hussein",
      years: "1960 – 2018",
      paragraphs: [
        "Ruwaida Muhammad Hussein was born in 1960 in Al-Bureij refugee camp in central Gaza. She studied mathematics at Birzeit University in the West Bank and came back to Gaza to teach.",
        "She started as a teacher in UNRWA schools and later became a school principal. Over her career she helped educate several generations of Palestinian children, and she became one of the most respected figures in education in Khan Younis.",
        "Alongside all of that, she raised a family of eight. She was a loving mother, and later a devoted grandmother.",
        "She passed away suddenly in 2018. Generations of her students still remember her with gratitude, and so do the children and grandchildren she raised with so much love.",
      ],
      photos: [
        {
          src: "/memorial/mother-1.jpg",
          aspect: 1.4458,
          alt: "Ruwaida Muhammad Hussein and Dr. Ibrahim Mustafa Shihada",
          focus: "30% 45%",
        },
      ],
      collage: "stack",
    },
    {
      id: "brother",
      name: "Dr. Mustafa Ibrahim Shihada",
      years: "1987 – 2025",
      paragraphs: [
        "Dr. Mustafa Ibrahim Shihada was born in 1987 in Khan Younis. Like his father, he was an excellent student, and like his father, he went on to study medicine at Kasr Al Ainy in Cairo.",
        "He came back to Gaza and trained in obstetrics and gynecology at Nasser Medical Complex, the same department his father had led, and he rose to become a senior attending physician. He cared for many patients over his career and helped train the junior doctors who came after him. He also taught medical students: he gave lectures, led them on clinical rounds, and helped with their assessments.",
        "When the war came, he kept working. He lost his father, he lost his home, and his family was evacuated to Egypt, leaving him alone in Gaza. He carried all of that and still kept treating patients through bombardment, exhaustion and impossible conditions. He performed many operations that saved the lives of people wounded in the war.",
        "In 2025 he passed away from a sudden cardiac arrest while on duty at the International Medical Corps field hospital in central Gaza. In the months before, he had been carrying the grief of losing his father and his home and the separation from his family, all while working under extreme strain, through famine and with too little food and water.",
        "He was a loving father of four, a devoted husband, and a caring big brother. He gave everything he had to his patients and his family.",
      ],
      photos: [
        { src: "/memorial/brother-1.jpg", aspect: 0.5962, alt: "Dr. Mustafa Ibrahim Shihada", focus: "50% 40%" },
        { src: "/memorial/brother-2.jpg", aspect: 1.2116, alt: "Dr. Mustafa Ibrahim Shihada", focus: "55% 40%" },
        { src: "/memorial/brother-3.jpg", aspect: 1.0829, alt: "Dr. Mustafa Ibrahim Shihada", focus: "70% 35%" },
        { src: "/memorial/brother-4.jpg", aspect: 1.1706, alt: "Dr. Mustafa Ibrahim Shihada", focus: "35% 40%" },
      ],
      collage: "mosaic",
      cover: 3,
    },
  ],
};

export const hasPlaceholder = (s: string) => /\[[^\]]+\]/.test(s);

/** True once no [placeholder] is left anywhere. Photos are optional. */
export function memorialComplete(content: MemorialContent): boolean {
  const words = [content.heading, ...content.tributes.flatMap((t) => [t.name, t.years, ...t.paragraphs])];
  return !words.some(hasPlaceholder);
}
