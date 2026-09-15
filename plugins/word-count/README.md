# word-count（官方示例：tool 型 + UI 面板）

```sh
domi plugin install plugins/word-count   # 会列出：读取 **/*.md、**/*.txt
```

然后在权限规则里放行（或设为 ask）：

```yaml
permissions:
  rules:
    - name: word-count
      capability: plugin.word-count.*
      decision: ask
```
