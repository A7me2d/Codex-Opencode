import { tr } from '../../lib/i18n'
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown instead of the crashed subtree. */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Keeps one failing pane from taking the whole desk down.
 *
 * The operator loses that pane, not the session list, the composer state, or
 * the other agent's stream — which is the whole point of a three-column desk.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[relay-room] render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <div className="flex flex-1 items-center justify-center p-6 text-center" role="alert">
      <div className="max-w-sm">
        <h2 className="text-sm font-bold text-ink">{tr("حصلت مشكلة في هذا الجزء")}</h2>
        <p className="mt-2 text-xs leading-6 text-ink-soft">{this.props.label ?? tr("الحالة مش معروضة صح دلوقتي.")}</p>
        <p dir="ltr" className="ltr mt-3 truncate text-[10px] text-ink-soft" title={this.state.error.message}>{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })} className="mt-4 rounded-lg border border-line bg-card px-3 py-2 text-xs font-bold text-ink transition-colors hover:border-relay/40 hover:text-relay-ink">
          {tr("حاول تاني")}</button>
      </div>
    </div>
  }
}
