import { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  className?: string
}

export const TikTokIcon = ({ className = 'w-6 h-6', ...props }: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43V7.93a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.36z' />
  </svg>
)

export const PortfolioIcon = ({
  className = 'w-4 h-4',
  ...props
}: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    strokeWidth={1.7}
    strokeLinecap='round'
    strokeLinejoin='round'
    viewBox='0 0 24 24'
    {...props}
  >
    {/* second work peeking behind — a collection */}
    <path d='M8.5 4.5h9A2 2 0 0 1 19.5 6.5v9' />
    {/* framed showcase piece */}
    <rect x='3' y='7' width='13' height='13' rx='2.6' />
    {/* spotlight */}
    <circle cx='7' cy='11' r='1.25' fill='currentColor' stroke='none' />
    {/* the work itself */}
    <path d='M3.8 17.4l3.1-3.1a1.5 1.5 0 0 1 2.12 0L14 19' />
  </svg>
)

// Our own apps, wherever they are listed. Deliberately a device rather than
// the Play triangle: Rafiq and Masareef are on the App Store as well, so a
// Play mark beside "App Store . Google Play" is an icon arguing with its own
// label. This replaced GooglePlayIcon, which had no call sites left.
export const AppsIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    viewBox='0 0 24 24'
    {...props}
  >
    <rect x='7' y='2' width='10' height='20' rx='2' />
    <path d='M11 18h2' />
  </svg>
)
export const GitHubIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z' />
  </svg>
)

export const SpinnerIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg
    className={`animate-spin ${className}`}
    xmlns='http://www.w3.org/2000/svg'
    fill='none'
    viewBox='0 0 24 24'
    {...props}
  >
    <circle
      className='opacity-25'
      cx='12'
      cy='12'
      r='10'
      stroke='currentColor'
      strokeWidth='4'
    />
    <path
      className='opacity-75'
      fill='currentColor'
      d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
    />
  </svg>
)

export const DownloadIcon = ({
  className = 'w-5 h-5',
  ...props
}: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    viewBox='0 0 24 24'
    {...props}
  >
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
      d='M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
    />
  </svg>
)

export const MusicIcon = ({ className = 'w-5 h-5', ...props }: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    viewBox='0 0 24 24'
    {...props}
  >
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
      d='M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
    />
  </svg>
)

export const CheckIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 20 20' {...props}>
    <path
      fillRule='evenodd'
      d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z'
      clipRule='evenodd'
    />
  </svg>
)

export const CloseIcon = ({ className = 'w-5 h-5', ...props }: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    viewBox='0 0 24 24'
    {...props}
  >
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
      d='M6 6l12 12M18 6L6 18'
    />
  </svg>
)

export const TwitterXIcon = ({
  className = 'w-4 h-4',
  ...props
}: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631Zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
  </svg>
)

// Full-color brand badges — self-contained (own background + white glyph), so
// they render identically anywhere regardless of surrounding text color. The
// `instagram-gradient` id is shared across instances; the defs are identical,
// so duplicate ids resolve to the same gradient with no visual difference.
export const InstagramIcon = ({
  className = 'w-4 h-4',
  ...props
}: IconProps) => (
  <svg className={className} viewBox='0 0 24 24' fill='none' {...props}>
    <defs>
      <linearGradient
        id='instagram-gradient'
        x1='2'
        y1='22'
        x2='22'
        y2='2'
        gradientUnits='userSpaceOnUse'
      >
        <stop stopColor='#FEDA75' />
        <stop offset='0.25' stopColor='#FA7E1E' />
        <stop offset='0.5' stopColor='#D62976' />
        <stop offset='0.75' stopColor='#962FBF' />
        <stop offset='1' stopColor='#4F5BD5' />
      </linearGradient>
    </defs>
    <rect width='24' height='24' rx='6' fill='url(#instagram-gradient)' />
    <rect
      x='5.4'
      y='5.4'
      width='13.2'
      height='13.2'
      rx='4'
      fill='none'
      stroke='#fff'
      strokeWidth='1.7'
    />
    <circle
      cx='12'
      cy='12'
      r='3.3'
      fill='none'
      stroke='#fff'
      strokeWidth='1.7'
    />
    <circle cx='16.7' cy='7.3' r='1.15' fill='#fff' />
  </svg>
)

export const FacebookIcon = ({
  className = 'w-4 h-4',
  ...props
}: IconProps) => (
  <svg className={className} viewBox='0 0 24 24' fill='none' {...props}>
    <rect width='24' height='24' rx='6' fill='#1877F2' />
    <path
      d='M16.4 12.06h-2.62V20h-3.1v-7.94H8.86V9.4h1.82V7.85c0-2.15 1.28-3.35 3.24-3.35.94 0 1.93.17 1.93.17v2.12h-1.08c-1.06 0-1.4.66-1.4 1.34V9.4h2.37l-.38 2.66z'
      fill='#fff'
    />
  </svg>
)

export const YouTubeIcon = ({
  className = 'w-4 h-4',
  ...props
}: IconProps) => (
  <svg className={className} viewBox='0 0 24 24' fill='none' {...props}>
    <rect width='24' height='24' rx='6' fill='#FF0000' />
    <path d='M9.8 8.2 16 12l-6.2 3.8z' fill='#fff' />
  </svg>
)

export const ExternalLinkIcon = ({
  className = 'w-4 h-4',
  ...props
}: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    viewBox='0 0 24 24'
    {...props}
  >
    <path d='M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
  </svg>
)

export const ClipboardIcon = ({
  className = 'w-5 h-5',
  ...props
}: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    viewBox='0 0 24 24'
    {...props}
  >
    <rect x='8' y='2' width='8' height='4' rx='1' />
    <path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' />
  </svg>
)

export const ClockIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    viewBox='0 0 24 24'
    {...props}
  >
    <circle cx='12' cy='12' r='9' />
    <path d='M12 7v5l3 2' />
  </svg>
)

export const TrashIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg
    className={className}
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    viewBox='0 0 24 24'
    {...props}
  >
    <path d='M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3' />
  </svg>
)

// Brand glyphs for the newer platforms — monochrome (currentColor), rendered
// white on a brand-colour tile (see platformIcons / platformLinkTiles), the
// same treatment as TikTok/X. Paths are the canonical simple-icons marks.
export const PinterestIcon = ({
  className = 'w-4 h-4',
  ...props
}: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345c-.091.378-.293 1.194-.333 1.361-.052.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z' />
  </svg>
)

export const RedditIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12c-.688 0-1.25.561-1.25 1.25 0 .687.562 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z' />
  </svg>
)

export const ThreadsIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.78 3.631 2.695 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L9.396 9.662c.98-1.453 2.568-2.255 4.478-2.255h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.324.145 1.52.715 2.63 1.796 3.21 3.128.807 1.855.881 4.874-1.55 7.253-1.856 1.817-4.106 2.64-7.293 2.68h-.02z' />
  </svg>
)

export const SnapchatIcon = ({
  className = 'w-4 h-4',
  ...props
}: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.023.354-.033.534.006.007.055.03.15.03.174-.005.24-.049.24-.049.171-.09.442-.183.7-.183.174 0 .276.023.406.068.324.114.514.35.517.638.006.396-.376.752-1.135.998-.081.026-.19.058-.31.093-.44.13-1.105.325-1.288.756-.095.223-.058.51.11.855l.006.012c.06.14 1.483 3.442 4.702 3.975.235.039.417.246.402.487-.002.019-.006.037-.01.055-.157.741-2.24.951-2.996 1.11-.081.017-.156.033-.208.049-.033.011-.052.037-.061.081-.044.211-.086.412-.156.641-.113.372-.35.549-.749.549-.234 0-.505-.06-.803-.126-.542-.12-1.279-.284-2.204-.284-.53 0-1.077.057-1.628.17-.885.181-1.65.685-2.516 1.264-.977.652-2.089 1.395-3.567 1.395-.13 0-.259-.008-.386-.024l-.06-.008c-1.442 0-2.554-.743-3.531-1.395-.866-.579-1.631-1.083-2.516-1.264-.551-.113-1.098-.17-1.628-.17-.925 0-1.662.164-2.204.284-.298.066-.569.126-.803.126-.399 0-.636-.177-.749-.549-.07-.229-.112-.43-.156-.641-.009-.044-.028-.07-.061-.081-.052-.016-.127-.032-.208-.049-.756-.159-2.839-.369-2.996-1.11-.004-.018-.008-.036-.01-.055-.015-.241.167-.448.402-.487 3.219-.533 4.642-3.835 4.702-3.975l.006-.012c.168-.345.205-.632.11-.855-.183-.431-.848-.626-1.288-.756-.12-.035-.229-.067-.31-.093-.759-.246-1.141-.602-1.135-.998.003-.288.193-.524.517-.638.13-.045.232-.068.406-.068.258 0 .529.093.7.183 0 0 .066.044.24.049.095 0 .144-.023.15-.03-.01-.18-.021-.354-.033-.534l-.003-.06c-.104-1.628-.23-3.654.299-4.847C7.859 1.069 11.216.793 12.206.793z' />
  </svg>
)

export const TwitchIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z' />
  </svg>
)

export const VimeoIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} fill='currentColor' viewBox='0 0 24 24' {...props}>
    <path d='M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128C5.08 2.701 6.266 1.984 7.055 1.91c1.867-.18 3.016 1.1 3.447 3.838.465 2.953.789 4.789.971 5.507.539 2.45 1.131 3.674 1.776 3.674.502 0 1.256-.796 2.265-2.385 1.004-1.589 1.54-2.797 1.612-3.628.144-1.371-.395-2.061-1.614-2.061-.574 0-1.167.121-1.777.391 1.186-3.868 3.434-5.757 6.762-5.637 2.473.06 3.628 1.664 3.493 4.797z' />
  </svg>
)

/**
 * The three former lucide-react icons.
 *
 * `lucide-react` was pulled in for exactly these, and one of them — the pin
 * pair in the account control — lives in the root layout, so its 7 KB gzipped
 * chunk was on the critical path of every page in the site to draw two glyphs
 * that only appear on phones, and only once you are signed in. Inline SVG in
 * the file that already holds every other icon costs bytes we were already
 * paying for.
 *
 * Paths are lucide's own (`pin`, `pin-off`, `chevron-down`), so nothing about
 * the drawing changed; the stroke defaults below are lucide's too.
 */
const strokeIcon = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
} as const

export const PinIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} {...strokeIcon} {...props}>
    <path d='M12 17v5' />
    <path d='M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z' />
  </svg>
)

export const PinOffIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} {...strokeIcon} {...props}>
    <path d='M12 17v5' />
    <path d='M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89' />
    <path d='m2 2 20 20' />
    <path d='M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11' />
  </svg>
)

export const ChevronDownIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} {...strokeIcon} {...props}>
    <path d='m6 9 6 6 6-6' />
  </svg>
)

export const ChevronLeftIcon = ({ className = 'w-5 h-5', ...props }: IconProps) => (
  <svg className={className} {...strokeIcon} {...props}>
    <path d='m15 18-6-6 6-6' />
  </svg>
)

export const ChevronRightIcon = ({ className = 'w-5 h-5', ...props }: IconProps) => (
  <svg className={className} {...strokeIcon} {...props}>
    <path d='m9 18 6-6-6-6' />
  </svg>
)

/**
 * Marks a gallery tile that holds a clip rather than a still. Filled, not
 * stroked, so it stays legible at 12px over an arbitrary frame.
 */
export const PlayIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg
    className={className}
    viewBox='0 0 24 24'
    fill='currentColor'
    aria-hidden='true'
    {...props}
  >
    <path d='M8 5.14v13.72c0 .83.92 1.33 1.62.88l10.79-6.86a1.04 1.04 0 0 0 0-1.76L9.62 4.26A1.04 1.04 0 0 0 8 5.14Z' />
  </svg>
)

/** The footer's link to our streaming site. Lucide's `clapperboard`. */
export const FilmIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} {...strokeIcon} {...props}>
    <path d='M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z' />
    <path d='m6.2 5.3 3.1 3.9' />
    <path d='m12.4 3.4 3.1 4' />
    <path d='M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z' />
  </svg>
)

/**
 * The mark for supporting the project. A coffee cup rather than a heart: it
 * names the actual gesture, matches the platform the link goes to, and asks for
 * a small one-off thing — a heart reads as a like, and a star reads as status.
 *
 * Lucide's `coffee`, unchanged.
 */
export const CoffeeIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} {...strokeIcon} {...props}>
    <path d='M10 2v2' />
    <path d='M14 2v2' />
    <path d='M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1' />
    <path d='M6 2v2' />
  </svg>
)

/**
 * Home, for the one navigation affordance the site has. A house rather than a
 * back arrow: every page here is reachable directly from search, so "back" is
 * frequently a different site, and "home" is the only honest label.
 */
export const HomeIcon = ({ className = 'w-4 h-4', ...props }: IconProps) => (
  <svg className={className} {...strokeIcon} {...props}>
    <path d='M3 10.5 12 3l9 7.5' />
    <path d='M5 9.6V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.6' />
  </svg>
)

// Utility component for the default image placeholder
export const getImagePlaceholderBase64 = () =>
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+SW1hZ2U8L3RleHQ+PC9zdmc+'
