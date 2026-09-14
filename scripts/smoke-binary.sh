#!/usr/bin/env bash
# 单二进制冒烟 —— PRD-M1-008 AC-1 / AC-2 / AC-3 / AC-4 · 守 INV-07
#
# 这个脚本回答一个问题：**把产物丢进一台什么都没装的机器，它还跑不跑得起来。**
# 所以每条命令都用 `env -i` 起 —— 没有 PATH、没有 NODE_*、没有任何模型凭据。
# 凭据这条是 INV-08：冒烟绝不发真实请求，也就不需要 key。
#
# 用法：bash scripts/smoke-binary.sh [二进制路径]   （默认 dist/domi）
set -euo pipefail

BIN="${1:-dist/domi}"
[ -x "$BIN" ] || { echo "找不到可执行的 $BIN。先跑：bun run scripts/build-binaries.ts"; exit 1; }
BIN="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")"

FAKE_HOME="$(mktemp -d)"
WORK="$(cd "$(dirname "$0")/.." && pwd)"
trap 'rm -rf "$FAKE_HOME"' EXIT

pass=0
fail=0
ok()   { pass=$((pass+1)); echo "  ✓ $1"; }
bad()  { fail=$((fail+1)); echo "  ✗ $1"; }

# 干净环境：清空 environ，只留一个假 HOME。没有 PATH 就意味着**找不到 node/bun**——
# 二进制还能跑，才算自带运行时（AC-2）。
clean() { env -i HOME="$FAKE_HOME" "$BIN" "$@"; }

echo "[smoke] $BIN"
echo "[smoke] 干净环境：无 PATH / 无 NODE_* / 无凭据；HOME=$FAKE_HOME"

echo "AC-2 · 无 Node 的干净环境里能起来"
if out="$(clean --version 2>&1)"; then
  case "$out" in
    [0-9]*) ok "--version 输出版本号：$out" ;;
    *)      bad "--version 输出不像版本号：$out" ;;
  esac
else
  bad "--version 起不来：$out"
fi
command -v node >/dev/null 2>&1 && echo "  i 本机装了 node，但上面那条是 env -i 跑的，它看不到" || true

echo "AC-3 · 首次运行是四步固定清单"
onb="$(clean 2>&1 || true)"
step=0
for n in 1 2 3 4; do
  if printf '%s' "$onb" | grep -q "第 $n 步 / 共 4 步"; then step=$((step+1)); fi
done
[ "$step" -eq 4 ] && ok "四步提示齐全且带编号" || bad "只找到 $step/4 步提示"
printf '%s' "$onb" | grep -q 'openai-compatible' && ok "第 1 步列出了本地模型的走法" || bad "第 1 步没提 openai-compatible"

echo "AC-4 · doctor 每条问题都给一条可粘贴的命令"
doc="$(clean doctor 2>&1 || true)"
probs="$(printf '%s\n' "$doc" | grep -c '^✗' || true)"
cmds="$(printf '%s\n' "$doc" | grep -cE '^\s+\$ .+' || true)"
if [ "$probs" -eq 0 ]; then
  ok "干净环境里没有报问题（也就没有命令要给）"
elif [ "$cmds" -ge "$probs" ]; then
  ok "$probs 条问题 / $cmds 条可执行命令"
else
  bad "$probs 条问题但只有 $cmds 条命令"
fi

echo "AC-1 · 其余非交互命令在干净环境里都不崩"
for cmd in "init" "--help" "session list" "prompt dump"; do
  # shellcheck disable=SC2086
  if clean $cmd >/dev/null 2>&1; then ok "domi $cmd"; else bad "domi $cmd 非零退出"; fi
done

echo "未知命令要给退出码 2，不是 0 也不是崩"
set +e
clean nosuchcommand >/dev/null 2>&1
code=$?
set -e
[ "$code" -eq 2 ] && ok "未知命令退出码 2" || bad "未知命令退出码 $code"

echo "PRD-M2-008 · 二进制里的 L1 回放也要能跑（动态 import 被打包器看见了没）"
set +e
(cd "$WORK" && env -i HOME="$FAKE_HOME" PWD="$WORK" "$BIN" eval run >/dev/null 2>&1)
code=$?
set -e
[ "$code" -eq 0 ] && ok "domi eval run 在二进制里通过" || bad "domi eval run 在二进制里退出码 $code"

echo
echo "[smoke] $pass 通过 / $fail 失败"
[ "$fail" -eq 0 ] || exit 1
