/**
 * Close a `**` the model has opened but not yet closed, so a half-written bold
 * keyword renders bold from its first letter rather than as literal asterisks
 * that turn bold a few frames later.
 */
export function closeOpenBold(text: string): string {
  const count = text.match(/\*\*/g)?.length ?? 0;
  return count % 2 === 1 ? `${text}**` : text;
}
