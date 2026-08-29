# Directories, a Show HN, and the filter that ate the Reddit posts

## What

The second half of the distribution round: finish the SaaSHub listing, take the
remaining channels the owner had signed into, and stop where a gate is real
rather than routing around it.

**Shipped.** SaaSHub is complete (logo, screenshot, long description, release
date, open source + repo URL) and pending approval for up to 32 days. Indie
Hackers has a full Products DB entry. A Show HN is live with the maker comment:
https://news.ycombinator.com/item?id=49489963. Two awesome-list PRs are open.

**Stopped.** Indie Hackers refuses posts from the account ("your account cannot
create posts yet"). OpenAlternative auto-rejected the submission. DevHunt is for
developer-facing tools and this is not one. Microlaunch is paid now. StartupBase's
free launch queue is ~1,458 deep and wants a badge on our site. Reddit removed
both posts.

**The Reddit result is the useful one.** r/SideProject and r/coolgithubprojects
each accepted the submission, showed it back at 1 point, and gave no error — and
both came back `removed_by_category: "reddit"` when read through the JSON API.
That is Reddit's sitewide spam filter, not a subreddit mod. The account is seven
years old with 5 link karma and 0 comment karma, and age does not substitute for
karma here. Posting to a third subreddit would have added spam signal without
adding a reader.

## Mistakes

- **Declared an asset missing because curl said so.** `/icons/512` answered
  `Content-Type: text/html`, and that was read as "the route is broken, there is
  no PNG". The full response headers say `HTTP/1.1 403` and
  `Cf-Mitigated: challenge` — Cloudflare challenging curl's user agent. The real
  512x512 PNG was sitting in `out/icons/512` the whole time, extensionless
  because it is a route, not a file. A content type is only evidence once the
  status code has been read.
- **Trusted a filled field on a framework form.** `form_input` set the Indie
  Hackers textarea, the text was visibly there, and Save did nothing at all — no
  error, no navigation. Ember never saw the assignment. Typing the same text with
  real key events registered it, and the `*REQUIRED` marker next to the label
  cleared. The marker, not the visible text, is the signal that the model
  updated.
- **Saved an edit form and wiped the logo.** The upload succeeded, then the next
  Save submitted the same form with an empty file input and cleared it. An edit
  form re-submits every field, and a file input always renders empty; re-attach
  the file in the same pass that saves.
- **Clicked a coordinate from a screenshot the page had already replaced.**
  Reddit's old submit form re-rendered after the click, and the coordinate that
  had been `submit` was now the subreddit autocomplete — which quietly set the
  target to an unrelated subreddit. Caught it before submitting. After any
  re-render, re-read the page rather than reusing a coordinate.
- **Posted the second Reddit link before verifying the first had survived.** Both
  were already dead. One JSON read costs nothing and would have stopped the
  second post.

## What worked

- **Reading the post back through the API.** `/comments/<id>.json` exposes
  `removed_by_category`, `banned_at_utc` and `approved_at_utc`. Logged in as the
  author the page looks completely normal, so this is the only way to tell a live
  post from a filtered one.
- **Shrinking the logo instead of pasting it.** A file input that only exists
  after a click cannot be reached by the upload tool, and clicking it opens a
  native picker that freezes the renderer. Patching
  `HTMLInputElement.prototype.click` to capture the element, then assigning
  `files` from a `DataTransfer`, got the file in — and re-encoding the icon to a
  224px 8-colour PNG took the inline base64 from 10.6 KB to 1.1 KB.
- **Letting a "no" stand.** Four channels said no for four different reasons.
  None of them were retried with reworded copy, and the ones that need a decision
  in the owner's name (mod messages, subreddit approval, the solo-founder claim)
  were left for the owner.

## Rules

- Read the status code before believing the content type. A Cloudflare challenge
  is HTML with a 403 on it.
- On a framework-driven form, a field counts as set when its required marker
  clears, not when the text appears.
- An edit form re-submits every field; re-attach any file before saving, or the
  save deletes it.
- After a re-render, re-read the page. Coordinates from the previous screenshot
  point at whatever moved into them.
- Verify a Reddit post survived (`removed_by_category` via the JSON API) before
  posting the next one. A near-zero-karma account cannot post links, however old
  it is.

Related: [2026-08-29-product-hunt-draft-and-the-cpu-floor.md](2026-08-29-product-hunt-draft-and-the-cpu-floor.md),
and the channel-by-channel state in `docs/marketing/launch-kit.md`.
