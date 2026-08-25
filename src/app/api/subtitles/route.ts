import { handleSubtitles } from '@/lib/apiRoutes'

// The implementation lives in src/lib/apiRoutes.ts, shared with the Cloudflare
// Worker entrypoint, which serves this path without initializing Next — see
// that file for why the CPU budget requires it.
export async function POST(request: Request) {
  return handleSubtitles(request)
}
