#!/usr/bin/env bash
# version-bump — bump Quark's version everywhere it appears, in lockstep.
#
# The version string lives in EIGHT places. Editing one and forgetting the
# others (a recurring mistake — the README badge and the iOS plist in particular
# have been bumped in separate, late commits) leaves them out of sync. This
# script changes all eight atomically and refuses to run if they don't already
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
#                                    CFBundleShortVersionString
#   7. src-tauri/gen/apple/project.yml
#                                    CFBundleShortVersionString for BOTH iOS
#                                    targets (xcodegen stamps these into the
#                                    built app; it sat at 0.5.0 while the tree
#                                    was at 0.17.2 because nothing checked it)
#   8. src-tauri/gen/apple/QuarkNSE/Info.plist
#                                    the notification service extension's copy.
#                                    App Store validation rejects an extension
#                                    whose version differs from its host app's,
#                                    so this one is not cosmetic either
#
# CFBundleVersion is deliberately NOT one of those eight. It is the iOS build
# number, and App Store Connect requires it to strictly increase across every
# upload sharing one CFBundleShortVersionString. Tying it to the marketing
# version therefore allows exactly ONE upload per release: the second is
# rejected after the archive has already been built and signed. It is an
# integer, it never resets, and it has four homes of its own:
#
#   src-tauri/gen/apple/quark_iOS/Info.plist   CFBundleVersion
#   src-tauri/gen/apple/QuarkNSE/Info.plist    CFBundleVersion
#   src-tauri/gen/apple/project.yml            CFBundleVersion, once per target
#
# Those four must agree with each other for the same reason the version must:
# App Store validation rejects an app and extension whose versions differ.
#
# Usage:   bump.sh <major|minor|patch|X.Y.Z>   bump the marketing version
#          bump.sh build [N]                   bump the iOS build number
#   major  1.4.2 -> 2.0.0
#   minor  1.4.2 -> 1.5.0   (new user-visible feature)
#   patch  1.4.2 -> 1.4.3   (bug fix, no new features)
#   X.Y.Z  set an explicit version
#   build  increment the build number by one, or set it to N
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

PKG_JSON="package.json"
CARGO_TOML="src-tauri/Cargo.toml"
CARGO_LOCK="src-tauri/Cargo.lock"
TAURI_CONF="src-tauri/tauri.conf.json"
README="README.md"
PLIST="src-tauri/gen/apple/quark_iOS/Info.plist"
NSE_PLIST="src-tauri/gen/apple/QuarkNSE/Info.plist"
XCODEGEN="src-tauri/gen/apple/project.yml"

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
# Both iOS plists have the same shape; the extension's must match the app's or
# App Store validation rejects the pair.
read_plist(){ awk '/CFBundleShortVersionString/{getline; gsub(/[[:space:]]*<\/?string>/,""); print; exit}' "$PLIST"; }
read_nse_plist(){ awk '/CFBundleShortVersionString/{getline; gsub(/[[:space:]]*<\/?string>/,""); print; exit}' "$NSE_PLIST"; }
# project.yml: both keys are inline YAML values, but quoted inconsistently
# (`CFBundleShortVersionString: X.Y.Z` bare vs `CFBundleVersion: "X.Y.Z"`), so
# strip spaces and quotes. Read separately — they can drift from each other.
#
# Each key appears once per iOS target (the app and QuarkNSE), and every match
# has to be read. Stopping at the first one let the extension's copy sit at an
# older version unnoticed through both checks below: the drift guard compared
# only the app's value, and the rewrite substitutes solely occurrences equal to
# that value, so the post-rewrite verify then re-read the one line that had in
# fact been updated. Matching values collapse to the single value; a
# disagreement prints joined ("0.18.0/0.17.2"), which no comparison can equal,
# so the mismatch surfaces named rather than passing silently.
read_yml_key() {
  awk -F: -v key="$1" '
    index($0, key ":") {
      gsub(/[[:space:]"]/, "", $2)
      out = (n++ ? out "/" $2 : $2)
      if (n == 1) first = $2; else if ($2 != first) differ = 1
    }
    END { print (differ ? out : first) }' "$XCODEGEN"
}
read_yml_short(){ read_yml_key CFBundleShortVersionString; }
read_yml_build(){ read_yml_key CFBundleVersion; }
# The plists' CFBundleVersion — the build number, read the same way but keyed on
# the other name. `CFBundleShortVersionString` does NOT contain the substring
# `CFBundleVersion` (after "CFBundle" it reads "Short…"), so an unanchored match
# on the shorter key cannot silently pick up the longer one.
read_plist_build(){ awk '/CFBundleVersion/{getline; gsub(/[[:space:]]*<\/?string>/,""); print; exit}' "$PLIST"; }
read_nse_plist_build(){ awk '/CFBundleVersion/{getline; gsub(/[[:space:]]*<\/?string>/,""); print; exit}' "$NSE_PLIST"; }

CURRENT="$(read_pkg)"
[[ "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not parse current version from $PKG_JSON (got '$CURRENT')"

# ── All seven must already agree, or we'd be papering over an existing drift ──
# Parallel indexed arrays (not an associative map): macOS ships bash 3.2, which
# has no `declare -A`. Indexed arrays + `${!arr[@]}` work there and in the nix
# dev shell's bash 5 alike, so the drift check actually runs on both.
# project.yml is named by its key, because its OTHER version key (CFBundleVersion,
# the build number) is checked separately below and a bare label wouldn't say
# which of the two had drifted.
FILES=("$PKG_JSON" "$TAURI_CONF" "$CARGO_TOML" "$CARGO_LOCK" "$README" "$PLIST" "$NSE_PLIST" \
       "$XCODEGEN (CFBundleShortVersionString)")
FOUND=("$(read_pkg)" "$(read_tauri)" "$(read_cargo)" "$(read_lock)" "$(read_readme)" "$(read_plist)" "$(read_nse_plist)" \
       "$(read_yml_short)")
drift=0
for i in "${!FILES[@]}"; do
  if [[ "${FOUND[$i]}" != "$CURRENT" ]]; then
    echo "  out of sync: ${FILES[$i]} has '${FOUND[$i]}' (expected '$CURRENT')" >&2
    drift=1
  fi
done
[[ $drift -eq 0 ]] || die "files are already out of sync — reconcile to '$CURRENT' before bumping."

# ── The iOS build number, checked on EVERY run ─────────────────────────────
# Independent of the marketing version, but subject to the same lockstep rule:
# App Store validation rejects an app and extension whose versions disagree.
# Verified even on a version bump, so a drift introduced by hand is caught at
# the next bump rather than at an upload.
BUILD_FILES=("$PLIST (CFBundleVersion)" "$NSE_PLIST (CFBundleVersion)" "$XCODEGEN (CFBundleVersion)")
BUILD_FOUND=("$(read_plist_build)" "$(read_nse_plist_build)" "$(read_yml_build)")
CURRENT_BUILD="${BUILD_FOUND[0]}"
bdrift=0
for i in "${!BUILD_FILES[@]}"; do
  if [[ "${BUILD_FOUND[$i]}" != "$CURRENT_BUILD" ]]; then
    echo "  out of sync: ${BUILD_FILES[$i]} has '${BUILD_FOUND[$i]}' (expected '$CURRENT_BUILD')" >&2
    bdrift=1
  fi
done
[[ $bdrift -eq 0 ]] || die "iOS build numbers are out of sync — reconcile to '$CURRENT_BUILD' first."
[[ "$CURRENT_BUILD" =~ ^[0-9]+$ ]] || die "iOS build number is not an integer (got '$CURRENT_BUILD')"

# ── bump.sh build [N] — the build number alone, version untouched ──────────
if [[ "${1:-}" == "build" ]]; then
  NEW_BUILD="${2:-$((CURRENT_BUILD + 1))}"
  [[ "$NEW_BUILD" =~ ^[0-9]+$ ]] || die "invalid build number '$NEW_BUILD' — must be a positive integer"
  # Strictly increasing. Going backwards is never a legitimate fix: App Store
  # Connect remembers every build number it has seen for a version string, and
  # a burnt one stays burnt even if the build that burnt it was deleted.
  [[ "$NEW_BUILD" -gt "$CURRENT_BUILD" ]] \
    || die "build number must increase (asked for $CURRENT_BUILD -> $NEW_BUILD)"

  echo "version-bump: build $CURRENT_BUILD -> $NEW_BUILD (version stays $CURRENT)"

  # Anchored on the key, not on the bare value: a build number is a short
  # integer that could easily equal something else in the file.
  perl -0pi -e "s/(<key>CFBundleVersion<\\/key>\\s*<string>)${CURRENT_BUILD}(<\\/string>)/\${1}${NEW_BUILD}\${2}/" "$PLIST"
  perl -0pi -e "s/(<key>CFBundleVersion<\\/key>\\s*<string>)${CURRENT_BUILD}(<\\/string>)/\${1}${NEW_BUILD}\${2}/" "$NSE_PLIST"
  perl -0pi -e "s/(CFBundleVersion:[ \\t]*\")${CURRENT_BUILD}(\")/\${1}${NEW_BUILD}\${2}/g"                        "$XCODEGEN"

  bfail=0
  bcheck() { [[ "$2" == "$NEW_BUILD" ]] || { echo "  FAILED to update $1 (still '$2')" >&2; bfail=1; }; }
  bcheck "$PLIST"     "$(read_plist_build)"
  bcheck "$NSE_PLIST" "$(read_nse_plist_build)"
  bcheck "$XCODEGEN"  "$(read_yml_build)"
  [[ $bfail -eq 0 ]] || die "one or more build numbers did not update cleanly — inspect the diff."

  echo "version-bump: build number now $NEW_BUILD in all four places"
  echo
  echo "Changed lines:"
  grep -nH -A1 '<key>CFBundleVersion</key>' "$PLIST" "$NSE_PLIST" | grep '<string>'
  grep -nH 'CFBundleVersion:' "$XCODEGEN"
  exit 0
fi

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
# Anchored on the CFBundleShortVersionString key rather than on any <string>
# equal to the version. The old form rewrote every matching string in the file,
# which was harmless only while CFBundleVersion happened to carry the same
# value; now that it holds an independent build number, a blind match would
# corrupt it the first time a build number coincided with a version.
perl -0pi -e "s/(<key>CFBundleShortVersionString<\\/key>\\s*<string>)${CUR_RE}(<\\/string>)/\${1}${NEW}\${2}/" "$PLIST"
perl -0pi -e "s/(<key>CFBundleShortVersionString<\\/key>\\s*<string>)${CUR_RE}(<\\/string>)/\${1}${NEW}\${2}/" "$NSE_PLIST"
# project.yml carries the key once per iOS target; the /g updates both, which is
# what keeps the extension's version equal to the app's. Replacing only the
# number leaves each line's own quoting style alone, and leaves the iOS
# deployment target and other dotted values in the file untouched.
perl -0pi -e "s/(CFBundleShortVersionString:[ \\t]*\"?)${CUR_RE}/\${1}${NEW}/g"                                "$XCODEGEN"

# ── Verify every file now reports the new version ──
fail=0
check() { [[ "$2" == "$NEW" ]] || { echo "  FAILED to update $1 (still '$2')" >&2; fail=1; }; }
check "$PKG_JSON"   "$(read_pkg)"
check "$TAURI_CONF" "$(read_tauri)"
check "$CARGO_TOML" "$(read_cargo)"
check "$CARGO_LOCK" "$(read_lock)"
check "$README"     "$(read_readme)"
check "$PLIST"      "$(read_plist)"
check "$NSE_PLIST"  "$(read_nse_plist)"
check "$XCODEGEN (CFBundleShortVersionString)" "$(read_yml_short)"
[[ $fail -eq 0 ]] || die "one or more files did not update cleanly — inspect the diff."

# The build number must have survived the rewrite untouched. This is the guard
# against a substitution drifting back to matching bare values: a version bump
# that silently reset the build number would be invisible here and rejected at
# the next upload, with nothing in the diff to explain it.
untouched() { [[ "$2" == "$CURRENT_BUILD" ]] || die "version bump altered the build number in $1 ('$CURRENT_BUILD' -> '$2') — it must not."; }
untouched "$PLIST"     "$(read_plist_build)"
untouched "$NSE_PLIST" "$(read_nse_plist_build)"
untouched "$XCODEGEN"  "$(read_yml_build)"

echo "version-bump: all eight files now at $NEW"
echo
echo "Changed lines:"
grep -nH -m1 '"version"' "$PKG_JSON" "$TAURI_CONF"
grep -nH    'version-'"$NEW"'-' "$README"
awk '/^\[package\]/{p=1} p&&/^version/{print FILENAME":"FNR":"$0; exit}' "$CARGO_TOML"
awk '/^name = "quark"$/{getline; print FILENAME":"FNR":"$0; exit}' "$CARGO_LOCK"
grep -nH -m1 -A1 'CFBundleShortVersionString' "$PLIST" | grep '<string>'
grep -nH 'CFBundleShortVersionString:' "$XCODEGEN"
echo "(build number left at $CURRENT_BUILD — bump it with 'bump.sh build')"
