# Source after checkout, with a repository-owned stage label. Required commands
# stay visible and unconditional in the workflow. Preserve their exact exit code.
flofi_ci_stage=$(python3 scripts/ci-observe.py begin "$1")
flofi_ci_finish() {
  local status="$1"
  trap - EXIT
  if declare -F flofi_ci_cleanup >/dev/null; then
    flofi_ci_cleanup
  fi
  if ! python3 scripts/ci-observe.py finish "$flofi_ci_stage" "$status"; then
    printf 'CI reporting failed\n' >&2
    if [ "$status" -eq 0 ]; then status=1; fi
  fi
  exit "$status"
}
trap 'flofi_ci_finish "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
