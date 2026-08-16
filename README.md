# @dsh-external/dsh-sequel

能导入 TXT 正文/世界观/人物信息与 JSON 角色/预设，生成符合设定的续写内容，支持普通叙述与对话体。

## 工具

| 工具名 | 说明 |
| --- | --- |
| `dsh_sequel_import_txt` | 可选：规整/统计 TXT 正文；续写可直接传 `story` / `story_path`，不必先调用。 |
| `dsh_sequel_import_json` | 可选：校验 JSON 角色/预设；续写可直接传 `role` / `preset` / `preset_path`，不必先调用。 |
| `dsh_sequel_continue` | 核心工具：根据正文/世界观/人物 + 角色/预设生成续写，支持 `prose` 和 `dialogue` 两种模式。 |

## `dsh_sequel_continue` 参数

| 参数 | 是否必填 | 说明 |
| --- | --- | --- |
| `mode` | 可选 | `prose`=普通叙述（默认），`dialogue`=对话体/聊天体 |
| `story` | 二选一* | 已有正文/最近剧情（TXT 内容）；对话体可省略 |
| `story_path` | 二选一* | TXT 文件路径，插件会直接读取该文件作为正文 |
| `worldview` | 可选 | 世界观/背景设定文本 |
| `worldview_path` | 可选 | 世界观 TXT 文件路径；与 `worldview` 二选一 |
| `characters` | 可选 | 人物信息文本 |
| `characters_path` | 可选 | 人物信息 TXT 文件路径；与 `characters` 二选一 |
| `role` | 可选 | JSON 角色卡字符串 |
| `preset` | 可选 | JSON 预设/风格字符串 |
| `preset_path` | 可选 | JSON 预设文件路径；与 `preset` 二选一 |
| `instruction` | 可选 | 额外续写要求 |
| `length` | 可选 | 期望续写字符数，默认 500 |
| `insert_after` | 可选 | 插入点：正文中出现的片段/句子，从此处之后续写 |
| `style_hint` | 可选 | 额外指定文风要求，覆盖自动文风分析 |
| `max_tokens` | 可选 | 本次续写的最大输出 token 数，最高 65536 |
| `provider` / `model` | 可选 | 覆盖 LLM 路由 |

\* `story` / `story_path` 在 `prose` 模式下必填；在 `dialogue` 模式下可省略，直接开始新对话。

## 对话体模式

想写“线上对话/聊天体”时，设置 `mode: dialogue`，并提供世界观、人物信息或角色 JSON：

```text
请调用 dsh_sequel_continue：
- mode：dialogue
- worldview_path：G:\ds专用\世界观.txt
- characters_path：G:\ds专用\人物信息.txt
- role：{"name":"林晚","personality":"清冷、外柔内刚"}
- preset_path：G:\ds专用\dsh-sequel\preset.example.json
- instruction：写一段她与同事在深夜加班的对话，语气自然。
- length：800
```

对话体输出格式：

```text
林晚：你还没走？
同事：（抬头看了一眼）等你一起。
林晚：……不必了，我习惯一个人。
```

规则：

- 每行格式：`角色名：台词`
- 动作/心理/环境用 `（）` 或 `【】` 括起来
- 不输出大段旁白，不解释，不重复设定

## 文风遵循

`dsh_sequel_continue` 会自动分析原文文风并写入续写提示：

- 语言：中文 / 英文 / 混合
- 时代感：现代 / 古典 / 中性
- 人称：第一 / 第二 / 第三人称
- 句式：短句 / 中等 / 长句
- 语气：情绪、对话、留白等特征

普通叙述模式会严格要求：**完全沿用原文用词、句式、标点、节奏、人称与叙事视角，禁止擅自切换成古风、文言或翻译腔**。  
对话体模式会精简文风分析，只保留关键约束，减少 token 消耗。

## 插入点示例

```text
请调用 dsh_sequel_continue：
- story：她走进地铁站，手机屏幕亮了一下，是那条迟到了五年的消息。她盯着屏幕，手开始发抖。
- insert_after：她盯着屏幕，手开始发抖。
- instruction：从这里开始，写她最终没有回复，而是把手机放回口袋，走出站台。
- length：800
```

插件会定位到 `她盯着屏幕，手开始发抖。` 这一句，并只保留它之前的内容作为续写上下文，从该句之后开始生成。

## 直接读取 TXT 文件

如果不想把正文内容贴进 `story`，可以直接传 `story_path`：

```text
请调用 dsh_sequel_continue：
- story_path：G:\ds专用\你的小说.txt
- insert_after：她盯着屏幕，手开始发抖。
- instruction：从插入点之后续写 800 字。
```

注意：

- `story` 和 `story_path` **只能填一个**。
- `worldview` / `worldview_path`、`characters` / `characters_path`、`preset` / `preset_path` 同理，各自二选一。
- 文件读取走 DSH 的 `fs` 服务，受当前沙箱权限约束。
- 读取的是 UTF-8 文本文件。

## 风格预设系统

你可以把常用的风格/规则保存成 JSON 文件，然后通过 `preset_path` 让插件读取。

示例文件：`G:\ds专用\dsh-sequel\preset.example.json`

```json
{
  "name": "细腻文艺",
  "description": "示例风格预设：现代白话、细腻克制、偏心理描写。",
  "rules": [
    "使用现代白话，不使用古风或文言。",
    "侧重心理描写、环境细节与动作留白。",
    "以中等句长为主，避免过度煽情。",
    "保持原文叙事视角与人称。"
  ],
  "style_hint": "现代都市文艺风，细腻、克制、留白。",
  "tone": ["细腻", "克制", "留白"],
  "forbidden": ["古风词汇", "翻译腔", "突兀夸张的修辞"]
}
```

使用方式：

```text
请调用 dsh_sequel_continue：
- story_path：G:\ds专用\你的小说.txt
- preset_path：G:\ds专用\dsh-sequel\preset.example.json
- insert_after：她盯着屏幕，手开始发抖。
- instruction：续写 800 字。
```

也可以在插件配置里设置默认预设：

```json
{
  "presetPath": "G:\\ds专用\\dsh-sequel\\preset.example.json"
}
```

规则：

- `preset` 和 `preset_path` **只能填一个**。
- 如果两者都没填，但配置了 `presetPath`，会自动加载该文件。
- 预设 JSON 内容会原样进入续写提示，因此请只放入你确认合规的风格规则。

## Token 优化说明

本次优化重点：

- 对话体使用更短的 system prompt 和精简文风分析，减少无关输出。
- 工具描述已标注为“可选”，避免 Agent 为了导入而额外多跑一轮工具调用。
- `insert_after` 会把正文截断到插入点，减少送入模型的冗余历史。
- 无正文的对话体可以直接开始，不再强制要求贴整段 story。

Token 上限：

- 默认最低输出预算：**16384 tokens**
- 最高允许：**65536 tokens**
- 单次调用可用 `max_tokens` 直接指定，例如 `max_tokens: 32768`
- 也可以在插件配置里用 `maxTokens` 统一调高

## 配置

插件支持以下可选配置：

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "maxTokens": 32768,
  "temperature": 0.9,
  "defaultInstruction": "请严格模仿原文文风自然续写，保持人称、语气和叙事连贯。",
  "presetPath": "G:\\ds专用\\dsh-sequel\\preset.example.json"
}
```

`provider` / `model` 未配置时，`dsh_sequel_continue` 会尝试使用当前 agent 的请求路由；也可以直接在工具参数中传入 `provider` / `model` 覆盖。

## 构建与注入

```bash
# 需要 DSH checkout 路径（本机示例）
DSH_CHECKOUT=C:/Users/admin/deepseek-harness bash scripts/build.sh
# 注入器环境内：
dev_inject_plugin G:/ds专用/dsh-sequel
```

构建产物：`dsh-external-dsh-sequel-0.0.1.tgz`
