#!/bin/bash

set -euo pipefail

workflow_path=".github/workflows/deploy.yml"
timeout_seconds="${CI_WAIT_TIMEOUT_SECONDS:-1800}"
poll_seconds="${CI_WAIT_POLL_SECONDS:-10}"

notify() {
  local title="$1"
  local message="$2"

  printf '\a'
  if command -v osascript >/dev/null 2>&1; then
    MYLIB_CI_TITLE="$title" MYLIB_CI_MESSAGE="$message" \
      osascript -e 'display notification (system attribute "MYLIB_CI_MESSAGE") with title (system attribute "MYLIB_CI_TITLE") sound name "Glass"' \
      >/dev/null 2>&1 || true
  fi
}

fail() {
  notify "mylib: ошибка" "$1"
  printf '%s\n' "$1" >&2
  exit 1
}

for command_name in jj git curl jq; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Не найдена команда: $command_name"
done

remote_url="$(git remote get-url origin)"
repository="$(printf '%s' "$remote_url" | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
[[ "$repository" =~ ^[^/]+/[^/]+$ ]] || fail "Не удалось определить GitHub-репозиторий из origin: $remote_url"

github_headers=(
  -H "Accept: application/vnd.github+json"
  -H "X-GitHub-Api-Version: 2022-11-28"
)
if [[ -n "${GH_TOKEN:-}" ]]; then
  github_headers+=(-H "Authorization: Bearer $GH_TOKEN")
fi

api_get() {
  curl --fail --silent --show-error \
    --connect-timeout 10 \
    --max-time 30 \
    --retry 3 \
    --retry-delay 2 \
    "${github_headers[@]}" \
    "$1"
}

jj b a
commit_sha="$(jj --color never log -r main --no-graph -T 'commit_id ++ "\n"')"
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "Не удалось определить Git SHA bookmark main: $commit_sha"

jj git push

started_at="$(date +%s)"
runs_url="https://api.github.com/repos/$repository/actions/runs?head_sha=$commit_sha&event=push&per_page=20"
run_id=""
run_url=""

printf 'Жду запуск CI для %s' "${commit_sha:0:12}"
while [[ -z "$run_id" ]]; do
  now="$(date +%s)"
  (( now - started_at < timeout_seconds )) || fail "CI не появился за ${timeout_seconds} секунд"

  if response="$(api_get "$runs_url")"; then
    run_id="$(jq -r --arg path "$workflow_path" '[.workflow_runs[] | select(.path == $path)] | sort_by(.created_at) | last | .id // empty' <<<"$response")"
    run_url="$(jq -r --arg path "$workflow_path" '[.workflow_runs[] | select(.path == $path)] | sort_by(.created_at) | last | .html_url // empty' <<<"$response")"
  fi
  if [[ -z "$run_id" ]]; then
    printf '.'
    sleep "$poll_seconds"
  fi
done

printf '\nCI: %s\n' "$run_url"
run_api_url="https://api.github.com/repos/$repository/actions/runs/$run_id"

while true; do
  now="$(date +%s)"
  (( now - started_at < timeout_seconds )) || fail "CI не завершился за ${timeout_seconds} секунд: $run_url"

  if response="$(api_get "$run_api_url")"; then
    status="$(jq -r '.status // "unknown"' <<<"$response")"
    conclusion="$(jq -r '.conclusion // empty' <<<"$response")"
    printf '\rCI: %-12s' "$status"
    if [[ "$status" == "completed" ]]; then
      printf '\n'
      if [[ "$conclusion" == "success" ]]; then
        notify "mylib: CI завершён" "Deploy GitHub Pages прошёл успешно"
        printf 'Deploy GitHub Pages прошёл успешно.\n'
        exit 0
      fi
      fail "Deploy GitHub Pages завершился со статусом $conclusion: $run_url"
    fi
  fi
  sleep "$poll_seconds"
done
