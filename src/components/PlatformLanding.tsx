import Link from 'next/link'
import { DownloaderApp } from '@/components/DownloaderApp'
import { InteractiveBackground } from '@/components/InteractiveBackground'
import { PrivateGate } from '@/components/PrivateGate'
import { Surface } from '@/components/Surface'
import type { Platform } from '@/lib/platforms'

export function PlatformLanding({ platform }: { platform: Platform }) {
  return (
    <div className='app-bg relative min-h-[100dvh] overflow-clip'>
      <div className='pointer-events-none fixed inset-0 z-0'>
        <InteractiveBackground />
      </div>
      <main className='relative z-10 mx-auto max-w-4xl px-4 py-10 sm:py-16'>
        <Surface glow radius='3xl' className='p-5 sm:p-8'>
          <header className='mb-7 text-center'>
            <Link
              href='/'
              className='mb-4 inline-flex text-sm text-cyan-300 transition hover:text-cyan-200'
            >
              ← 返回全部平台
            </Link>
            <h1 className='text-3xl font-black tracking-tight text-white sm:text-4xl'>
              {platform.brandLabel} 解析下载
            </h1>
            <p className='mt-3 text-sm leading-7 text-white/60'>
              登录后粘贴公开作品链接，可解析视频、音频或图片。
            </p>
          </header>
          <PrivateGate>
            <DownloaderApp />
          </PrivateGate>
        </Surface>
      </main>
    </div>
  )
}
