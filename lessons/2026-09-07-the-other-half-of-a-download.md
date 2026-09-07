# The other half of a download

**Date:** 2026-09-07
**Scope:** `shareFile.ts`, `lastSaved.ts`, `id3.ts`, `audioTags.ts`, `entitlements.ts`, `DownloaderApp.tsx`

## What

**Send to an app.** On a phone, saving a video is not what anybody came to do —
putting it in a chat is. The file lands in a Downloads folder nobody browses,
and the last step is the one that loses people. Every mobile OS has a share
sheet for exactly this, so a save now offers to hand the file straight to it.

The shape is dictated by one constraint: `navigator.share` needs live user
activation, and Safari's expires within seconds. Sharing at the *end* of a
download is therefore already too late for any file worth sharing. So nothing
in the flow fetches for the share — the download already buffers the whole body
in memory before writing it out, so the bytes are simply kept, and the button
that appears afterwards runs inside its own click. `navigator.canShare` is asked
with the real file, because support depends on browser, OS and file type
together, and any static check is a guess that leaves a button doing nothing.

**MP3s that know what they are** (supporters). Extracted audio arrives
anonymous: dropped into a music library it is a filename under nothing.
Everything needed to fix that is already on the card, so the saved MP3 now
carries TIT2/TPE1/TALB, the source URL in WOAS, and the thumbnail re-encoded to
a 640px front cover in APIC. ID3v2.3 with UTF-16 rather than v2.4 with UTF-8:
2.3 is what every car stereo reads, and titles here are routinely Arabic,
Japanese or emoji, which rules out the Latin-1 that 2.3 also offers.

`tagMp3` hands the original back untouched whenever tagging would be a guess —
tags with nothing in them, and bytes that are not MP3. The second is not an edge
case: the audio button names everything `.mp3`, but the YouTube fallback
re-serves an AAC track in an MP4 container, and tagging that would corrupt it.
The bytes get the last word rather than the name.

## Mistakes

**I put the saved file in `useState`, and the linter found a real bug in it.**
`react-hooks/set-state-in-effect` fired — not on the new code, but on the
auto-save effect, which calls the download handler, which now called `setState`.
That is a genuine cascading-render path and the rule was right. What I nearly
did next is the actual mistake: I started writing a `setTimeout` around the
handler call with the justification "let the card paint before the bar appears."
That justification is false — `useEffect` already runs after paint — and I was
about to ship a fabricated reason for a change whose only purpose was to get
past a linter. The honest fix was already in the codebase: `downloadProgress` is
a module store for exactly this shape, a value written deep inside a download
and read in one place. `lastSaved` is the same thing.

**My own verifier reported a bug that was not there.** Walking the produced tag,
my throwaway inspection script printed `APIC pic-type 0` — cover art marked as
"other" instead of "front cover", which would have been a real defect. It read
the byte one position early: the picture type follows the MIME string's null
terminator, and I had counted the terminator as the type. The unit test asserted
the correct layout and disagreed with the script. **When a quick verifier
contradicts a test that was written against the spec, suspect the verifier
first.** Two minutes of re-reading the frame layout, rather than "fixing" the
code to satisfy a broken reader.

**I changed two things at once and cannot say which fixed it.** Every outbound
fetch from the local dev server was failing (`TypeError: fetch failed`), and I
concluded from the lesson ledger that this box needs `--dns-result-order=
ipv4first`. I restarted the server *with* the flag and it worked — but plain
`node -e "fetch(...)"` had already succeeded without the flag in the same shell,
which means the flag probably had nothing to do with it and the stale
hours-old server process was the whole story. Two changes, one observation, no
conclusion. Recorded here as unknown rather than written up as a fix.

**The share button nearly shipped without ever being seen.** The browser tools
went unavailable mid-verification, and the temptation was to call unit tests
plus a careful re-read good enough. They are not the same thing: what unit tests
cannot show is whether the button is reachable, whether the file it hands over
is the right one, and whether the title travels. Waiting for the tooling to come
back produced a share carrying
`…_youtube_rickastley_….mp3 | audio/mpeg | 3410370` — the correct file, type and
size — which no amount of re-reading would have established.

## What worked

- **Designing around the platform constraint instead of against it.** The
  activation window is not negotiable, so the feature was shaped to fit inside
  it. A version that fetched on click would have worked on Android and failed
  silently on every iPhone.
- **Verifying the byte layout with a reader I did not write.** A synthetic MP3
  with a hand-built tag, read back by Windows Explorer's own property handler:
  Title, Contributing artists, Album, 128 kbps, 1 second. Arabic and an emoji in
  the title came through intact, which is the whole argument for UTF-16 in one
  observation. Then the same walk over the real downloaded file, where the
  tagged copy was 20,208 bytes larger than the untagged one — the cover art,
  visible as arithmetic.
- **`deliver` as the single delivery point.** Folding the three hand-rolled
  copies of the anchor-and-click dance into it was what made "offer to share
  this" a property of every media save rather than of the two paths I happened
  to think of.
- **Reverting the temporary entitlement override in the same breath as using
  it.** `useAudioTags` returned `true` for exactly one download, and the marker
  was `TEMP-VERIFY` so a grep could prove it was gone.

## Rules

- **A linter complaining about new code may be describing an old bug.** Read
  what it actually says before deciding where the fix goes.
- **Never invent a justification to satisfy a tool.** If the only reason for a
  change is a rule, either the rule is right about the design or the rule should
  be argued with — not talked around in a comment.
- **When two verifiers disagree, distrust the one written five minutes ago.**
- **A capability check should ask about the real thing.** `canShare` with the
  actual file, not a feature-detect on `navigator.share`.
- **Bytes that arrive under a name are not that format.** Sniff before writing
  into a file; `.mp3` here is a label the button chose, not a fact.
- **Verify with a reader you did not write.** A test that only round-trips
  through your own encoder proves the encoder is self-consistent, not correct.
