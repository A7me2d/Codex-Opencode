/** Join class names, dropping the falsy ones. Keeps conditional Tailwind readable. */
export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}
