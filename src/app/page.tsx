import { DownloaderApp } from '@/components/DownloaderApp'
import { InteractiveBackground } from '@/components/InteractiveBackground'
import { PrivateGate } from '@/components/PrivateGate'
import { Surface } from '@/components/Surface'
import {
  InstagramIcon,
  TikTokIcon,
  TwitterXIcon,
  YouTubeIcon,
} from '@/components/icons'

const platforms = [
  { name: '抖音 / TikTok', Icon: TikTokIcon, className: 'bg-black' },
  { name: 'Instagram', Icon: InstagramIcon, className: '' },
  { name: 'X', Icon: TwitterXIcon, className: 'bg-black' },
  { name: 'YouTube / 哔哩哔哩', Icon: YouTubeIcon, className: '' },
] as const

export default function Home() {
  return (
    <div className='app-bg relative min-h-[100dvh] overflow-clip'>
      <div className='pointer-events-none fixed inset-0 z-0'>
        <InteractiveBackground />
      </div>

      <main className='relative z-10 mx-auto max-w-5xl px-4 py-10 sm:py-16'>
        <Surface glow radius='3xl' className='mx-auto p-5 sm:p-8 md:p-10'>
          <header className='mb-8 text-center'>
            <div className='mb-5 flex justify-center gap-2.5'>
              {platforms.map(({ name, Icon, className }) => (
                <span
                  key={name}
                  title={name}
                  className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl ring-1 ring-white/15 ${className}`}
                >
                  <Icon className='h-full w-full' />
                </span>
              ))}
            </div>
            <h1 className='text-3xl font-black tracking-tight text-white sm:text-5xl'>
              社交媒体解析下载器
            </h1>
            <p className='mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/65 sm:text-base'>
              粘贴公开作品链接，解析视频、音频或图片。网页和快捷指令均需鉴权，
              Instagram Cookie 只保存在你的 Cloudflare Worker 服务端。
            </p>
            <div className='mt-5 flex flex-wrap justify-center gap-2 text-xs text-cyan-100/85'>
              <span className='rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5'>
                私人账号登录
              </span>
              <span className='rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5'>
                快捷指令 API Key
              </span>
              <span className='rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5'>
                Cookie 不下发前端
              </span>
            </div>
          </header>

          <PrivateGate>
            <DownloaderApp />
          </PrivateGate>
        </Surface>

        <p className='mx-auto mt-6 max-w-3xl text-center text-xs leading-6 text-white/45'>
          仅处理你有权保存的公开内容。请勿把账号密码、快捷指令 API Key 或
          Instagram Cookie 写入仓库、截图、网址参数或客户端代码。
        </p>
      </main>
    </div>
  )
}
