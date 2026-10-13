import { StandaloneTitleBar } from './WindowControls'

export function WelcomeScreen({ leaving, checking, isArabic }: { leaving: boolean; checking: boolean; isArabic: boolean }) {
  return <main dir={isArabic ? 'rtl' : 'ltr'} aria-label={isArabic ? 'شاشة الترحيب' : 'Welcome screen'}
    className={`welcome-screen fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#06080f] px-6 text-[#dce7ff] ${leaving ? 'welcome-screen-leaving' : ''}`}>
    <StandaloneTitleBar dark />
    <div className="welcome-content flex w-full flex-col items-center">
      <img src="/brand/openzero-logo-animated.svg" alt="" aria-hidden="true" className="mb-5 h-36 w-36 object-contain sm:h-44 sm:w-44" />
      <img src="/brand/openzero-wordmark-transparent.png" alt="Open Zero" className="w-[min(360px,75vw)] object-contain" />
      <h1 dir="ltr" aria-label="welcome master" className="mt-7 text-center font-mono text-[clamp(1.35rem,4vw,1.75rem)] font-medium tracking-[0.035em]">
        <span aria-hidden="true" className="inline-block whitespace-nowrap">{Array.from('welcome master', (letter, index) =>
          <span key={index} className={`welcome-letter inline-block ${index < 8 ? 'text-[#8e9eb8]' : 'text-[#dce7ff]'}`} style={{ animationDelay: `${400 + index * 90}ms` }}>{letter === ' ' ? '\u00a0' : letter}</span>
        )}</span>
      </h1>
      <div className="welcome-loading mt-7 flex w-48 flex-col items-center gap-3.5">
        <div dir="ltr" aria-hidden="true" className="welcome-loading-track h-[3px] w-full overflow-hidden rounded-full bg-[#182338]"><span className="welcome-loading-bar block h-full w-1/3 rounded-full bg-[#77cced]" /></div>
        <p role="status" className="min-h-5 text-center text-[11px] font-medium leading-5 tracking-wide text-[#8192ad]">
          {checking ? (isArabic ? 'جارٍ فحص مفتاح التفعيل…' : 'Checking your activation key…') : (isArabic ? 'جارٍ تجهيز مساحة العمل…' : 'Loading your workspace…')}
        </p>
      </div>
    </div>
  </main>
}
