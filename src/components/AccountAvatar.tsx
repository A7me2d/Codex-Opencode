import { UserRound } from 'lucide-react'
import { accountIdentity } from '../lib/accountIdentity'

export function AccountAvatar({ identity }: { identity?: string }) {
  const { initials } = accountIdentity(identity)
  return <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-relay-tint text-[10px] font-extrabold text-relay-ink ring-1 ring-inset ring-relay/15">
    {initials || <UserRound className="h-4 w-4" />}
  </span>
}
