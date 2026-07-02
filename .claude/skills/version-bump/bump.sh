#!/usr/bin/env bash
# version-bump — bump Quark's version everywhere it appears, in lockstep.
#
# The version string lives in SIX places. Editing one and forgetting the
# others (a recurring mistake — the README badge and the iOS plist in particular
# have been bumped in separate, late commits) leaves them out of sync. This
# script changes all six atomically and refuses to run if they don't already
# agree.
#
#   1. package.json                 "version": "X.Y.Z"
#   2. src-tauri/Cargo.toml          [package] version = "X.Y.Z"
#   3. src-tauri/tauri.conf.json     "version": "X.Y.Z"
#   4. README.md                     shields.io  version-X.Y.Z-<color>  badge
#   5. src-tauri/Cargo.lock          the `quark` package entry (also regenerated
#                                    by any `cargo build`, but kept in sync here
#                                    so the working tree is clean immediately)
#   6. src-tauri/gen/apple/quark_iOS/Info.plist
#                                    CFBundleShortVersionString + CFBundleVersion
#                                    (both <string>X.Y.Z</string>)
#
# Usage:   bump.sh <major|minor|patch|X.Y.Z>
#   major  1.4.2 -> 2.0.0
#   minor  1.4.2 -> 1.5.0   (new user-visible feature)
#   patch  1.4.2 -> 1.4.3   (bug fix, no new features)
#   X.Y.Z  set an explicit version
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

PKG_JSON="package.json"
CARGO_TOML="src-tauri/Cargo.toml"
CARGO_LOCK="src-tauri/Cargo.lock"
TAURI_CONF="src-tauri/tauri.conf.json"
README="README.md"
PLIST="src-tauri/gen/apple/quark_iOS/Info.plist"

die() { echo "version-bump: $*" >&2; exit 1; }

# ── "Has the current version shipped?" helpers ──────────────────────────────
# A version ships when CI tags its release commit `vX.Y.Z` (release.yml runs on
# `v*` tags). If the in-tree version was never tagged it is still UNRELEASED:
# further same-tier changes can ride it, and bumping again just mints a version
# that never ships. We bump an unreleased version only to ESCALATE its SemVer
# tier (e.g. the pending version is a patch but this branch adds a feature).
tier_rank() { case "$1" in major) echo 3 ;; minor) echo 2 ;; patch) echo 1 ;; *) echo 0 ;; esac; }
tier_name() { case "$1" in 3) echo major ;; 2) echo minor ;; 1) echo patch ;; *) echo none ;; esac; }

current_shipped() { git rev-parse -q --verify "refs/tags/v$CURRENT" >/dev/null 2>&1; }

# Highest released version (ignores -beta/-rc pre-release tags).
last_shipped() {
  # grep exits 1 when no release tags exist; without `|| true` pipefail would
  # kill the script here instead of reaching the "nothing has shipped" message.
  git tag -l 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null \
    | { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true; } | sed 's/^v//' \
    | sort -t. -k1,1n -k2,2n -k3,3n | tail -1
}

# Tier by which CURRENT already advanced beyond the last shipped release.
# (No releases at all ⇒ max tier: any bump is redundant pre-first-ship.)
advanced_tier() {
  local last="$1" lM lm lp
  [[ -z "$last" ]] && { echo 3; return; }
  IFS=. read -r lM lm lp <<<"$last"
  if   [[ "$MAJ" -ne "$lM" ]]; then echo 3
  elif [[ "$MIN" -ne "$lm" ]]; then echo 2
  elif [[ "$PAT" -ne "$lp" ]]; then echo 1
  else echo 0; fi
}

# ── Read the current version from each file (package.json is the source of truth) ──
read_pkg()   { grep -m1 '"version"' "$PKG_JSON"   | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
read_tauri() { grep -m1 '"version"' "$TAURI_CONF" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
# Cargo.toml: the version line inside the [package] section only.
read_cargo() { awk -F'"' '/^\[package\]/{p=1;next} /^\[/{p=0} p&&/^version[[:space:]]*=/{print $2; exit}' "$CARGO_TOML"; }
# Cargo.lock: the version on the line after `name = "quark"`.
read_lock()  { awk -F'"' '/^name = "quark"$/{getline; print $2; exit}' "$CARGO_LOCK"; }
# README: the shields.io version badge.
read_readme(){ grep -m1 -oE 'version-[0-9]+\.[0-9]+\.[0-9]+-' "$README" | sed -E 's/version-(.*)-/\1/'; }
# Info.plist: the <string> on the line after the CFBundleShortVersionString key.
read_plist(){ awk '/CFBundleShortVersionString/{getline; gsub(/[[:space:]]*<\/?string>/,""); print; exit}' "$PLIST"; }

CURRENT="$(read_pkg)"
[[ "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not parse current version from $PKG_JSON (got '$CURRENT')"

# ── All five must already agree, or we'd be papering over an existing drift ──
# Parallel indexed arrays (not an associative map): macOS ships bash 3.2, which
# has no `declare -A`. Indexed arrays + `${!arr[@]}` work there and in the nix
# dev shell's bash 5 alike, so the drift check actually runs on both.
FILES=("$PKG_JSON" "$TAURI_CONF" "$CARGO_TOML" "$CARGO_LOCK" "$README" "$PLIST")
FOUND=("$(read_pkg)" "$(read_tauri)" "$(read_cargo)" "$(read_lock)" "$(read_readme)" "$(read_plist)")
drift=0
for i in "${!FILES[@]}"; do
  if [[ "${FOUND[$i]}" != "$CURRENT" ]]; then
    echo "  out of sync: ${FILES[$i]} has '${FOUND[$i]}' (expected '$CURRENT')" >&2
    drift=1
  fi
done
[[ $drift -eq 0 ]] || die "files are already out of sync — reconcile to '$CURRENT' before bumping."

# ── Compute the new version ──
arg="${1:-}"
IFS=. read -r MAJ MIN PAT <<<"$CURRENT"
case "$arg" in
  major) NEW="$((MAJ + 1)).0.0" ;;
  minor) NEW="${MAJ}.$((MIN + 1)).0" ;;
  patch) NEW="${MAJ}.${MIN}.$((PAT + 1))" ;;
  [0-9]*.[0-9]*.[0-9]*)
    [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid explicit version '$arg'"
    NEW="$arg" ;;
  *) die "usage: bump.sh <major|minor|patch|X.Y.Z>" ;;
esac
[[ "$NEW" != "$CURRENT" ]] || die "new version equals current ($CURRENT); nothing to do."

# ── Don't re-bump an unreleased version for same-tier changes ───────────────
# Skip the check outside a git repo (can't tell what shipped) or when overridden.
if git rev-parse --git-dir >/dev/null 2>&1 && [[ "${ALLOW_UNSHIPPED_BUMP:-0}" != "1" ]]; then
  if ! current_shipped; then
    LAST="$(last_shipped)"
    ADV="$(advanced_tier "$LAST")"
    REQ="$(tier_rank "$arg")"   # 0 for an explicit X.Y.Z — never blocked
    if [[ "$REQ" -ne 0 && "$REQ" -le "$ADV" ]]; then
      {
        echo "version-bump: current version $CURRENT has NOT shipped yet —"
        if [[ -n "$LAST" ]]; then
          echo "  last released: v$LAST  (and $CURRENT is already a $(tier_name "$ADV")-level bump ahead of it)"
        else
          echo "  no release tags found — nothing has shipped yet, so $CURRENT will be the first release"
        fi
        echo "  Another '$arg' bump would mint a version that never ships. Additional"
        echo "  ${arg}-level changes can ride the pending $CURRENT release — no bump needed."
        echo "  Bump only to ESCALATE the tier (e.g. the branch adds a feature and the"
        echo "  pending version is just a patch: run 'minor')."
        echo
        echo "  If you expected v$CURRENT to be tagged, run 'git fetch --tags' and retry."
        echo "  To bump anyway, re-run with ALLOW_UNSHIPPED_BUMP=1."
      } >&2
      exit 1
    fi
  fi
fi

echo "version-bump: $CURRENT -> $NEW"

# Escape dots so the current version matches literally, not as a regex wildcard.
CUR_RE="${CURRENT//./\\.}"

# ── Apply. Each substitution is scoped so unrelated versions stay untouched
#    (e.g. dependency versions in Cargo.toml / Cargo.lock). ──
perl -0pi -e "s/(\"version\"\\s*:\\s*\")${CUR_RE}(\")/\${1}${NEW}\${2}/"                  "$PKG_JSON"
perl -0pi -e "s/(\"version\"\\s*:\\s*\")${CUR_RE}(\")/\${1}${NEW}\${2}/"                  "$TAURI_CONF"
perl -0pi -e "s/(\\[package\\][^\\[]*?\\nversion\\s*=\\s*\")${CUR_RE}(\")/\${1}${NEW}\${2}/s" "$CARGO_TOML"
perl -0pi -e "s/(name = \"quark\"\\nversion = \")${CUR_RE}(\")/\${1}${NEW}\${2}/"        "$CARGO_LOCK"
perl -0pi -e "s/(version-)${CUR_RE}(-)/\${1}${NEW}\${2}/"                                 "$README"
# Both CFBundleShortVersionString and CFBundleVersion carry the version; the /g
# updates both. Scoped to <string>X.Y.Z</string> so other plist strings (bundle
# name, etc.) are untouched — no non-version string equals the version number.
perl -0pi -e "s/(<string>)${CUR_RE}(<\\/string>)/\${1}${NEW}\${2}/g"                       "$PLIST"

# ── Verify every file now reports the new version ──
fail=0
check() { [[ "$2" == "$NEW" ]] || { echo "  FAILED to update $1 (still '$2')" >&2; fail=1; }; }
check "$PKG_JSON"   "$(read_pkg)"
check "$TAURI_CONF" "$(read_tauri)"
check "$CARGO_TOML" "$(read_cargo)"
check "$CARGO_LOCK" "$(read_lock)"
check "$README"     "$(read_readme)"
check "$PLIST"      "$(read_plist)"
[[ $fail -eq 0 ]] || die "one or more files did not update cleanly — inspect the diff."

echo "version-bump: all six files now at $NEW"
echo
echo "Changed lines:"
grep -nH -m1 '"version"' "$PKG_JSON" "$TAURI_CONF"
grep -nH    'version-'"$NEW"'-' "$README"
awk '/^\[package\]/{p=1} p&&/^version/{print FILENAME":"FNR":"$0; exit}' "$CARGO_TOML"
awk '/^name = "quark"$/{getline; print FILENAME":"FNR":"$0; exit}' "$CARGO_LOCK"
grep -nH -m1 -A1 'CFBundleShortVersionString' "$PLIST" | grep '<string>'
