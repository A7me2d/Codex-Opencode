import { LoaderCircle, PenLine } from 'lucide-react'
import { StandaloneTitleBar } from './WindowControls'

export function WelcomeScreen({ leaving, checking, isArabic }: { leaving: boolean; checking: boolean; isArabic: boolean }) {
  return <main dir={isArabic ? 'rtl' : 'ltr'} aria-label={isArabic ? 'شاشة الترحيب' : 'Welcome screen'}
    className={`welcome-screen fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#06080f] px-6 text-[#dce7ff] ${leaving ? 'welcome-screen-leaving' : ''}`}>
    <StandaloneTitleBar dark />
    <div className="welcome-content flex w-full flex-col items-center">
      <img src="/brand/openzero-logo-animated.svg" alt="" aria-hidden="true" className="mb-5 h-36 w-36 object-contain sm:h-44 sm:w-44" />
      <img src="/brand/openzero-wordmark-transparent.png" alt="Open Zero" className="w-[min(360px,75vw)] object-contain" />
      <h1 dir="ltr" aria-label="welcome master" className="relative mt-6 text-center">
        <span aria-hidden="true" className="welcome-handwriting inline-block whitespace-nowrap text-[clamp(1.75rem,5vw,2.5rem)] text-[#cbdcf4]">welcome master</span>
        <span aria-hidden="true" className="welcome-pen pointer-events-none absolute inset-x-0 top-1/2 text-[#61cfff]"><PenLine className="absolute -right-5 -top-2 h-5 w-5" /></span>
      </h1>
      <div className="welcome-loading mt-5 flex flex-col items-center gap-3">
        <p role="status" className="flex items-center gap-2 text-xs text-[#a9b9d8]">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {checking ? (isArabic ? 'جارٍ فحص مفتاح التفعيل…' : 'Checking your activation key…') : (isArabic ? 'جارٍ تجهيز مساحة العمل…' : 'Loading your workspace…')}
        </p>
        <div aria-hidden="true" className="h-0.5 w-36 overflow-hidden rounded-full bg-[#253149]"><span className="welcome-loading-bar block h-full w-1/3 rounded-full bg-[#61cfff]" /></div>
      </div>
    </div>
  </main>
}
