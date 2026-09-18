# Domi Protocol

> **本文件由 `scripts/gen-protocol-docs.ts` 生成，不要手改。** 改协议请改 `packages/protocol/src/rpc.ts`。
> 协议版本 **v1** · 传输：JSON-RPC 2.0 over stdio（本地）/ WebSocket（远程）

## 约定

- **握手必须是第一个请求**；未握手的其它请求返回 `NOT_HANDSHAKED`。
- **版本不匹配就断开，不降级**：返回 `PROTOCOL_VERSION_MISMATCH`，`data` 里带双方版本号。
- **事件推送是通知**（没有 `id`），客户端不轮询。断线重连时用 `session.subscribe` 的 `fromSeq` 断点续订。
- **daemon 是事件流的唯一写入者**，客户端只提交意图。

## 方法

### `handshake`

版本协商。不兼容时返回 PROTOCOL_VERSION_MISMATCH，不进入任何降级路径

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "protocolVersion": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "client": {
      "type": "string"
    }
  },
  "required": [
    "protocolVersion",
    "client"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "protocolVersion": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "serverVersion": {
      "type": "string"
    },
    "methods": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "protocolVersion",
    "serverVersion",
    "methods"
  ]
}
```

### `session.list`

列出会话。默认不含软删除的；includeDeleted 给回收站用；kind / projectId 过滤（PRD-M8-004）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "includeDeleted": {
      "type": "boolean"
    },
    "kind": {
      "type": "string",
      "enum": [
        "chat",
        "task"
      ]
    },
    "projectId": {
      "type": "string"
    }
  }
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "model": {
            "type": "string"
          },
          "updatedAt": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "eventCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "deleted": {
            "type": "boolean"
          },
          "parentId": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "chat",
              "task"
            ]
          },
          "projectId": {
            "type": "string"
          },
          "cwd": {
            "type": "string"
          },
          "busy": {
            "type": "boolean"
          },
          "unread": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "title",
          "model",
          "updatedAt",
          "eventCount",
          "deleted"
        ]
      }
    }
  },
  "required": [
    "sessions"
  ]
}
```

### `session.delete`

软删除会话：事件一条不删，只是不再出现在默认列表里（INV-01）。正在处理的会话不许删

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "ok"
  ]
}
```

### `session.restore`

恢复软删除的会话

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "ok"
  ]
}
```

### `session.branch`

从会话的第 atSeq 条（订阅里看到的 seq）分出一个新会话（PRD-M1-006 AC-3）。新会话带着到这一条为止的历史，之后两边各走各的，事件一条不复制；越界 → INVALID_PARAMS

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "atSeq": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "sessionId",
    "atSeq"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

### `memory.list`

列出 L3 语义记忆（PRD-M4-001）。includeDeleted 给「看看删过什么」用

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "includeDeleted": {
      "type": "boolean"
    }
  }
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "fact",
              "preference",
              "entity"
            ]
          },
          "text": {
            "type": "string"
          },
          "sourceRefs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "sessionId": {
                  "type": "string"
                },
                "seq": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 9007199254740991
                }
              },
              "required": [
                "sessionId",
                "seq"
              ]
            }
          },
          "createdAt": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "deleted": {
            "type": "boolean"
          },
          "score": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "kind",
          "text",
          "sourceRefs",
          "createdAt",
          "deleted"
        ]
      }
    }
  },
  "required": [
    "items"
  ]
}
```

### `memory.search`

检索 L3：关键词，配了 embedding 时再加语义。mode 说明实际用了哪种

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50
    }
  },
  "required": [
    "query"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "keyword",
        "semantic+keyword"
      ]
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "fact",
              "preference",
              "entity"
            ]
          },
          "text": {
            "type": "string"
          },
          "sourceRefs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "sessionId": {
                  "type": "string"
                },
                "seq": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 9007199254740991
                }
              },
              "required": [
                "sessionId",
                "seq"
              ]
            }
          },
          "createdAt": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "deleted": {
            "type": "boolean"
          },
          "score": {
            "type": "number"
          }
        },
        "required": [
          "id",
          "kind",
          "text",
          "sourceRefs",
          "createdAt",
          "deleted"
        ]
      }
    }
  },
  "required": [
    "mode",
    "items"
  ]
}
```

### `memory.delete`

删除一条 L3（追加删除事件，之后检索不到）。不存在或已删 → ok:false

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    }
  },
  "required": [
    "id"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ]
}
```

### `memory.extract`

立刻从某个会话抽取 L3（不等攒够轮数），有新条目时顺带更新 Soul

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "added": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "fact",
              "preference",
              "entity"
            ]
          },
          "text": {
            "type": "string"
          },
          "sourceRefs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "sessionId": {
                  "type": "string"
                },
                "seq": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 9007199254740991
                }
              },
              "required": [
                "sessionId",
                "seq"
              ]
            }
          }
        },
        "required": [
          "id",
          "kind",
          "text",
          "sourceRefs"
        ]
      }
    },
    "soulChanges": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "section": {
            "type": "string",
            "enum": [
              "工作习惯",
              "技术偏好",
              "沟通风格",
              "领域知识",
              "对用户的模型",
              "失败教训"
            ]
          },
          "op": {
            "type": "string",
            "enum": [
              "add",
              "update",
              "remove"
            ]
          },
          "before": {
            "type": "string"
          },
          "after": {
            "type": "string"
          },
          "sources": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "id",
          "section",
          "op",
          "sources"
        ]
      }
    }
  },
  "required": [
    "added",
    "soulChanges"
  ]
}
```

### `soul.get`

Soul 的全文（Markdown）与它在 daemon 机器上的路径（PRD-M4-002）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "text": {
      "type": "string"
    },
    "mtime": {
      "type": "number"
    }
  },
  "required": [
    "path",
    "text"
  ]
}
```

### `soul.write`

保存编辑后的 Soul（PRD-M8-012 AC-5）。等同于手改文件：改过或没有来源注释的行，domi 之后不再动（M4-003）。给了 mtime 而文件在那之后被改过 → INVALID_PARAMS（data.reason = CONFLICT），不覆盖

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "maxLength": 200000
    },
    "mtime": {
      "type": "number"
    }
  },
  "required": [
    "text"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    },
    "mtime": {
      "type": "number"
    }
  },
  "required": [
    "ok",
    "mtime"
  ]
}
```

### `soul.export`

导出成单个 Markdown（M4-004，去掉来源注释）。findings 非空时不该分享：里面有凭据、本机路径或邮箱

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "text": {
      "type": "string"
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "line": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "kind": {
            "type": "string"
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "line",
          "kind",
          "text"
        ]
      }
    }
  },
  "required": [
    "text",
    "findings"
  ]
}
```

### `soul.import`

导入别人的 Soul（M4-004）。不给 sections 时只返回每区要新增的行（预览）；给了就只导入这些区，导入的行作为待审阅改动出现在 soul.changes 里，可以逐条否决。导入的文字只作参考资料，不当指令

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "maxLength": 200000
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "text",
    "name"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "plans": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "section": {
            "type": "string"
          },
          "add": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "section",
          "add"
        ]
      }
    },
    "imported": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "plans",
    "imported"
  ]
}
```

### `soul.changes`

上次审阅以来 Soul 的改动（PRD-M4-003 AC-2）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "section": {
            "type": "string",
            "enum": [
              "工作习惯",
              "技术偏好",
              "沟通风格",
              "领域知识",
              "对用户的模型",
              "失败教训"
            ]
          },
          "op": {
            "type": "string",
            "enum": [
              "add",
              "update",
              "remove"
            ]
          },
          "before": {
            "type": "string"
          },
          "after": {
            "type": "string"
          },
          "sources": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "at": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "diff": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "section",
          "op",
          "sources",
          "at",
          "diff"
        ]
      }
    }
  },
  "required": [
    "changes"
  ]
}
```

### `soul.review`

接受或否决一处改动。否决会撤回文件里的那一处并记进 .rejected，之后不再提议（AC-3）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "changeId": {
      "type": "string"
    },
    "decision": {
      "type": "string",
      "enum": [
        "accept",
        "reject"
      ]
    }
  },
  "required": [
    "changeId",
    "decision"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    },
    "detail": {
      "type": "string"
    }
  },
  "required": [
    "ok",
    "detail"
  ]
}
```

### `soul.update`

用现有的全部 L3 条目重新过一遍 Soul（一次最多改 10 处）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "section": {
            "type": "string",
            "enum": [
              "工作习惯",
              "技术偏好",
              "沟通风格",
              "领域知识",
              "对用户的模型",
              "失败教训"
            ]
          },
          "op": {
            "type": "string",
            "enum": [
              "add",
              "update",
              "remove"
            ]
          },
          "before": {
            "type": "string"
          },
          "after": {
            "type": "string"
          },
          "sources": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "id",
          "section",
          "op",
          "sources"
        ]
      }
    }
  },
  "required": [
    "changes"
  ]
}
```

### `task.start`

开始一次 DAG 运行（PRD-M5-002）。spec 是 YAML 原文；不合法（含环）→ INVALID_PARAMS，什么都不落。返回的 runId 就是运行会话的 id，订阅它就能看到 task.* 事件

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "spec": {
      "type": "string",
      "minLength": 1
    },
    "cwd": {
      "type": "string"
    }
  },
  "required": [
    "spec"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "runId": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "runId",
    "name",
    "nodes"
  ]
}
```

### `task.list`

列出运行（最近的在前）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "runs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "runId": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "running",
              "done",
              "failed",
              "cancelled"
            ]
          },
          "updatedAt": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "runId",
          "name",
          "status",
          "updatedAt"
        ]
      }
    }
  },
  "required": [
    "runs"
  ]
}
```

### `task.get`

一次运行的各节点状态（事件的投影，PRD-M5-002 AC-3）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "runId": {
      "type": "string"
    }
  },
  "required": [
    "runId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "runId": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "running",
        "done",
        "failed",
        "cancelled"
      ]
    },
    "active": {
      "type": "boolean"
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "type": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "needs": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "running",
              "done",
              "failed",
              "blocked"
            ]
          },
          "attempt": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "output": {
            "type": "string"
          },
          "error": {
            "type": "string"
          },
          "sessionId": {
            "type": "string"
          },
          "ms": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "id",
          "type",
          "needs",
          "status",
          "attempt"
        ]
      }
    }
  },
  "required": [
    "runId",
    "name",
    "status",
    "active",
    "nodes"
  ]
}
```

### `task.retry`

只重跑一个失败节点及其被挡住的下游，已完成的不动（AC-4）。运行还在跑或节点不是失败 → INVALID_PARAMS

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "runId": {
      "type": "string"
    },
    "nodeId": {
      "type": "string"
    }
  },
  "required": [
    "runId",
    "nodeId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "ok"
  ]
}
```

### `task.cancel`

取消一次还在跑的运行。已经结束的返回 ok:false

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "runId": {
      "type": "string"
    }
  },
  "required": [
    "runId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ]
}
```

### `plugin.list`

已安装的插件、它们提供的东西、没加载上的原因，以及这台机器的沙箱（PRD-M6-001 / 003）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sandbox": {
      "type": "string",
      "enum": [
        "bwrap",
        "sandbox-exec",
        "none"
      ]
    },
    "plugins": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "tools": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "skills": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "mcp": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "ui": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "title": {
                  "type": "string"
                }
              },
              "required": [
                "id",
                "title"
              ]
            }
          },
          "enabled": {
            "type": "boolean"
          }
        },
        "required": [
          "name",
          "version",
          "description",
          "tools",
          "skills",
          "mcp",
          "ui"
        ]
      }
    },
    "problems": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "message": {
            "type": "string"
          }
        },
        "required": [
          "name",
          "message"
        ]
      }
    }
  },
  "required": [
    "sandbox",
    "plugins",
    "problems"
  ]
}
```

### `plugin.ui`

插件 UI 面板的 HTML。客户端必须放进无同源的沙箱 iframe（sandbox="allow-scripts"）里渲染

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "plugin": {
      "type": "string"
    },
    "id": {
      "type": "string"
    }
  },
  "required": [
    "plugin",
    "id"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "html": {
      "type": "string"
    }
  },
  "required": [
    "html"
  ]
}
```

### `audit.record`

端上发生、daemon 看不到的安全相关事情（比如桥接收到未绑定 chat 的消息），记进审计会话（M5-007 AC-4）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "kind": {
      "type": "string",
      "maxLength": 60,
      "pattern": "^[a-z0-9_.-]+$"
    },
    "detail": {
      "type": "string",
      "maxLength": 500
    }
  },
  "required": [
    "kind",
    "detail"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "ok"
  ]
}
```

### `session.switchModel`

会话中途切换模型（PRD-M1-002）。只追加一条 model.switch，历史不动；返回会失去的能力

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "model": {
      "type": "string",
      "minLength": 1
    },
    "provider": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "sessionId",
    "model"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "lost": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "lost"
  ]
}
```

### `review.start`

派一个只读的审阅会话（PRD-M7-010）：输入是相对 base 的 diff 与需求文档，不带任何会话历史。立刻返回会话 id，发现以 review.findings 事件出现

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "cwd": {
      "type": "string"
    },
    "base": {
      "type": "string"
    },
    "specs": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "fromSessionId": {
      "type": "string"
    }
  }
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

### `session.rename`

改会话标题（PRD-M8-008 AC-4）。只改列表里的元数据，不进事件流

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    }
  },
  "required": [
    "sessionId",
    "title"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "ok"
  ]
}
```

### `session.toTask`

自由会话转任务（PRD-M8-004 AC-4）：在项目下新建任务，首条输入是 goal 并引用原会话全文；原会话一条事件不动。返回新任务的会话 id

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "projectId": {
      "type": "string"
    },
    "goal": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "sessionId",
    "projectId",
    "goal"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

### `task.create`

按目标新建任务（PRD-M8-005）：在项目下建任务会话，按项目设置决定要不要隔离（PRD-M8-006），目标较长或项目要求时先规划（计划模式），然后把目标作为第一句话提交。返回会话 id 与隔离决定

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "projectId": {
      "type": "string"
    },
    "goal": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "projectId",
    "goal"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "isolation": {
      "type": "object",
      "properties": {
        "isolate": {
          "type": "boolean"
        },
        "reason": {
          "type": "string"
        }
      },
      "required": [
        "isolate",
        "reason"
      ]
    },
    "planned": {
      "type": "boolean"
    }
  },
  "required": [
    "sessionId",
    "isolation",
    "planned"
  ]
}
```

### `usage.summary`

按时间窗口汇总用量（PRD-M8-013）：tokens、花费、会话数、cache 命中率、工具调用、权限询问，另给按模型与按月的明细。只从事件投影；整月的结果会缓存，当月每次现算

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "from": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "to": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "from",
    "to"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "tokens": {
      "type": "object",
      "properties": {
        "input": {
          "type": "number"
        },
        "output": {
          "type": "number"
        },
        "cacheRead": {
          "type": "number"
        }
      },
      "required": [
        "input",
        "output",
        "cacheRead"
      ]
    },
    "costUsd": {
      "type": [
        "number",
        "null"
      ]
    },
    "unpricedModels": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "sessions": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "turns": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "toolCalls": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "asks": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "cacheHitPercent": {
      "type": [
        "number",
        "null"
      ]
    },
    "from": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "to": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "byModel": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "tokens": {
            "type": "object",
            "properties": {
              "input": {
                "type": "number"
              },
              "output": {
                "type": "number"
              },
              "cacheRead": {
                "type": "number"
              }
            },
            "required": [
              "input",
              "output",
              "cacheRead"
            ]
          },
          "costUsd": {
            "type": [
              "number",
              "null"
            ]
          },
          "unpricedModels": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "sessions": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "turns": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "toolCalls": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "asks": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "cacheHitPercent": {
            "type": [
              "number",
              "null"
            ]
          },
          "model": {
            "type": "string"
          },
          "provider": {
            "type": "string"
          }
        },
        "required": [
          "tokens",
          "costUsd",
          "unpricedModels",
          "sessions",
          "turns",
          "toolCalls",
          "asks",
          "cacheHitPercent",
          "model",
          "provider"
        ]
      }
    },
    "byMonth": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "tokens": {
            "type": "object",
            "properties": {
              "input": {
                "type": "number"
              },
              "output": {
                "type": "number"
              },
              "cacheRead": {
                "type": "number"
              }
            },
            "required": [
              "input",
              "output",
              "cacheRead"
            ]
          },
          "costUsd": {
            "type": [
              "number",
              "null"
            ]
          },
          "unpricedModels": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "sessions": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "turns": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "toolCalls": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "asks": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "cacheHitPercent": {
            "type": [
              "number",
              "null"
            ]
          },
          "month": {
            "type": "string"
          }
        },
        "required": [
          "tokens",
          "costUsd",
          "unpricedModels",
          "sessions",
          "turns",
          "toolCalls",
          "asks",
          "cacheHitPercent",
          "month"
        ]
      }
    }
  },
  "required": [
    "tokens",
    "costUsd",
    "unpricedModels",
    "sessions",
    "turns",
    "toolCalls",
    "asks",
    "cacheHitPercent",
    "from",
    "to",
    "byModel",
    "byMonth"
  ]
}
```

### `fs.list`

会话工作目录下的文件清单（PRD-M8-010 AC-2，`@` 引用用）：遵守 .gitignore，按 query 模糊匹配。只给路径不给内容，不经权限询问

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "query": {
      "type": "string"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200
    }
  },
  "required": [
    "sessionId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "truncated": {
      "type": "boolean"
    }
  },
  "required": [
    "files",
    "truncated"
  ]
}
```

### `attachment.put`

上传一个附件（PRD-M8-010 AC-3），存到 ~/.domi/attachments/<会话>/。返回的 id 在 session.submit 的 uploads 里用。超过单个上限（config attachments.maxMB，默认 20）→ INVALID_PARAMS，data.reason = TOO_LARGE

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255
    },
    "mime": {
      "type": "string",
      "maxLength": 255
    },
    "dataBase64": {
      "type": "string"
    }
  },
  "required": [
    "sessionId",
    "name",
    "mime",
    "dataBase64"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "mime": {
      "type": "string"
    },
    "size": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "sha256": {
      "type": "string"
    }
  },
  "required": [
    "id",
    "name",
    "mime",
    "size",
    "sha256"
  ]
}
```

### `skill.list`

可以指定的技能（PRD-M8-010 AC-4）。给 sessionId 时含该会话仓库里的项目技能

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  }
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "source": {
            "type": "string"
          }
        },
        "required": [
          "name",
          "description",
          "source"
        ]
      }
    }
  },
  "required": [
    "skills"
  ]
}
```

### `model.list`

可选的模型（PRD-M8-010 AC-5）：配了凭据的供应商 × 已知的模型名（配置 + 价目表），带能力；current 是默认模型

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "models": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "provider": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "vision": {
            "type": "boolean"
          },
          "toolCall": {
            "type": "boolean"
          }
        },
        "required": [
          "provider",
          "name",
          "vision",
          "toolCall"
        ]
      }
    },
    "current": {
      "type": "object",
      "properties": {
        "provider": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "provider",
        "name"
      ]
    }
  },
  "required": [
    "models",
    "current"
  ]
}
```

### `schedule.list`

定时任务列表（PRD-M8-007），带下一次运行时间与最近一次触发

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "schedules": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "projectId": {
            "type": "string"
          },
          "goal": {
            "type": "string"
          },
          "cron": {
            "type": "string"
          },
          "tz": {
            "type": "string"
          },
          "paused": {
            "type": "boolean"
          },
          "createdAt": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "nextRun": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "lastRun": {
            "type": "object",
            "properties": {
              "due": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "firedAt": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "sessionId": {
                "type": "string"
              },
              "skipped": {
                "type": "boolean"
              }
            },
            "required": [
              "due",
              "firedAt",
              "skipped"
            ]
          }
        },
        "required": [
          "id",
          "projectId",
          "goal",
          "cron",
          "tz",
          "paused",
          "createdAt",
          "nextRun"
        ]
      }
    }
  },
  "required": [
    "schedules"
  ]
}
```

### `schedule.create`

新建定时任务：项目 + 目标 + 5 段 cron + 时区（缺省 domid 所在时区）。cron / 时区不合法 → INVALID_PARAMS，data = { reason: "INVALID_CRON", field }，message 指出哪一段

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "projectId": {
      "type": "string"
    },
    "goal": {
      "type": "string",
      "minLength": 1
    },
    "cron": {
      "type": "string",
      "minLength": 1
    },
    "tz": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "projectId",
    "goal",
    "cron"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "schedule": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "goal": {
          "type": "string"
        },
        "cron": {
          "type": "string"
        },
        "tz": {
          "type": "string"
        },
        "paused": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "nextRun": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "lastRun": {
          "type": "object",
          "properties": {
            "due": {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            "firedAt": {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            "sessionId": {
              "type": "string"
            },
            "skipped": {
              "type": "boolean"
            }
          },
          "required": [
            "due",
            "firedAt",
            "skipped"
          ]
        }
      },
      "required": [
        "id",
        "projectId",
        "goal",
        "cron",
        "tz",
        "paused",
        "createdAt",
        "nextRun"
      ]
    }
  },
  "required": [
    "schedule"
  ]
}
```

### `schedule.update`

改目标 / 时间表 / 暂停与恢复。改了时间表或恢复时从此刻重新算，不补之前错过的

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "goal": {
      "type": "string",
      "minLength": 1
    },
    "cron": {
      "type": "string",
      "minLength": 1
    },
    "tz": {
      "type": "string",
      "minLength": 1
    },
    "paused": {
      "type": "boolean"
    }
  },
  "required": [
    "id"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "schedule": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "goal": {
          "type": "string"
        },
        "cron": {
          "type": "string"
        },
        "tz": {
          "type": "string"
        },
        "paused": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "nextRun": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "lastRun": {
          "type": "object",
          "properties": {
            "due": {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            "firedAt": {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            "sessionId": {
              "type": "string"
            },
            "skipped": {
              "type": "boolean"
            }
          },
          "required": [
            "due",
            "firedAt",
            "skipped"
          ]
        }
      },
      "required": [
        "id",
        "projectId",
        "goal",
        "cron",
        "tz",
        "paused",
        "createdAt",
        "nextRun"
      ]
    }
  },
  "required": [
    "schedule"
  ]
}
```

### `schedule.delete`

删除定时任务（历史运行建出的任务不动）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    }
  },
  "required": [
    "id"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ]
}
```

### `schedule.runNow`

立即运行一次（不影响之后的时间表）。上一次还没结束 → SESSION_BUSY

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    }
  },
  "required": [
    "id"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

### `schedule.runs`

某个定时任务的历史触发，新的在前

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200
    }
  },
  "required": [
    "id"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "runs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "sessionId": {
            "type": "string"
          },
          "due": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "firedAt": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "late": {
            "type": "boolean"
          },
          "skipped": {
            "type": "boolean"
          },
          "status": {
            "type": "string",
            "enum": [
              "running",
              "done",
              "skipped",
              "failed"
            ]
          }
        },
        "required": [
          "due",
          "firedAt",
          "late",
          "skipped",
          "status"
        ]
      }
    }
  },
  "required": [
    "runs"
  ]
}
```

### `schedule.preview`

校验 cron 与时区并给出接下来几次运行时间（表单预览用）。不合法同 schedule.create

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "cron": {
      "type": "string",
      "minLength": 1
    },
    "tz": {
      "type": "string",
      "minLength": 1
    },
    "count": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10
    }
  },
  "required": [
    "cron"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "nextRuns": {
      "type": "array",
      "items": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
      }
    },
    "tz": {
      "type": "string"
    }
  },
  "required": [
    "nextRuns",
    "tz"
  ]
}
```

### `project.list`

列出项目（PRD-M8-003），按最近活动排序。recent：每个项目带几个最近任务（默认 5）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "includeArchived": {
      "type": "boolean"
    },
    "recent": {
      "type": "integer",
      "minimum": 0,
      "maximum": 50
    }
  }
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "projects": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "path": {
            "type": "string"
          },
          "createdAt": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "archived": {
            "type": "boolean"
          },
          "taskCount": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "lastActivity": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "settings": {
            "type": "object",
            "properties": {
              "isolation": {
                "default": "auto",
                "type": "string",
                "enum": [
                  "auto",
                  "always",
                  "never"
                ]
              },
              "planReview": {
                "default": "auto",
                "type": "string",
                "enum": [
                  "auto",
                  "always",
                  "never"
                ]
              }
            }
          },
          "recentTasks": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "title": {
                  "type": "string"
                },
                "busy": {
                  "type": "boolean"
                },
                "updatedAt": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                }
              },
              "required": [
                "id",
                "title",
                "busy",
                "updatedAt"
              ]
            }
          }
        },
        "required": [
          "id",
          "name",
          "path",
          "createdAt",
          "archived",
          "taskCount",
          "lastActivity",
          "settings",
          "recentTasks"
        ]
      }
    }
  },
  "required": [
    "projects"
  ]
}
```

### `project.create`

登记项目。path 必须是已存在的目录（同一目录只登记一次，重复登记返回已有的）；name 缺省取目录名

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "minLength": 1
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "path"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "project": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "path": {
          "type": "string"
        },
        "createdAt": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "archived": {
          "type": "boolean"
        },
        "taskCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "lastActivity": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "settings": {
          "type": "object",
          "properties": {
            "isolation": {
              "default": "auto",
              "type": "string",
              "enum": [
                "auto",
                "always",
                "never"
              ]
            },
            "planReview": {
              "default": "auto",
              "type": "string",
              "enum": [
                "auto",
                "always",
                "never"
              ]
            }
          }
        },
        "recentTasks": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "busy": {
                "type": "boolean"
              },
              "updatedAt": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "id",
              "title",
              "busy",
              "updatedAt"
            ]
          }
        }
      },
      "required": [
        "id",
        "name",
        "path",
        "createdAt",
        "archived",
        "taskCount",
        "lastActivity",
        "settings",
        "recentTasks"
      ]
    }
  },
  "required": [
    "project"
  ]
}
```

### `project.update`

改项目名或设置

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "settings": {
      "type": "object",
      "properties": {
        "isolation": {
          "default": "auto",
          "type": "string",
          "enum": [
            "auto",
            "always",
            "never"
          ]
        },
        "planReview": {
          "default": "auto",
          "type": "string",
          "enum": [
            "auto",
            "always",
            "never"
          ]
        }
      }
    }
  },
  "required": [
    "id"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "project": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "path": {
          "type": "string"
        },
        "createdAt": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "archived": {
          "type": "boolean"
        },
        "taskCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "lastActivity": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "settings": {
          "type": "object",
          "properties": {
            "isolation": {
              "default": "auto",
              "type": "string",
              "enum": [
                "auto",
                "always",
                "never"
              ]
            },
            "planReview": {
              "default": "auto",
              "type": "string",
              "enum": [
                "auto",
                "always",
                "never"
              ]
            }
          }
        },
        "recentTasks": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "busy": {
                "type": "boolean"
              },
              "updatedAt": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "id",
              "title",
              "busy",
              "updatedAt"
            ]
          }
        }
      },
      "required": [
        "id",
        "name",
        "path",
        "createdAt",
        "archived",
        "taskCount",
        "lastActivity",
        "settings",
        "recentTasks"
      ]
    }
  },
  "required": [
    "project"
  ]
}
```

### `project.archive`

归档 / 取消归档。归档的项目不出现在默认列表里，它的任务仍在

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "archived": {
      "type": "boolean"
    }
  },
  "required": [
    "id",
    "archived"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "ok"
  ]
}
```

### `project.resolve`

这个目录属于哪个项目（PRD-M8-017）。只判断不登记：projectLike = 是 git 仓库或有 AGENT.md，root = 按这个目录建项目时会用的路径

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "cwd": {
      "type": "string"
    }
  },
  "required": [
    "cwd"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "project": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "path": {
          "type": "string"
        },
        "createdAt": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "archived": {
          "type": "boolean"
        },
        "taskCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "lastActivity": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "settings": {
          "type": "object",
          "properties": {
            "isolation": {
              "default": "auto",
              "type": "string",
              "enum": [
                "auto",
                "always",
                "never"
              ]
            },
            "planReview": {
              "default": "auto",
              "type": "string",
              "enum": [
                "auto",
                "always",
                "never"
              ]
            }
          }
        },
        "recentTasks": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "busy": {
                "type": "boolean"
              },
              "updatedAt": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "id",
              "title",
              "busy",
              "updatedAt"
            ]
          }
        }
      },
      "required": [
        "id",
        "name",
        "path",
        "createdAt",
        "archived",
        "taskCount",
        "lastActivity",
        "settings",
        "recentTasks"
      ]
    },
    "projectLike": {
      "type": "boolean"
    },
    "root": {
      "type": "string"
    }
  },
  "required": [
    "projectLike",
    "root"
  ]
}
```

### `config.get`

设置页要显示的配置（PRD-M8-011 AC-1）：白名单里各键的当前值，各家 key 只给掩码与来源（env / secrets / config），绝不回原文

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "values": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "secrets": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {
        "type": "object",
        "properties": {
          "set": {
            "type": "boolean"
          },
          "masked": {
            "type": "string"
          },
          "source": {
            "type": "string",
            "enum": [
              "env",
              "secrets",
              "config"
            ]
          }
        },
        "required": [
          "set"
        ]
      }
    },
    "providers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "vendor": {
            "type": "string"
          },
          "protocol": {
            "type": "string",
            "enum": [
              "openai",
              "anthropic"
            ]
          },
          "baseUrl": {
            "type": [
              "string",
              "null"
            ]
          },
          "enabled": {
            "type": "boolean"
          },
          "models": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "capabilities": {
            "type": "object",
            "properties": {
              "toolCall": {
                "type": "boolean"
              },
              "vision": {
                "type": "boolean"
              },
              "reasoning": {
                "type": "boolean"
              },
              "promptCache": {
                "type": "boolean"
              },
              "structuredOutput": {
                "type": "boolean"
              }
            }
          },
          "inferred": {
            "type": "boolean"
          },
          "isDefault": {
            "type": "boolean"
          },
          "key": {
            "type": "object",
            "properties": {
              "set": {
                "type": "boolean"
              },
              "masked": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "env",
                  "secrets",
                  "config"
                ]
              }
            },
            "required": [
              "set"
            ]
          }
        },
        "required": [
          "id",
          "name",
          "vendor",
          "protocol",
          "baseUrl",
          "enabled",
          "models",
          "capabilities",
          "inferred",
          "isDefault",
          "key"
        ]
      }
    },
    "paths": {
      "type": "object",
      "properties": {
        "config": {
          "type": "string"
        },
        "secrets": {
          "type": "string"
        }
      },
      "required": [
        "config",
        "secrets"
      ]
    },
    "secretsTooOpen": {
      "type": "boolean"
    },
    "writable": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "values",
    "secrets",
    "providers",
    "paths",
    "secretsTooOpen",
    "writable"
  ]
}
```

### `provider.vendors`

厂商模板（PRD-M9-002 AC-2 / AC-4）：新增 provider 时选哪一家、默认协议 / 地址 / 能力。只读，没有任何凭据；界面不自己写一份厂商名单

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "vendors": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "protocol": {
            "type": "string",
            "enum": [
              "openai",
              "anthropic"
            ]
          },
          "defaultBaseUrl": {
            "type": "string"
          },
          "capabilities": {
            "type": "object",
            "properties": {
              "toolCall": {
                "type": "boolean"
              },
              "vision": {
                "type": "boolean"
              },
              "reasoning": {
                "type": "boolean"
              },
              "promptCache": {
                "type": "boolean"
              },
              "structuredOutput": {
                "type": "boolean"
              }
            },
            "required": [
              "toolCall",
              "vision",
              "reasoning",
              "promptCache",
              "structuredOutput"
            ]
          },
          "keyHint": {
            "type": "string"
          },
          "envNames": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "id",
          "label",
          "protocol",
          "capabilities",
          "keyHint",
          "envNames"
        ]
      }
    }
  },
  "required": [
    "vendors"
  ]
}
```

### `config.set`

改配置（PRD-M8-011 AC-2 / AC-3）。patch 的键是 config.get 的 writable 里的点分路径，值为 null 表示删掉；有一个键不在白名单就整体拒绝（INVALID_PARAMS），文件不动。key 写进 secrets.yaml。改完下一轮生效；restartRequired 列出要重启 domid 才生效的键。provider 按 providers.<id>.<字段> 改，providers.<id>: null 删整条（连同 key）；默认模型所在的那一家停用 / 删除 → INVALID_PARAMS，data.reason = DEFAULT_PROVIDER（PRD-M9-002）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "patch": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    }
  },
  "required": [
    "patch"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    },
    "restartRequired": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "ok",
    "restartRequired"
  ]
}
```

### `session.budget`

设这个会话的用量上限（PRD-M7-009）：到 80% 提醒，到顶暂停问人。落成 budget.decided，重开会话后照样生效

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "budget": {
      "type": "object",
      "properties": {
        "tokens": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "costUsd": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "toolCalls": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "sessionId",
    "budget"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "ok"
  ]
}
```

### `session.mode`

切换计划模式 / 执行模式（PRD-M7-005）。只追加一条 mode.switch；和当前一样时什么都不写

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "mode": {
      "type": "string",
      "enum": [
        "plan",
        "act"
      ]
    }
  },
  "required": [
    "sessionId",
    "mode"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "plan",
        "act"
      ]
    },
    "changed": {
      "type": "boolean"
    }
  },
  "required": [
    "mode",
    "changed"
  ]
}
```

### `session.create`

新建会话。isolate：在 cwd 所在的 git 仓库里建隔离工作区（PRD-M7-006），会话在 worktree 里干活。kind（PRD-M8-004）：chat = 不属于任何项目，工作目录是 ~/.domi/scratch/<会话>；task = 属于 projectId 或 cwd 所在的项目（没登记就自动登记）。不给 kind 时：给了 projectId、或 cwd 在已登记项目里 / 是 git 仓库 / 有 AGENT.md，就是 task；否则是 chat（PRD-M8-017 AC-1）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "cwd": {
      "type": "string"
    },
    "isolate": {
      "type": "boolean"
    },
    "kind": {
      "type": "string",
      "enum": [
        "chat",
        "task"
      ]
    },
    "projectId": {
      "type": "string"
    }
  }
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "worktree": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "branch": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "branch"
      ]
    }
  },
  "required": [
    "sessionId"
  ]
}
```

### `worktree.diff`

隔离会话相对起点的改动，按文件（含未跟踪文件）。不是隔离会话 → INVALID_PARAMS

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "repo": {
      "type": "string"
    },
    "branch": {
      "type": "string"
    },
    "base": {
      "type": "string"
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "added",
              "modified",
              "deleted",
              "renamed"
            ]
          },
          "patch": {
            "type": "string"
          },
          "truncated": {
            "type": "boolean"
          }
        },
        "required": [
          "path",
          "status",
          "patch"
        ]
      }
    }
  },
  "required": [
    "repo",
    "branch",
    "base",
    "files"
  ]
}
```

### `worktree.discard`

丢弃一个文件的改动（恢复成起点）。内容先进回收站，返回编号，可以用 worktree.restore 撤销

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "path": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "sessionId",
    "path"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "trash": {
      "type": "string"
    }
  },
  "required": [
    "trash"
  ]
}
```

### `worktree.restore`

撤销一次丢弃

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "trash": {
      "type": "string"
    }
  },
  "required": [
    "sessionId",
    "trash"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    }
  },
  "required": [
    "path"
  ]
}
```

### `worktree.apply`

把改动带回原仓库：squash（默认，压成一个提交）/ merge / branch（只留分支）。会先问人（worktree.apply 询问），没批准原仓库一个字节不动

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "mode": {
      "type": "string",
      "enum": [
        "squash",
        "merge",
        "branch"
      ]
    },
    "message": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "sessionId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    },
    "commit": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "ok",
    "message"
  ]
}
```

### `session.read`

报告已读到哪里（PRD-M8-009 AC-2）：seq 是视图编号，只往前推。客户端在会话可见且看到底时发（节流），推进了会给所有连接发 sessions.changed

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "seq": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "sessionId",
    "seq"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "changed": {
      "type": "boolean"
    }
  },
  "required": [
    "changed"
  ]
}
```

### `session.submit`

提交一次用户输入。同一会话串行处理，正忙时返回 SESSION_BUSY 而不是静默丢弃。refs 引用其他会话的片段（PRD-M3-005）：接受之前校验，会话不存在或起点越界 → INVALID_PARAMS；终点超出时截到末尾。uploads / files / skills（PRD-M8-010）同样先校验：附件不存在、文件不在工作目录里、技能不存在、当前模型不支持图片 → INVALID_PARAMS，data.reason 为 NOT_FOUND / INVALID / UNSUPPORTED_ATTACHMENT

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "text": {
      "type": "string"
    },
    "refs": {
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "sessionId": {
            "type": "string"
          },
          "fromSeq": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "toSeq": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "sessionId",
          "fromSeq",
          "toSeq"
        ]
      }
    },
    "uploads": {
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "files": {
      "maxItems": 50,
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "skills": {
      "maxItems": 10,
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "sessionId",
    "text"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "accepted": {
      "type": "boolean",
      "const": true
    }
  },
  "required": [
    "accepted"
  ]
}
```

### `session.subscribe`

订阅事件流。fromSeq 是**断点续订**的锚点：给上次收到的最后一个 seq，不重不漏。分支会话的 seq 是**视图编号**：父链到分叉点的那一段排在前面、从 1 连续编下来，自己的事件接在后面

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "fromSeq": {
      "default": 0,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "sessionId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "head": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "head"
  ]
}
```

### `session.answer`

回答一次权限询问。askId 不存在（已被别的客户端答过）时返回 ok:false

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "askId": {
      "type": "string"
    },
    "allowed": {
      "type": "boolean"
    },
    "content": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "channel": {
      "type": "string",
      "maxLength": 40
    },
    "grant": {
      "type": "boolean"
    }
  },
  "required": [
    "askId",
    "allowed"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ]
}
```

### `session.compact`

手动触发上下文压缩（PRD-M2-003 AC-1 的 /compact）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ]
}
```

**result**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean"
    },
    "detail": {
      "type": "string"
    }
  },
  "required": [
    "ok",
    "detail"
  ]
}
```

## 通知（服务端 → 客户端）

### `session.events`

事件流增量推送

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "seq": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "sessionId": {
            "type": "string"
          },
          "parentSeq": {
            "anyOf": [
              {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "ts": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "schemaVersion": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "ev": {
            "anyOf": [
              {
                "oneOf": [
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "user.input"
                      },
                      "text": {
                        "type": "string"
                      },
                      "attachments": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "kind": {
                              "type": "string"
                            },
                            "id": {
                              "type": "string"
                            }
                          },
                          "required": [
                            "kind",
                            "id"
                          ]
                        }
                      },
                      "uploads": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "id": {
                              "type": "string"
                            },
                            "name": {
                              "type": "string"
                            },
                            "mime": {
                              "type": "string"
                            },
                            "size": {
                              "type": "integer",
                              "minimum": 0,
                              "maximum": 9007199254740991
                            }
                          },
                          "required": [
                            "id",
                            "name",
                            "mime",
                            "size"
                          ]
                        }
                      },
                      "files": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "skills": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    },
                    "required": [
                      "t",
                      "text"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "model.request"
                      },
                      "provider": {
                        "type": "string"
                      },
                      "model": {
                        "type": "string"
                      },
                      "tokensIn": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      }
                    },
                    "required": [
                      "t",
                      "provider",
                      "model",
                      "tokensIn"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "model.delta"
                      },
                      "text": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "text"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "model.reason"
                      },
                      "text": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "text"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "model.usage"
                      },
                      "raw": {
                        "type": "object",
                        "propertyNames": {
                          "type": "string"
                        },
                        "additionalProperties": {}
                      }
                    },
                    "required": [
                      "t",
                      "raw"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "tool.call"
                      },
                      "id": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "args": {}
                    },
                    "required": [
                      "t",
                      "id",
                      "name",
                      "args"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "fs.snapshot"
                      },
                      "path": {
                        "type": "string"
                      },
                      "phase": {
                        "type": "string",
                        "enum": [
                          "before",
                          "after"
                        ]
                      },
                      "sha256": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "bytes": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      }
                    },
                    "required": [
                      "t",
                      "path",
                      "phase",
                      "sha256",
                      "bytes"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "tool.result"
                      },
                      "id": {
                        "type": "string"
                      },
                      "ok": {
                        "type": "boolean"
                      },
                      "payload": {},
                      "ms": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "reason": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "id",
                      "ok",
                      "payload",
                      "ms"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "permission"
                      },
                      "capabilityId": {
                        "type": "string"
                      },
                      "decision": {
                        "type": "string",
                        "enum": [
                          "allow",
                          "deny",
                          "ask"
                        ]
                      },
                      "source": {
                        "type": "string",
                        "enum": [
                          "default",
                          "config",
                          "user",
                          "mode",
                          "session-grant"
                        ]
                      },
                      "matchedRule": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "channel": {
                        "type": "string"
                      },
                      "grant": {
                        "type": "object",
                        "properties": {
                          "capability": {
                            "type": "string"
                          },
                          "scope": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "capability"
                        ]
                      }
                    },
                    "required": [
                      "t",
                      "capabilityId",
                      "decision",
                      "source",
                      "matchedRule"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "model.switch"
                      },
                      "from": {
                        "type": "string"
                      },
                      "to": {
                        "type": "string"
                      },
                      "reason": {
                        "type": "string"
                      },
                      "lostCapabilities": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    },
                    "required": [
                      "t",
                      "from",
                      "to"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "snapshot"
                      },
                      "id": {
                        "type": "string"
                      },
                      "label": {
                        "type": "string"
                      },
                      "files": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "largeFilesSkipped": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      }
                    },
                    "required": [
                      "t",
                      "id",
                      "label",
                      "files"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "revert"
                      },
                      "toSeq": {
                        "type": "integer",
                        "exclusiveMinimum": 0,
                        "maximum": 9007199254740991
                      },
                      "scope": {
                        "type": "string",
                        "enum": [
                          "files",
                          "conversation",
                          "both"
                        ]
                      },
                      "snapshotId": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "undoSnapshotId": {
                        "type": [
                          "string",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "t",
                      "toSeq",
                      "scope",
                      "snapshotId",
                      "undoSnapshotId"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "ctx.cleanup"
                      },
                      "fromSeq": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "toSeq": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "tokensBefore": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "tokensAfter": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "saved": {
                        "type": "object",
                        "properties": {
                          "dedupe": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          },
                          "verbose": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          },
                          "resolvedError": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          },
                          "stack": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          }
                        },
                        "required": [
                          "dedupe",
                          "verbose",
                          "resolvedError",
                          "stack"
                        ]
                      },
                      "preserved": {
                        "type": "array",
                        "items": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        }
                      }
                    },
                    "required": [
                      "t",
                      "fromSeq",
                      "toSeq",
                      "tokensBefore",
                      "tokensAfter",
                      "saved",
                      "preserved"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "ctx.compact"
                      },
                      "fromSeq": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "toSeq": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "keptTurns": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "tokensBefore": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "tokensAfter": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "trigger": {
                        "type": "string",
                        "enum": [
                          "threshold",
                          "manual"
                        ]
                      },
                      "summary": {
                        "type": "object",
                        "properties": {
                          "intent": {
                            "type": "string"
                          },
                          "filesModified": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            }
                          },
                          "keyDecisions": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            }
                          },
                          "openQuestions": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            }
                          },
                          "nextSteps": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            }
                          }
                        },
                        "required": [
                          "intent",
                          "filesModified",
                          "keyDecisions",
                          "openQuestions",
                          "nextSteps"
                        ]
                      }
                    },
                    "required": [
                      "t",
                      "fromSeq",
                      "toSeq",
                      "keptTurns",
                      "tokensBefore",
                      "tokensAfter",
                      "trigger",
                      "summary"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "ctx.ref"
                      },
                      "sessionId": {
                        "type": "string"
                      },
                      "fromSeq": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 9007199254740991
                      },
                      "toSeq": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 9007199254740991
                      }
                    },
                    "required": [
                      "t",
                      "sessionId",
                      "fromSeq",
                      "toSeq"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "memory.write"
                      },
                      "layer": {
                        "type": "string",
                        "enum": [
                          "L3",
                          "L4"
                        ]
                      },
                      "op": {
                        "type": "string",
                        "enum": [
                          "add",
                          "delete",
                          "extracted",
                          "update",
                          "review"
                        ]
                      },
                      "diff": {
                        "type": "string"
                      },
                      "item": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string"
                          },
                          "kind": {
                            "type": "string",
                            "enum": [
                              "fact",
                              "preference",
                              "entity"
                            ]
                          },
                          "text": {
                            "type": "string"
                          },
                          "sourceRefs": {
                            "type": "array",
                            "items": {
                              "type": "object",
                              "properties": {
                                "sessionId": {
                                  "type": "string"
                                },
                                "seq": {
                                  "type": "integer",
                                  "minimum": 1,
                                  "maximum": 9007199254740991
                                }
                              },
                              "required": [
                                "sessionId",
                                "seq"
                              ]
                            }
                          }
                        },
                        "required": [
                          "id",
                          "kind",
                          "text",
                          "sourceRefs"
                        ]
                      },
                      "itemId": {
                        "type": "string"
                      },
                      "range": {
                        "type": "object",
                        "properties": {
                          "sessionId": {
                            "type": "string"
                          },
                          "fromSeq": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 9007199254740991
                          },
                          "toSeq": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 9007199254740991
                          }
                        },
                        "required": [
                          "sessionId",
                          "fromSeq",
                          "toSeq"
                        ]
                      },
                      "changes": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "id": {
                              "type": "string"
                            },
                            "section": {
                              "type": "string",
                              "enum": [
                                "工作习惯",
                                "技术偏好",
                                "沟通风格",
                                "领域知识",
                                "对用户的模型",
                                "失败教训"
                              ]
                            },
                            "op": {
                              "type": "string",
                              "enum": [
                                "add",
                                "update",
                                "remove"
                              ]
                            },
                            "before": {
                              "type": "string"
                            },
                            "after": {
                              "type": "string"
                            },
                            "sources": {
                              "type": "array",
                              "items": {
                                "type": "string"
                              }
                            }
                          },
                          "required": [
                            "id",
                            "section",
                            "op",
                            "sources"
                          ]
                        }
                      },
                      "reviews": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "changeId": {
                              "type": "string"
                            },
                            "decision": {
                              "type": "string",
                              "enum": [
                                "accept",
                                "reject"
                              ]
                            }
                          },
                          "required": [
                            "changeId",
                            "decision"
                          ]
                        }
                      }
                    },
                    "required": [
                      "t",
                      "layer",
                      "op",
                      "diff"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "task.spawn"
                      },
                      "childSessionId": {
                        "type": "string"
                      },
                      "goal": {
                        "type": "string"
                      },
                      "tools": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    },
                    "required": [
                      "t",
                      "childSessionId",
                      "goal"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "task.run"
                      },
                      "name": {
                        "type": "string"
                      },
                      "spec": {},
                      "cwd": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "name",
                      "spec"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "task.node"
                      },
                      "nodeId": {
                        "type": "string"
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "started",
                          "done",
                          "failed"
                        ]
                      },
                      "attempt": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 9007199254740991
                      },
                      "output": {
                        "type": "string"
                      },
                      "error": {
                        "type": "string"
                      },
                      "sessionId": {
                        "type": "string"
                      },
                      "ms": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      }
                    },
                    "required": [
                      "t",
                      "nodeId",
                      "status",
                      "attempt"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "task.resume"
                      },
                      "completed": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "rerun": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    },
                    "required": [
                      "t",
                      "completed",
                      "rerun"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "task.retry"
                      },
                      "nodeId": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "nodeId"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "plugin.error"
                      },
                      "plugin": {
                        "type": "string"
                      },
                      "tool": {
                        "type": "string"
                      },
                      "message": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "plugin",
                      "message"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "task.end"
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "done",
                          "failed",
                          "cancelled"
                        ]
                      }
                    },
                    "required": [
                      "t",
                      "status"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "workspace.trust"
                      },
                      "root": {
                        "type": "string"
                      },
                      "trusted": {
                        "type": "boolean"
                      },
                      "source": {
                        "type": "string",
                        "enum": [
                          "user",
                          "stored",
                          "default"
                        ]
                      }
                    },
                    "required": [
                      "t",
                      "root",
                      "trusted",
                      "source"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "hook.run"
                      },
                      "name": {
                        "type": "string"
                      },
                      "on": {
                        "type": "string",
                        "enum": [
                          "pre",
                          "post",
                          "stop"
                        ]
                      },
                      "capabilityId": {
                        "type": "string"
                      },
                      "ms": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "exitCode": {
                        "anyOf": [
                          {
                            "type": "integer",
                            "minimum": -9007199254740991,
                            "maximum": 9007199254740991
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "blocked": {
                        "type": "boolean"
                      },
                      "timedOut": {
                        "type": "boolean"
                      },
                      "output": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "name",
                      "on",
                      "ms",
                      "exitCode",
                      "blocked",
                      "timedOut"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "verify.required"
                      },
                      "attempt": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "message": {
                        "type": "string"
                      },
                      "final": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "t",
                      "attempt",
                      "message"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "mode.switch"
                      },
                      "to": {
                        "type": "string",
                        "enum": [
                          "plan",
                          "act"
                        ]
                      },
                      "reason": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "to"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "plan.proposed"
                      },
                      "plan": {
                        "type": "string"
                      },
                      "steps": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "id": {
                              "type": "string"
                            },
                            "goal": {
                              "type": "string"
                            },
                            "dependsOn": {
                              "type": "array",
                              "items": {
                                "type": "string"
                              }
                            }
                          },
                          "required": [
                            "id",
                            "goal"
                          ]
                        }
                      }
                    },
                    "required": [
                      "t",
                      "plan"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "plan.decided"
                      },
                      "approved": {
                        "type": "boolean"
                      },
                      "comment": {
                        "type": "string"
                      },
                      "asTask": {
                        "type": "boolean"
                      },
                      "runId": {
                        "type": "string"
                      },
                      "shape": {
                        "type": "string",
                        "enum": [
                          "single",
                          "dag"
                        ]
                      },
                      "source": {
                        "type": "string",
                        "enum": [
                          "user",
                          "policy"
                        ]
                      }
                    },
                    "required": [
                      "t",
                      "approved"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "worktree.create"
                      },
                      "repo": {
                        "type": "string"
                      },
                      "path": {
                        "type": "string"
                      },
                      "branch": {
                        "type": "string"
                      },
                      "base": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "repo",
                      "path",
                      "branch",
                      "base"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "worktree.discard"
                      },
                      "path": {
                        "type": "string"
                      },
                      "trash": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "path",
                      "trash"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "worktree.restore"
                      },
                      "path": {
                        "type": "string"
                      },
                      "trash": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "path",
                      "trash"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "worktree.apply"
                      },
                      "mode": {
                        "type": "string",
                        "enum": [
                          "squash",
                          "merge",
                          "branch"
                        ]
                      },
                      "ok": {
                        "type": "boolean"
                      },
                      "commit": {
                        "type": "string"
                      },
                      "message": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "t",
                      "mode",
                      "ok"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "budget.warn"
                      },
                      "kind": {
                        "type": "string",
                        "enum": [
                          "tokens",
                          "costUsd",
                          "toolCalls"
                        ]
                      },
                      "used": {
                        "type": "number"
                      },
                      "limit": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "t",
                      "kind",
                      "used",
                      "limit"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "budget.decided"
                      },
                      "action": {
                        "type": "string",
                        "enum": [
                          "continue",
                          "stop",
                          "raise"
                        ]
                      },
                      "kind": {
                        "type": "string",
                        "enum": [
                          "tokens",
                          "costUsd",
                          "toolCalls"
                        ]
                      },
                      "limit": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "t",
                      "action",
                      "kind"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "session.kind"
                      },
                      "kind": {
                        "type": "string",
                        "enum": [
                          "chat",
                          "task"
                        ]
                      },
                      "cwd": {
                        "type": "string"
                      },
                      "isolation": {
                        "type": "object",
                        "properties": {
                          "isolate": {
                            "type": "boolean"
                          },
                          "reason": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "isolate",
                          "reason"
                        ]
                      }
                    },
                    "required": [
                      "t",
                      "kind",
                      "cwd"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "project.assign"
                      },
                      "projectId": {
                        "type": "string"
                      },
                      "path": {
                        "type": "string"
                      },
                      "auto": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "t",
                      "projectId",
                      "path",
                      "auto"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "schedule.fire"
                      },
                      "scheduleId": {
                        "type": "string"
                      },
                      "due": {
                        "type": "integer",
                        "minimum": -9007199254740991,
                        "maximum": 9007199254740991
                      },
                      "late": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "t",
                      "scheduleId",
                      "due",
                      "late"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "review.findings"
                      },
                      "findings": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "file": {
                              "type": "string"
                            },
                            "line": {
                              "type": "integer",
                              "exclusiveMinimum": 0,
                              "maximum": 9007199254740991
                            },
                            "severity": {
                              "type": "string",
                              "enum": [
                                "high",
                                "medium",
                                "low"
                              ]
                            },
                            "problem": {
                              "type": "string"
                            },
                            "basis": {
                              "type": "string"
                            }
                          },
                          "required": [
                            "file",
                            "severity",
                            "problem",
                            "basis"
                          ]
                        }
                      }
                    },
                    "required": [
                      "t",
                      "findings"
                    ],
                    "additionalProperties": {}
                  },
                  {
                    "type": "object",
                    "properties": {
                      "t": {
                        "type": "string",
                        "const": "error"
                      },
                      "scope": {
                        "type": "string"
                      },
                      "message": {
                        "type": "string"
                      },
                      "recoverable": {
                        "type": "boolean"
                      },
                      "counters": {
                        "type": "object",
                        "properties": {
                          "toolCalls": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          },
                          "argParseRetries": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          },
                          "elapsedMs": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          }
                        },
                        "required": [
                          "toolCalls",
                          "argParseRetries",
                          "elapsedMs"
                        ]
                      }
                    },
                    "required": [
                      "t",
                      "scope",
                      "message",
                      "recoverable"
                    ],
                    "additionalProperties": {}
                  }
                ]
              },
              {
                "type": "object",
                "properties": {
                  "t": {
                    "type": "string"
                  },
                  "__unparsed": {},
                  "__schemaVersion": {
                    "type": "integer",
                    "minimum": -9007199254740991,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "t",
                  "__unparsed",
                  "__schemaVersion"
                ]
              }
            ]
          }
        },
        "required": [
          "seq",
          "sessionId",
          "parentSeq",
          "ts",
          "schemaVersion",
          "ev"
        ]
      }
    }
  },
  "required": [
    "sessionId",
    "events"
  ]
}
```

### `session.ask`

权限询问

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "askId": {
      "type": "string"
    },
    "sessionId": {
      "type": "string"
    },
    "capabilityId": {
      "type": "string"
    },
    "detail": {
      "type": "string"
    },
    "form": {
      "type": "object",
      "properties": {
        "message": {
          "type": "string"
        },
        "schema": {}
      },
      "required": [
        "message",
        "schema"
      ]
    },
    "grantable": {
      "type": "boolean"
    }
  },
  "required": [
    "askId",
    "sessionId",
    "capabilityId",
    "detail"
  ]
}
```

### `session.askDone`

权限询问已被回答

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "askId": {
      "type": "string"
    },
    "allowed": {
      "type": "boolean"
    }
  },
  "required": [
    "sessionId",
    "askId",
    "allowed"
  ]
}
```

### `session.metrics`

状态栏指标（模型、token、花费、工具次数、上下文占用）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "metrics": {
      "type": "object",
      "properties": {
        "provider": {
          "type": "string"
        },
        "model": {
          "type": "string"
        },
        "tokens": {
          "type": "object",
          "properties": {
            "input": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "output": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "cacheRead": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "input",
            "output",
            "cacheRead"
          ]
        },
        "cost": {
          "type": "string"
        },
        "contextPercent": {
          "type": "number"
        },
        "contextLevel": {
          "type": "string",
          "enum": [
            "ok",
            "warn",
            "danger"
          ]
        },
        "unpricedModels": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "turnMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "verify": {
          "type": "string",
          "enum": [
            "clean",
            "unverified",
            "verified",
            "failed"
          ]
        },
        "mode": {
          "type": "string",
          "enum": [
            "plan",
            "act"
          ]
        },
        "turns": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "steps": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "tokPerSec": {
          "anyOf": [
            {
              "type": "number",
              "minimum": 0
            },
            {
              "type": "null"
            }
          ]
        },
        "cacheHitPercent": {
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 100
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "provider",
        "model",
        "tokens",
        "cost",
        "contextPercent",
        "contextLevel",
        "unpricedModels"
      ]
    }
  },
  "required": [
    "sessionId",
    "metrics"
  ]
}
```

### `session.busy`

会话忙闲变化

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "busy": {
      "type": "boolean"
    }
  },
  "required": [
    "sessionId",
    "busy"
  ]
}
```

### `sessions.changed`

会话列表该刷新了（PRD-M8-009 AC-1）：有会话新建、删除、忙闲变化、来了新事件、已读推进。推给所有已握手的连接，500ms 内的变化合并成一条；收到后重新 session.list（不用轮询）

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sessionIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "sessionIds"
  ]
}
```

