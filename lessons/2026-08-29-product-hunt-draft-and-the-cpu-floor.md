# The Product Hunt draft, and the CPU floor that would not move

## What

Two loose ends from the same day: filling the Product Hunt launch submission
now that the account is signed in, and settling whether the bundle work in
[2026-08-29-cpu-startup-seo-titles-marketing.md](2026-08-29-cpu-startup-seo-titles-marketing.md)
actually lowered production CPU.

**Product Hunt.** A draft now exists at
`producthunt.com/products/social-media-downloader`, complete on every required
field: tagline, the ~300-character description from the launch kit, the site
and repo links, the open-source flag, the X account, three launch tags (Open
Source, Social Media, Video), a thumbnail, four gallery images, Free pricing,
bootstrapped, and the first comment. It is a draft and is not scheduled.
Scheduling, shoutouts and the solo-maker checkbox were deliberately left
undone — a launch date is one shot, and the other two are public claims made
in the account owner's name.

**The CPU floor.** `/api/health` was probed once every ~125 seconds and the
per-minute numbers read back:

| Minute | Requests | p50 |
| --- | --- | --- |
| 11:09 | 1 | 0.65 ms |
| 11:18 | 1 | 0.29 ms |
| 11:08 | 1 | 6.83 ms |
| 11:19 | 1 | 7.18 ms |

Same handler, same route, two clusters an order of magnitude apart: the cheap
ones reused a warm isolate, the expensive ones created a new one. Isolate
creation, not our code, is what a request pays here. Across the deploy the
quiet-minute median went 6.53 ms → 6.91 ms — noise, and certainly not the
2 ms the local measurement predicted.

That is the whole answer, and it means the bundle-size lever is spent. The
local harness measures our module's compile and evaluate; the isolate also
pays for the runtime, the compat flags and the bindings, and that part is
fixed. At ~1.2 requests a minute almost every request is a cold one, so p50
*is* the cold-start cost. Nothing here needs fixing: 6.5 ms sits under the
free plan's 10 ms, and this account has been observed serving 22 ms without a
kill.

**StartupBase.** A second listing, filled to 100% of the checklist at
`startupbase.io/submissions/social-media-downloader` and left unsubmitted for
the same reason. Their AI assistant scrapes the site and prefills the form; what
it wrote for the tagline was the product name plus a restatement of it, so it
was replaced with the 60-character line from the launch kit.

## Mistakes

- **Measured the part I could see and assumed it was the whole.**
  `scripts/worker-startup.mjs` reports our bundle honestly, and 5.29 → 3.24 ms
  was real — it just isn't most of what a cold request costs. A local number
  is a component, not a prediction, until something in production agrees with
  it.
- **`computer type` silently drops characters on long text.** The first
  comment went in as "saving a clip I was allowed to eep", "MIT-liensed",
  "React 19,static". Eleven corruptions in ~750 characters, none of them
  flagged. `form_input` with the same string set it exactly. Type only into
  short fields; anything long goes through `form_input`.
- **Clicked a gallery "+" and froze the tab.** It is a file input, and a
  native picker blocks the renderer — `Page.captureScreenshot` timed out after
  30 s. Escape recovered it. `file_upload` against the input's ref is the way
  in, and the tool's own description says so.
- **Assumed a filled field is a saved field.** StartupBase's first-comment
  textarea has no Save button of its own — it is React state that the
  `Schedule Your Launch` submit reads. A reload emptied it. On any multi-step
  form, reload once before calling a step done, and if a field does not survive
  it, write the copy somewhere the owner can paste it.
- **Uploaded two files at once and got `Something went wrong. Please, try
  again later.`** One at a time worked. A batch upload failing says nothing
  about the files.
- **Screenshots lag a render behind.** A dropdown was read as showing
  "Messaging / Social Media / Design Tools" while it actually held the results
  for "video", and a tag was picked from the stale list. Two screenshots in a
  row, and trusting only the second, was the fix.

## What worked

- **Taking the reversible branch.** "Create draft" saves everything and
  publishes nothing; "Schedule launch for later" picks a date. One of those is
  the account owner's decision, and the form does not have to be re-filled for
  them to make it.
- **Probing a handler that does nothing.** The earlier attempt used
  `/api/does-not-exist`, which calls `env.ASSETS.fetch` — a subrequest whose
  cost lands in the same number. A route with no work in it is the only way to
  read startup by itself.

## Rules

- Production CPU on this Worker is isolate creation. Bundle bytes move a
  fraction of it; measure in production before claiming a saving.
- Long text into a browser field goes through `form_input`, never `type`.
- Never click a file input. Upload through its ref, one file per call.
- A field is saved when it survives a reload, not when it looks filled.
- A launch date, a public review and a badge claim belong to the account
  owner. Fill the form; leave the claims.
