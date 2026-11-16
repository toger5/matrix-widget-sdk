#!/usr/bin/env bash
# Fetch the current text of a Matrix spec proposal (MSC) by number, via the GitHub CLI (gh).
#
#   spec/msc.sh <N>                  fetch the proposal markdown, print its local path
#   spec/msc.sh <N> --info           print title, state, branch, head commit, file, url
#   spec/msc.sh <N> --diff <edited>  unified diff of the fetched text against <edited> (for spec/patch)
#   spec/msc.sh <N> --check <patch>  check that <patch> (a .patch, or a .md with a diff block) still applies
#
# Open and closed MSCs are read at the head commit of their pull request (forks work too), merged
# ones at main. Files are cached per commit in $MSC_CACHE (default: $TMPDIR/msc-cache).
set -euo pipefail

REPO=matrix-org/matrix-spec-proposals
n=${1:-}; mode=${2:-}; arg=${3:-}
case "$n" in ''|*[!0-9]*) sed -n '2,10s/^# \{0,1\}//p' "$0" >&2; exit 2 ;; esac
case "$mode" in
  ''|--info) ;;
  --diff|--check) [ -f "$arg" ] || { echo "usage: spec/msc.sh $n $mode <file>" >&2; exit 2; } ;;
  *) echo "unknown option: $mode" >&2; exit 2 ;;
esac

# gh's own error (not logged in, network, no such PR) stays visible on stderr.
if ! meta=$(gh pr view "$n" -R "$REPO" --json title,state,isDraft,headRefName,headRefOid,url,updatedAt,files \
    --jq '[.state, .headRefOid, .headRefName, .url, .updatedAt, (.isDraft|tostring), .title,
           ([.files[].path | select(test("^proposals/[^/]+\\.md$"))]
            | (map(select(startswith("proposals/'"$n"'-"))) + .) | .[0] // "")] | @tsv'); then
  echo "Could not read PR #$n of $REPO (see the gh error above). Some old MSCs are issues, not PRs," \
    "and their issue number can differ: gh search issues --repo $REPO MSC$n" >&2
  exit 2
fi
IFS=$'\t' read -r state head branch url updated draft title file <<<"$meta"
# The file name comes from the PR; it becomes part of a URL and a local path.
case "$file" in *[!A-Za-z0-9._/-]*) echo "unexpected proposal file name in PR #$n: $file" >&2; exit 2 ;; esac

ref=$head
[ "$state" = MERGED ] && ref=$(gh api "repos/$REPO/commits/main" --jq .sha)

if [ "$mode" = --info ]; then
  printf 'MSC%s\t%s\nstate\t%s%s\nbranch\t%s\nhead\t%s\nread at\t%s\nfile\t%s\nurl\t%s\nupdated\t%s\n' \
    "$n" "$title" "$state" "$([ "$draft" = true ] && echo ' (draft)')" "$branch" "$head" "$ref" \
    "${file:-<none, see the PR body>}" "$url" "$updated"
  exit 0
fi

dir=${MSC_CACHE:-${TMPDIR:-/tmp}/msc-cache}/$n/$ref
if [ -z "$file" ]; then
  file=pr-body.md
  [ -s "$dir/$file" ] || { mkdir -p "$dir"; gh pr view "$n" -R "$REPO" --json body --jq .body >"$dir/$file.tmp"
                           mv "$dir/$file.tmp" "$dir/$file"; }
  echo "MSC$n has no proposals/*.md file; saved the PR body instead" >&2
elif [ ! -s "$dir/$file" ]; then
  mkdir -p "$dir/$(dirname "$file")"
  gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/$file?ref=$ref" >"$dir/$file.tmp"
  mv "$dir/$file.tmp" "$dir/$file"
fi

case "$mode" in
  '') echo "$dir/$file" ;;
  --diff) diff -u -L "a/$file" -L "b/$file" -- "$dir/$file" "$arg" || [ $? = 1 ] ;;
  --check)
    patch=$(cd "$(dirname "$arg")" && pwd)/$(basename "$arg")
    (cd "$dir" && GIT_CEILING_DIRECTORIES=$(dirname "$dir") git apply --check "$patch") \
      && echo "applies to MSC$n at $ref" ;;
esac
