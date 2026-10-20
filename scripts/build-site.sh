#!/usr/bin/env bash
# 把 docs/site 组装成可部署的静态站：主站在根，文档站在 docs/。
#
#   _site/index.html, _site/assets/   ← docs/site/web
#   _site/docs/*.html, _site/docs/img ← docs/site/docs
#
# 源目录里 web/ 与 docs/ 是兄弟目录，互链写的是 ../docs/、../web/；
# 部署后主站在根，这里把这些相对路径改写过来。指向仓库源文件（README、
# CONTRIBUTING、docs/protocol.md）的链接改成 GitHub 上的地址——站点上没有这些文件。
# 全部用相对路径，所以挂在任意子路径（如 https://oi8io.cn/domi/）下都能用。
#
# 用法：scripts/build-site.sh [输出目录，默认 _site]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/site"
OUT="${1:-$ROOT/_site}"
REPO="https://github.com/oi8io/domi"
BLOB="$REPO/blob/master"

rm -rf "$OUT"
mkdir -p "$OUT/docs"

cp "$SRC/web/index.html" "$OUT/"
cp -R "$SRC/web/assets" "$OUT/assets"
cp "$SRC"/docs/*.html "$OUT/docs/"
cp -R "$SRC/docs/img" "$OUT/docs/img"
touch "$OUT/.nojekyll"

# perl -pi 在 macOS 和 Linux 上行为一致（sed -i 不一致）
perl -pi -e '
  s#href="\.\./docs/#href="docs/#g;
  s#href="\.\./\.\./README\.md"#href="'"$REPO"'\#readme"#g;
' "$OUT/index.html"

perl -pi -e '
  s#"\.\./web/index\.html#"../index.html#g;
  s#"\.\./web/assets/#"../assets/#g;
  s#href="\.\./\.\./\.\./CONTRIBUTING\.md"#href="'"$BLOB"'/CONTRIBUTING.md"#g;
  s#href="\.\./\.\./protocol\.md"#href="'"$BLOB"'/docs/protocol.md"#g;
' "$OUT"/docs/*.html

# 守卫：改写后不应再有指向站点外的相对链接
if grep -nE '(href|src)="\.\./(\.\./|web/|docs/)' "$OUT/index.html" "$OUT"/docs/*.html; then
  echo "build-site: 仍有未改写的相对链接（见上）" >&2
  exit 1
fi

echo "build-site: $(find "$OUT" -type f | wc -l | tr -d ' ') 个文件 → $OUT"
