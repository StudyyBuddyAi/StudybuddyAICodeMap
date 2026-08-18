/**
 * Flashcard tag chips.
 *
 * The previous values were tuned for dark mode only — `-400` text on a 10%
 * alpha fill landed at ~2:1 against the light cream paper. Each tag now carries
 * an explicit dark variant: a deeper text shade in light mode, a lighter one in
 * dark, over a fill that is opaque enough to hold either.
 */
export const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Diagnosis': {
    bg: 'bg-amber-500/15 dark:bg-amber-400/10',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-600/30 dark:border-amber-400/30',
  },
  'Mechanism': {
    bg: 'bg-purple-500/15 dark:bg-purple-400/10',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-600/30 dark:border-purple-400/30',
  },
  'Next Step': {
    bg: 'bg-teal-500/15 dark:bg-teal-400/10',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-600/30 dark:border-teal-400/30',
  },
  'Complication': {
    bg: 'bg-rose-500/15 dark:bg-rose-400/10',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-600/30 dark:border-rose-400/30',
  },
  'Association': {
    bg: 'bg-sky-500/15 dark:bg-sky-400/10',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-600/30 dark:border-sky-400/30',
  },
};

export const getTagColors = (tag: string) =>
  TAG_COLORS[tag] || { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
