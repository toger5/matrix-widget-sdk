# Spec patches and MSC drafts

When the implementation needs [MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411)
or [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) to change, or needs a new
MSC, the text is written here first, in the same change as the code, and proposed upstream
afterwards.

```text
spec/msc.sh              fetch, diff and check MSC text (see Commands)
spec/patch/
  msc<N>/<slug>.md       one change to the existing MSC <N>, e.g. msc4412/merge-capability-requests.md
  new/<slug>.md          a draft of a new MSC, e.g. new/timeline-reading.md
```

- One file per change and target MSC; a change that touches several MSCs gets one file per target,
  and the files link each other. Slugs are short, lower case, joined by `-`, and name the change.
- [`docs/spec-appendix/capability-naming-proposal.md`](../../docs/spec-appendix/capability-naming-proposal.md)
  is edited in place, not here: MSC4412 links it by URL, so it must not move.

## A change to an existing MSC

`spec/patch/msc<N>/<slug>.md`:

`````markdown
# MSC4412: <what changes, in a few words>

- **Target:** [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412), `proposals/4412-widget-base-postmessage-api.md`
- **Base:** `<"read at" commit from spec/msc.sh 4412 --info>`
- **Status:** draft | proposed (<link to the PR comment, suggestion or commit>)
- **Implemented here:** <paths, or "not yet">

## Why

<The problem, in a few sentences.>

## Change

<What changes, section by section, in prose: a reviewer should not need the diff to understand it.>

````diff
<output of spec/msc.sh 4412 --diff <edited copy>>
````

## Open questions
`````

- The diff is a unified diff of the whole change to the MSC file, made with `spec/msc.sh <N> --diff`.
  Fence it with **four** backticks: MSC text contains ```` ``` ```` lines.
- `git apply` ignores the markdown around the diff, so the file itself is the patch.

## A new MSC

`spec/patch/new/<slug>.md` follows the upstream
[template](https://github.com/matrix-org/matrix-spec-proposals/blob/main/proposals/0000-proposal-template.md),
so it can be opened as an MSC as is:

```markdown
> **Draft in matrix-widget-sdk.** Status: draft | proposed (<link>). Implemented here: <paths, or "not yet">.
> Related patches: <links>. Remove this block when opening the MSC.

# MSCXXXX: <Title>

<Introduction: the problem and why it matters.>

## Proposal
## Potential issues
## Alternatives
## Security considerations
## Unstable prefix
## Dependencies
```

- The number is `XXXX` and the unstable prefix `org.matrix.mscXXXX`, the placeholder namespace the
  code already uses, until the pull request exists. Then the actions move to `org.matrix.mscN` in
  the code (`.claude/skills/widget-api-change/SKILL.md`) and the draft is deleted here.

## Lifecycle

`draft` (written here) → `proposed` (sent upstream; the status links it) → **deleted** once the
change has landed upstream or was dropped, together with the links to it.

## Commands

From the repository root; needs `gh` (logged in). Fetched text is cached per commit in `$MSC_CACHE`
(default `$TMPDIR/msc-cache`).

```sh
spec/msc.sh 4412 --info                                    # "read at" commit: the Base of the patch
cp "$(spec/msc.sh 4412)" "${TMPDIR:-/tmp}/4412.md"         # edit this copy
spec/msc.sh 4412 --diff "${TMPDIR:-/tmp}/4412.md"          # paste into the ````diff block
spec/msc.sh 4412 --check spec/patch/msc4412/<slug>.md      # "applies to MSC4412 at <commit>"
```

When `--check` fails, the MSC has moved on: make the edit again on the current text and replace the
diff and the Base. Upstream, in a checkout of the MSC's branch:
`git apply /absolute/path/to/spec/patch/msc4412/<slug>.md`.
