#!/usr/bin/env bash
# Deploys one Supabase project's edge functions (and, when allowed, its database migrations).
# Called only from GitHub Actions. Secrets arrive as environment variables and are never printed.
#
#   deploy-backend.sh <crm|portal> <changed|all> [base_commit]
#
#   changed  = only the functions whose folder changed since base_commit (default for a merge)
#   all      = every function in the folder (used for "Run workflow" and for rollback)
#
# Migrations run only in "changed" mode, only if migration files changed, and only if the database
# secret exists. If migration files changed but the secret is missing the run FAILS (red) on purpose,
# so a database change can never be silently skipped.
set -euo pipefail

project="${1:?project (crm or portal) required}"
mode="${2:?mode (changed or all) required}"
base="${3:-}"

case "$project" in
  crm)    ref="mtnkkeftmcfxeygkbkja"; db_url="${SUPABASE_CRM_DB_URL:-}" ;;
  portal) ref="bnrkcndpwfvuvtyrpivf"; db_url="${SUPABASE_PORTAL_DB_URL:-}" ;;
  *) echo "Unknown project: $project" >&2; exit 2 ;;
esac

: "${SUPABASE_ACCESS_TOKEN:?The SUPABASE_ACCESS_TOKEN secret is missing. See docs/HOW-DEPLOY-WORKS.md, step 3.}"

dir="backend/$project"
fdir="$dir/supabase/functions"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "## Deploy: $project ($ref), mode: $mode" >> "$summary"

# Which files changed? (all-zero base = brand new branch, treat as "everything")
changed_files=""
if [ "$mode" = "changed" ]; then
  if [ -n "$base" ] && ! [[ "$base" =~ ^0+$ ]] && git cat-file -e "$base^{commit}" 2>/dev/null; then
    changed_files="$(git diff --name-only "$base" HEAD -- "$dir" || true)"
  else
    changed_files="$(git ls-files "$dir")"
  fi
fi

# ---------- 1. Database migrations ----------
if [ "$mode" = "changed" ] && grep -q "^$dir/supabase/migrations/.*\.sql$" <<<"$changed_files"; then
  if [ -z "$db_url" ]; then
    echo "::error::Migration files changed but the database secret for '$project' is not set. Nothing was applied. See docs/HOW-DEPLOY-WORKS.md, step 4."
    echo "- FAILED: migration files changed but the database secret is missing. No functions were deployed either." >> "$summary"
    exit 1
  fi
  echo "Migrations that will be applied to $project:"
  supabase db push --remote="$db_url" --dry-run --workdir "$dir"
  echo "Applying them now ..."
  supabase db push --remote="$db_url" --yes --workdir "$dir"
  echo "- Migrations applied." >> "$summary"
else
  echo "- No migration changes." >> "$summary"
fi

# ---------- 2. Edge functions ----------
all_functions() { find "$fdir" -mindepth 1 -maxdepth 1 -type d ! -name '_*' -exec basename {} \; | sort; }

names=""
if [ "$mode" = "all" ]; then
  names="$(all_functions)"
else
  if grep -qE "^$dir/supabase/(config\.toml|functions/_[^/]+/)" <<<"$changed_files"; then
    echo "Shared settings or shared code changed, so every function is redeployed."
    names="$(all_functions)"
  else
    names="$(grep -E "^$fdir/[^_][^/]*/" <<<"$changed_files" | cut -d/ -f5 | sort -u || true)"
  fi
fi

# Only deploy folders that still exist (a deleted folder is never deleted from Supabase automatically).
deploy_list=()
for n in $names; do [ -d "$fdir/$n" ] && deploy_list+=("$n"); done

if [ "${#deploy_list[@]}" -eq 0 ]; then
  echo "No edge functions to deploy for $project."
  echo "- No functions to deploy." >> "$summary"
  exit 0
fi

echo "Deploying ${#deploy_list[@]} function(s): ${deploy_list[*]}"
supabase functions deploy "${deploy_list[@]}" --remote="$ref" --use-api --yes --workdir "$dir"
{
  echo "- Deployed ${#deploy_list[@]} function(s):"
  for n in "${deploy_list[@]}"; do echo "  - $n"; done
} >> "$summary"
