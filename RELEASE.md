# dsh-sequel

基于 DeepSeek Harness (DSH) 的小说续写插件，支持普通叙述与对话体两种模式。

## 功能特性

- 📄 **TXT 正文导入**：支持直接粘贴 `story`，或通过 `story_path` 读取 TXT 文件。
- 🌍 **世界观 / 人物信息导入**：支持 `worldview` / `worldview_path`、`characters` / `characters_path`，方便把设定文本直接喂给模型。
- 🎭 **JSON 角色卡与风格预设**：支持 `role`、`preset`、`preset_path`，可复用角色卡和风格规则。
- ✍️ **普通叙述续写**：自动分析原文文风，严格模仿用词、句式、节奏、人称与叙事视角。
- 💬 **对话体续写**：像线上聊天一样输出，格式为“角色名：台词”，动作/心理用 `（）` 或 `【】` 标注。
- 📌 **插入点续写**：通过 `insert_after` 指定正文中的情节片段，从该位置之后继续。
- ⚡ **Token 优化**：自动截断超长上下文、精简工具描述与提示词、对话体使用更低输出预算。
- 🧹 **输出清理**：自动移除代码围栏和“好的 / 以下是对话”等前缀废话。

## 安装

```bash
dsh plugin --profile web add github:starnight1123/dsh-sequel#v0.0.1
```

> 请以你实际使用的 DSH 插件管理命令为准。Release 附件为 `dsh-external-dsh-sequel-0.0.1.tgz`。

## 快速使用

### 普通叙述续写

```text
请调用 dsh_sequel_continue：
- story：她走进地铁站，手机屏幕亮了一下，是那条迟到了五年的消息。
- instruction：写她最终没有回复，走出站台时天空开始下雨。
- length：800
```

### 对话体续写

```text
请调用 dsh_sequel_continue：
- mode：dialogue
- story_path：G:\ds专用\最近剧情.txt
- worldview_path：G:\ds专用\世界观.txt
- characters_path：G:\ds专用\人物信息.txt
- role：{"name":"林晚","personality":"清冷、外柔内刚"}
- preset_path：G:\ds专用\dsh-sequel\preset.example.json
- instruction：写一段她与同事深夜加班的对话。
- length：800
```

### 插入点续写

```text
请调用 dsh_sequel_continue：
- story：她走进地铁站，手机屏幕亮了一下，是那条迟到了五年的消息。她盯着屏幕，手开始发抖。
- insert_after：她盯着屏幕，手开始发抖。
- instruction：从这里开始，写她最终没有回复，把手机放回口袋，走出站台。
- length：800
```

## 参数说明

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `mode` | 可选 | `prose`（普通叙述，默认）或 `dialogue`（对话体） |
| `story` | 二选一* | 已有正文 / 最近剧情 |
| `story_path` | 二选一* | 正文 TXT 文件路径 |
| `worldview` | 可选 | 世界观 / 背景设定文本 |
| `worldview_path` | 可选 | 世界观 TXT 文件路径 |
| `characters` | 可选 | 人物信息文本 |
| `characters_path` | 可选 | 人物信息 TXT 文件路径 |
| `role` | 可选 | JSON 角色卡字符串 |
| `preset` | 可选 | JSON 预设 / 风格字符串 |
| `preset_path` | 可选 | JSON 预设文件路径 |
| `instruction` | 可选 | 续写要求 |
| `length` | 可选 | 目标字符数，默认 500 |
| `insert_after` | 可选 | 插入点：正文中出现的片段，从此处之后续写 |
| `style_hint` | 可选 | 额外文风要求 |
| `max_tokens` | 可选 | 最大输出 token 数，最高 65536 |
| `provider` / `model` | 可选 | 覆盖 LLM 路由 |

\* `story` / `story_path` 在 `prose` 模式下必填；`dialogue` 模式下可省略，直接开始新对话。

## 配置

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "maxTokens": 32768,
  "temperature": 0.9,
  "defaultInstruction": "请严格模仿原文文风自然续写，保持人称、语气和叙事连贯。",
  "presetPath": "G:\\ds专用\\dsh-sequel\\preset.example.json",
  "maxStoryChars": 30000,
  "maxSettingChars": 10000
}
```

## Token 优化

- 普通叙述默认最低输出预算：**16384 tokens**
- 对话体默认最低输出预算：**8192 tokens**
- 最高允许：**65536 tokens**
- 正文默认最多送入 **24000 字符**，超出自动保留结尾
- 世界观 / 人物 / 角色 / 预设每块默认最多 **8000 字符**，超出自动保留开头

## 仓库

https://github.com/starnight1123/dsh-sequel
