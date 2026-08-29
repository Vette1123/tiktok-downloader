import type { Metadata } from 'next'
import Link from 'next/link'
import { AccountPanel } from '@/components/AccountPanel'
import { SiteFooter } from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Your Account — Social Media Downloader',
  robots: { index: false },
}

export default function Account() {
  return (
    <div className='app-bg relative min-h-[100dvh] overflow-clip'>
      <div className='relative z-10 mx-auto max-w-3xl px-4 py-10 sm:py-16'>
        <div className='text-center'>
          <span className='btn-grad inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase'>
            Account
          </span>
          <h1 className='mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl'>
            Your plan. <span className='text-grad'>Your call.</span>
          </h1>
          <p className='mx-auto mt-3 max-w-xl text-sm text-white/70 md:text-base'>
            Manage your subscription, your download preferences, and the devices
            signed in to this account.
          </p>
        </div>

        <div className='mt-8'>
          <AccountPanel />
        </div>

        <Link href='/' className='mt-10 inline-block text-sm text-cyan-300 hover:text-cyan-200'>
          Back to the downloader
        </Link>

        <SiteFooter />
      </div>
    </div>
  )
}
