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

列出会话。默认不含软删除的；includeDeleted 给回收站用

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
    }
  },
  "required": [
    "path",
    "text"
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

### `session.create`

新建会话

**params**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "cwd": {
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

### `session.submit`

提交一次用户输入。同一会话串行处理，正忙时返回 SESSION_BUSY 而不是静默丢弃。refs 引用其他会话的片段（PRD-M3-005）：接受之前校验，会话不存在或起点越界 → INVALID_PARAMS；终点超出时截到末尾

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
                          "user"
                        ]
                      },
                      "matchedRule": {
                        "type": [
                          "string",
                          "null"
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

