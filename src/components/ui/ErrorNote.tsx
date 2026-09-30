import { TriangleAlert } from 'lucide-react'

/** One inline, readable error. Used instead of a raw thrown message. */
export function ErrorNote({ children }: { children: string }) {
  return <div className="mt-2 flex items-start gap-2 rounded-lg bg-review-tint px-3 py-2 text-xs leading-5 text-review-ink">
    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    {children}
  </div>
}
