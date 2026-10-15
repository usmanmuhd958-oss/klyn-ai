#!/usr/bin/env bash
# Reconcile GitHub/GitLab feature-branch history without rewriting either remote.
# Default mode is a read-only plan. Use --apply only in a trusted CI workflow or
# an operator shell with write credentials for both providers.
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/reconcile_cross_provider.sh [--dry-run|--apply] [--branch BRANCH]

Branches managed by this script:
  feat/step4-shared-memory-ipc                 (PR #82)
  feat/phase2-step2-ebpf-telemetry              (PR #83)
  feat/phase2-step3-kel-attestation             (PR #84)
  feat/phase2-step4-fs-rollback                 (PR #85)

No force-push is performed. Diverged branches are merged with both provider heads
as parents. Conflicts are aborted without pushing either branch. Each push uses
ordinary fast-forward rules. If the first provider push succeeds and the second
fails, rerunning is safe: the updated tip is fast-forwarded to the other provider.
USAGE
}
fail() { printf 'RECONCILIATION FAILED: %s\n' "$*" >&2; }
mode=dry-run
selected_branch=""
while (($#)); do
  case "$1" in
    --dry-run) mode=dry-run ;;
    --apply) mode=apply ;;
    --branch)
      (($# >= 2)) || { usage >&2; exit 2; }
      selected_branch="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

branches=(
  "feat/step4-shared-memory-ipc"
  "feat/phase2-step2-ebpf-telemetry"
  "feat/phase2-step3-kel-attestation"
  "feat/phase2-step4-fs-rollback"
)
if [[ -n "$selected_branch" ]]; then
  found=false
  for branch in "${branches[@]}"; do
    [[ "$branch" == "$selected_branch" ]] && found=true
  done
  [[ "$found" == true ]] || { usage >&2; exit 2; }
  branches=("$selected_branch")
fi

[[ -z "$(git status --porcelain --untracked-files=all)" ]] || {
  fail "working tree must be clean before reconciliation"; exit 1;
}
git remote get-url origin >/dev/null 2>&1 || { fail "origin (GitHub) remote is missing"; exit 1; }
git remote get-url gitlab >/dev/null 2>&1 || { fail "gitlab remote is missing"; exit 1; }

# A deterministic, non-personal identity for generated reconciliation commits.
git config user.name "${KLYN_RECONCILIATION_GIT_NAME:-KLYN Cross-Provider Reconciler}"
git config user.email "${KLYN_RECONCILIATION_GIT_EMAIL:-klyn-ci-reconciler@users.noreply.github.com}"

fetch_heads() {
  local branch="$1"
  git fetch --no-tags origin "refs/heads/$branch" || {
    fail "failed to fetch GitHub branch $branch"; return 1;
  }
  local github_sha
  github_sha="$(git rev-parse --verify FETCH_HEAD^{commit})" || {
    fail "GitHub fetch did not resolve to a commit for $branch"; return 1;
  }
  git fetch --no-tags gitlab "refs/heads/$branch" || {
    fail "failed to fetch GitLab branch $branch; check GIT_SSH_COMMAND/key permissions"; return 1;
  }
  local gitlab_sha
  gitlab_sha="$(git rev-parse --verify FETCH_HEAD^{commit})" || {
    fail "GitLab fetch did not resolve to a commit for $branch"; return 1;
  }
  printf '%s\n%s\n' "$github_sha" "$gitlab_sha"
}
remote_sha() {
  local remote="$1" branch="$2" value
  value="$(git ls-remote --heads "$remote" "refs/heads/$branch" | awk 'NR==1 {print $1}')"
  [[ -n "$value" ]] || { fail "cannot resolve $remote/$branch"; return 1; }
  printf '%s' "$value"
}
assert_remote_heads_unchanged() {
  local branch="$1" expected_github="$2" expected_gitlab="$3"
  local current_github current_gitlab
  current_github="$(remote_sha origin "$branch")" || return 1
  current_gitlab="$(remote_sha gitlab "$branch")" || return 1
  [[ "$current_github" == "$expected_github" ]] || {
    fail "GitHub $branch moved during reconciliation ($expected_github -> $current_github)"; return 1;
  }
  [[ "$current_gitlab" == "$expected_gitlab" ]] || {
    fail "GitLab $branch moved during reconciliation ($expected_gitlab -> $current_gitlab)"; return 1;
  }
}
failed=0
for branch in "${branches[@]}"; do
  printf '\n== %s ==\n' "$branch"
  if ! heads="$(fetch_heads "$branch")"; then
    fail "unable to fetch both heads for $branch; no update was attempted"
    failed=$((failed+1))
    continue
  fi
  github_sha="$(printf '%s\n' "$heads" | sed -n '1p')"
  gitlab_sha="$(printf '%s\n' "$heads" | sed -n '2p')"
  printf 'GitHub: %s\nGitLab: %s\n' "$github_sha" "$gitlab_sha"

  if [[ "$github_sha" == "$gitlab_sha" ]]; then
    printf 'PARITY: exact tip SHA already matches.\n'
    continue
  fi

  if git merge-base --is-ancestor "$gitlab_sha" "$github_sha"; then
    printf 'PLAN: GitLab is behind; fast-forward GitLab to GitHub %s.\n' "$github_sha"
    [[ "$mode" == apply ]] || continue
    if ! assert_remote_heads_unchanged "$branch" "$github_sha" "$gitlab_sha"; then failed=$((failed+1)); continue; fi
    if ! git push gitlab "$github_sha:refs/heads/$branch"; then
      fail "non-fast-forward GitLab update failed for $branch; no force-push attempted"; failed=$((failed+1)); continue
    fi
  elif git merge-base --is-ancestor "$github_sha" "$gitlab_sha"; then
    printf 'PLAN: GitHub is behind; fast-forward GitHub to GitLab %s.\n' "$gitlab_sha"
    [[ "$mode" == apply ]] || continue
    if ! assert_remote_heads_unchanged "$branch" "$github_sha" "$gitlab_sha"; then failed=$((failed+1)); continue; fi
    if ! git push origin "$gitlab_sha:refs/heads/$branch"; then
      fail "non-fast-forward GitHub update failed for $branch; no force-push attempted"; failed=$((failed+1)); continue
    fi
  else
    printf 'PLAN: histories diverged; create a two-parent merge commit preserving both heads.\n'
    if [[ "$mode" != apply ]]; then
      printf 'DRY RUN: no remote refs changed.\n'
      continue
    fi
    if ! assert_remote_heads_unchanged "$branch" "$github_sha" "$gitlab_sha"; then failed=$((failed+1)); continue; fi

    git switch --detach "$github_sha" >/dev/null
    if ! git merge --no-commit --no-ff "$gitlab_sha"; then
      conflict_paths="$(git diff --name-only --diff-filter=U || true)"
      git merge --abort >/dev/null 2>&1 || true
      git switch --detach "$github_sha" >/dev/null
      if [[ -n "$conflict_paths" ]]; then
        fail "merge conflict on $branch (unmerged paths: $conflict_paths); aborted safely; no refs written"
      else
        fail "git merge failed on $branch; aborted safely; no refs written"
      fi
      failed=$((failed+1)); continue
    fi

    # Normally --no-commit leaves MERGE_HEAD for this commit. If a Git version
    # nevertheless completed the merge commit, verify its ancestry instead of
    # accidentally creating a single-parent empty commit on top.
    if git rev-parse --verify -q MERGE_HEAD >/dev/null; then
      if ! git commit --allow-empty -m "ci: reconcile GitHub and GitLab history for $branch"; then
        git merge --abort >/dev/null 2>&1 || true
        git switch --detach "$github_sha" >/dev/null
        fail "could not create reconciliation merge commit for $branch; no refs written"
        failed=$((failed+1)); continue
      fi
    fi
    merged_sha="$(git rev-parse HEAD)"
    if ! git merge-base --is-ancestor "$github_sha" "$merged_sha" ||
       ! git merge-base --is-ancestor "$gitlab_sha" "$merged_sha"; then
      git merge --abort >/dev/null 2>&1 || true
      git switch --detach "$github_sha" >/dev/null
      fail "candidate reconciliation commit does not preserve both histories for $branch"
      failed=$((failed+1)); continue
    fi
    printf 'Reconciliation merge: %s\n' "$merged_sha"
    if ! git push origin "$merged_sha:refs/heads/$branch"; then
      fail "GitHub rejected the safe non-force update for $branch; GitLab was not pushed"
      failed=$((failed+1)); continue
    fi
    # If this second push fails, a subsequent run recognizes GitLab's old tip
    # as an ancestor of the GitHub merge and retries this as a fast-forward.
    if ! git push gitlab "$merged_sha:refs/heads/$branch"; then
      fail "GitHub updated but GitLab push failed for $branch; rerun to fast-forward GitLab"
      failed=$((failed+1)); continue
    fi
  fi

  final_github="$(remote_sha origin "$branch")" || { failed=$((failed+1)); continue; }
  final_gitlab="$(remote_sha gitlab "$branch")" || { failed=$((failed+1)); continue; }
  if [[ "$final_github" == "$final_gitlab" ]]; then
    printf 'PARITY VERIFIED: %s\n' "$final_github"
  else
    fail "post-push parity check failed for $branch (GitHub=$final_github GitLab=$final_gitlab)"
    failed=$((failed+1))
  fi
done

[[ "$mode" == apply ]] || {
  printf '\nDRY RUN COMPLETE: no remote branches changed.\n'
  exit 0
}
if ((failed != 0)); then
  fail "$failed branch(es) need intervention; successful fast-forward/merge operations were not force-written"
  exit 1
fi
printf '\nALL SELECTED BRANCHES HAVE EXACT GITHUB/GITLAB TIP SHA PARITY.\n'
