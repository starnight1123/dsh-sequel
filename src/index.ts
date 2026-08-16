/**
 * @dsh-external/dsh-sequel — 小说续写工具包。
 *
 * 功能：
 * 1. dsh_sequel_import_txt    —— 导入/规整 TXT 正文
 * 2. dsh_sequel_import_json   —— 导入/校验 JSON 角色卡或预设
 * 3. dsh_sequel_continue      —— 根据正文 + 角色/预设生成续写
 *
 * 规范：
 * - 资源注册必须挂 ctx.effect（热重载/卸载自动清理）。
 * - 工具 schema 保持精简，详细说明放在 tool result / 引导文本。
 */
import type { Context } from 'cordis'
import { defineTool, type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import z from 'schemastery'

export const name = "@dsh-external/dsh-sequel"
export const inject = ['tools', 'fs', 'llm']

/** 续写专用的系统提示：把“文风模仿”设为第一优先级。 */
const CONTINUE_SYSTEM_PROMPT = [
  '你是一个严格的文风模仿续写引擎。',
  '你的唯一任务是延续用户提供的正文：保持原作用词、句式、标点、节奏、人称、语气与时代背景。',
  '禁止擅自切换成古风、文言、翻译腔、日轻腔或任何与原文不一致的风格。',
  '如果原文是现代白话，就必须写现代白话；如果原文是古风，才保持古风。',
  '不要解释，不要复述要求，只输出续写正文。',
].join('\n')

/** 续写输出 token 上限（可被 max_tokens / config.maxTokens 覆盖）。 */
const MAX_TOKEN_CAP = 65536
/** 未显式配置时的最低输出预算，比原默认 8192 大幅提高。 */
const DEFAULT_MAX_TOKENS = 16384

/** 续写模式：prose=普通叙述续写，dialogue=对话体/聊天体。 */
type ContinueMode = 'prose' | 'dialogue'

/** 对话体专用系统提示：更紧凑，减少无关输出。 */
const DIALOGUE_SYSTEM_PROMPT = [
  '你是一个对话体写作引擎。',
  '输出格式：角色名：台词；动作/心理/环境用（）或【】标注。',
  '不要输出大段旁白，不要解释，不要复述设定，直接开始对话。',
  '严格保持人物性格、关系与世界观设定。',
].join('\n')

export interface Config {
  /** 默认 provider；缺省时尝试使用当前 agent 的请求路由。 */
  provider?: string
  /** 默认 model；缺省时尝试使用当前 agent 的请求路由。 */
  model?: string
  /** 默认最大输出 token 数。 */
  maxTokens?: number
  /** 采样温度。 */
  temperature?: number
  /** 默认续写指令。 */
  defaultInstruction?: string
  /** 默认风格预设 JSON 文件路径；未传 preset/preset_path 时自动加载。 */
  presetPath?: string
}

export const Config = z.object({
  provider: z.string(),
  model: z.string(),
  maxTokens: z.number().min(1).max(131072),
  temperature: z.number().min(0).max(2),
  defaultInstruction: z.string().default('请严格模仿原文文风自然续写，保持人称、语气和叙事连贯。'),
  presetPath: z.string(),
})

interface ImportTxtArgs {
  content: string
  title?: string
}

interface ImportJsonArgs {
  content: string
  label?: string
}

interface ContinueArgs {
  mode?: string
  story?: string
  story_path?: string
  worldview?: string
  worldview_path?: string
  characters?: string
  characters_path?: string
  role?: string
  preset?: string
  preset_path?: string
  instruction?: string
  length?: number
  insert_after?: string
  style_hint?: string
  max_tokens?: number
  provider?: string
  model?: string
}

interface ResolvedRoute {
  provider: string
  model: string
  maxTokens?: number
  temperature?: number
}

export function apply(ctx: Context, config: Config): void {
  // ── 工具 1：导入 TXT 正文 ──────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dsh_sequel_import_txt',
    description: '可选：规整/统计 TXT 正文；续写可直接传 story/story_path，不必先调用本工具。',
    parameters: {
      content: { type: 'string', required: true, description: 'TXT 正文内容。' },
      title: { type: 'string', description: '可选的正文标题/来源名。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          text: { type: 'string', required: true },
          chars: { type: 'integer', required: true },
          lines: { type: 'integer', required: true },
          preview: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: { title: string; text: string; chars: number; lines: number; preview: string }) => [{
        type: 'text',
        text: `已导入${value.title ? `《${value.title}》` : '正文'}：${value.chars} 字符 / ${value.lines} 行。\n预览：\n${value.preview}`,
      }],
    },
    async execute(args: ImportTxtArgs) {
      if (!args.content || args.content.trim().length === 0) {
        throw new Error('content 不能为空')
      }
      const text = args.content.replace(/\r\n/g, '\n').trim() + (args.content.endsWith('\n') ? '\n' : '')
      const lines = text.length === 0 ? 0 : text.split('\n').length
      const chars = text.length
      const preview = chars > 300 ? text.slice(0, 300) + '……' : text
      return {
        title: args.title ?? '',
        text,
        chars,
        lines,
        preview,
      }
    },
  })), '@dsh-external/dsh-sequel: import_txt')

  // ── 工具 2：导入 JSON 角色/预设 ────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dsh_sequel_import_json',
    description: '可选：校验 JSON 角色/预设；续写可直接传 role/preset/preset_path，不必先调用本工具。',
    parameters: {
      content: { type: 'string', required: true, description: 'JSON 字符串（角色卡或预设）。' },
      label: { type: 'string', description: '可选的来源标签。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', required: true },
          type: { type: 'string', required: true, enum: ['character', 'preset', 'unknown'] },
          keys: { type: 'array', required: true, items: { type: 'string' } },
          data: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args: unknown, value: { label: string; type: string; keys: string[]; data: Record<string, unknown> }) => [{
        type: 'text',
        text: `已导入${value.label ? `「${value.label}」` : 'JSON'}：类型=${value.type}，字段=${value.keys.join(', ')}。`,
      }],
    },
    async execute(args: ImportJsonArgs) {
      if (!args.content || args.content.trim().length === 0) {
        throw new Error('content 不能为空')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(args.content)
      } catch (error) {
        throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('JSON 必须是对象（角色卡或预设）')
      }
      const data = parsed as Record<string, JsonValue>
      const keys = Object.keys(data)
      const type = detectJsonType(data)
      return {
        label: args.label ?? '',
        type,
        keys,
        data,
      }
    },
  })), '@dsh-external/dsh-sequel: import_json')

  // ── 工具 3：生成续写 ───────────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'dsh_sequel_continue',
    description: '根据正文/世界观/人物与 JSON 角色预设生成续写，支持普通叙述与对话体。',
    parameters: {
      mode: { type: 'string', enum: ['prose', 'dialogue'], description: '输出模式：prose=普通叙述（默认），dialogue=对话体/聊天体。' },
      story: { type: 'string', description: '已有正文/最近剧情（TXT 内容），与 story_path 二选一；对话体可省略。' },
      story_path: { type: 'string', description: 'TXT 文件路径，插件会直接读取该文件作为正文；与 story 二选一。' },
      worldview: { type: 'string', description: '世界观/背景设定文本，可省略。' },
      worldview_path: { type: 'string', description: '世界观 TXT 文件路径；与 worldview 二选一。' },
      characters: { type: 'string', description: '人物信息文本，可省略。' },
      characters_path: { type: 'string', description: '人物信息 TXT 文件路径；与 characters 二选一。' },
      role: { type: 'string', description: 'JSON 角色卡字符串，可省略。' },
      preset: { type: 'string', description: 'JSON 预设/风格字符串，可省略。' },
      preset_path: { type: 'string', description: 'JSON 预设文件路径，插件会读取该文件作为预设；与 preset 二选一。' },
      instruction: { type: 'string', description: '额外的续写要求。' },
      length: { type: 'integer', description: '期望续写长度（字符数），默认 500。' },
      insert_after: { type: 'string', description: '插入点：正文中出现的片段/句子，从此处之后开始续写。' },
      style_hint: { type: 'string', description: '可选：额外指定文风要求，覆盖自动文风分析。' },
      max_tokens: { type: 'integer', description: '可选：本次续写的最大输出 token 数，最高 65536。' },
      provider: { type: 'string', description: '可选 provider 覆盖。' },
      model: { type: 'string', description: '可选 model 覆盖。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          continuation: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          usage: {
            type: 'object',
            additionalProperties: false,
            properties: {
              inputTokens: { type: 'integer', required: true },
              outputTokens: { type: 'integer', required: true },
              cacheReadTokens: { type: 'integer' },
              cacheWriteTokens: { type: 'integer' },
              reasoningTokens: { type: 'integer' },
            },
          },
        },
      },
      render: (_args: unknown, value: { continuation: string; provider: string; model: string; usage?: TokenUsage }) => {
        const usage = value.usage
          ? `（in=${value.usage.inputTokens} out=${value.usage.outputTokens}）`
          : ''
        return [{ type: 'text', text: `续写完成 [${value.provider}/${value.model}]${usage}：\n\n${value.continuation}` }]
      },
    },
    async execute(args: ContinueArgs, exec: ToolRunContext) {
      const mode = normalizeMode(args.mode)
      let story = ''
      if (args.story_path && args.story_path.trim().length > 0) {
        if (args.story && args.story.trim().length > 0) {
          throw new Error('story 和 story_path 只能提供一个')
        }
        story = await readTextFile(ctx, args.story_path.trim(), exec.signal)
      } else {
        story = args.story ?? ''
      }
      if (mode === 'prose' && (!story || story.trim().length === 0)) {
        throw new Error('prose 模式需要 story 或 story_path')
      }
      if (args.insert_after && args.insert_after.trim().length > 0 && (!story || story.trim().length === 0)) {
        throw new Error('insert_after 需要 story 或 story_path')
      }

      let worldview = args.worldview ?? ''
      if (args.worldview_path && args.worldview_path.trim().length > 0) {
        if (worldview.trim().length > 0) {
          throw new Error('worldview 和 worldview_path 只能提供一个')
        }
        worldview = await readTextFile(ctx, args.worldview_path.trim(), exec.signal)
      }
      let characters = args.characters ?? ''
      if (args.characters_path && args.characters_path.trim().length > 0) {
        if (characters.trim().length > 0) {
          throw new Error('characters 和 characters_path 只能提供一个')
        }
        characters = await readTextFile(ctx, args.characters_path.trim(), exec.signal)
      }
      let preset = args.preset ?? ''
      if (args.preset_path && args.preset_path.trim().length > 0) {
        if (preset.trim().length > 0) {
          throw new Error('preset 和 preset_path 只能提供一个')
        }
        preset = await readTextFile(ctx, args.preset_path.trim(), exec.signal)
      } else if (preset.trim().length === 0 && config.presetPath && config.presetPath.trim().length > 0) {
        preset = await readTextFile(ctx, config.presetPath.trim(), exec.signal)
      }
      const route = resolveRoute(args, config, exec)
      const length = args.length && args.length > 0 ? Math.floor(args.length) : 500
      const maxTokens = resolveMaxTokens(args, config, route, length)
      const temperature = route.temperature ?? config.temperature ?? 0.9
      const style = analyzeStyle(story)
      const insertion = story ? resolveInsertion(story, args.insert_after) : undefined
      const promptArgs = { ...args, story, worldview, characters, preset, mode }
      const prompt = buildContinuationPrompt(promptArgs, config, length, style, insertion)
      const system = mode === 'dialogue' ? DIALOGUE_SYSTEM_PROMPT : CONTINUE_SYSTEM_PROMPT
      const messages: Message[] = [
        createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'plugin', plugin: 'dsh-sequel' },
        }),
      ]
      const options: GenerateOptions = {
        provider: route.provider,
        model: route.model,
        messages,
        system,
        maxTokens,
        temperature,
        signal: exec.signal,
        purpose: undefined,
      }
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream(options)) {
        assembler.push(chunk)
      }
      const finishError = finishErrorOf(assembler.finish)
      if (finishError !== undefined) throw finishError

      const continuation = assembler.blocks()
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim()
      if (continuation.length === 0) {
        throw new Error('模型没有生成续写文本')
      }
      return {
        continuation,
        provider: options.provider,
        model: options.model,
        ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
      }
    },
  })), '@dsh-external/dsh-sequel: continue')
}

/** 根据调用参数、插件配置、当前 agent 路由解析 provider/model。 */
function resolveRoute(
  args: ContinueArgs,
  config: Config,
  exec: ToolRunContext,
): ResolvedRoute {
  if (args.provider && args.model) {
    return { provider: args.provider, model: args.model }
  }
  if (config.provider && config.model) {
    return { provider: config.provider, model: config.model }
  }
  const agent = exec.agent
  const header = agent?.session.requestHeader()
  if (header) {
    return {
      provider: header.config.provider,
      model: header.config.model,
      maxTokens: header.config.maxTokens,
      temperature: header.config.temperature,
    }
  }
  if (agent?.options.provider && agent?.options.model) {
    return {
      provider: agent.options.provider,
      model: agent.options.model,
      maxTokens: agent.options.maxTokens,
    }
  }
  throw new Error('未找到可用 LLM 路由：请在插件配置中设置 provider/model，或在调用参数中传入 provider/model')
}

/** 解析续写输出 token 上限：max_tokens > config.maxTokens > 路由/默认高预算。 */
function resolveMaxTokens(
  args: ContinueArgs,
  config: Config,
  route: ResolvedRoute,
  length: number,
): number {
  const lengthBased = Math.min(MAX_TOKEN_CAP, Math.max(DEFAULT_MAX_TOKENS, Math.ceil(length * 2)))
  if (args.max_tokens && args.max_tokens > 0) {
    return Math.min(args.max_tokens, MAX_TOKEN_CAP)
  }
  if (config.maxTokens && config.maxTokens > 0) {
    return Math.min(config.maxTokens, MAX_TOKEN_CAP)
  }
  // 路由上限只用于“抬高”，不再让 agent 的低 maxTokens 把续写压死。
  return Math.min(MAX_TOKEN_CAP, Math.max(route.maxTokens ?? 0, lengthBased))
}

interface StyleProfile {
  language: string
  era: string
  pov: string
  sentenceLength: string
  tone: string[]
  notes: string[]
}

interface InsertionPoint {
  marker: string
  prefix: string
}

/** 规范化输出模式，支持中英文别名。 */
function normalizeMode(mode?: string): ContinueMode {
  if (!mode || mode.trim().length === 0) return 'prose'
  const value = mode.trim().toLowerCase()
  if (value === 'prose' || value === 'narrative' || value === '文' || value === '叙述') return 'prose'
  if (value === 'dialogue' || value === 'chat' || value === '对话' || value === '聊天') return 'dialogue'
  throw new Error(`未知 mode：${mode}（支持 prose / dialogue）`)
}

/** 组装续写提示词。 */
function buildContinuationPrompt(
  args: ContinueArgs & { story: string; mode: ContinueMode; worldview: string; characters: string; preset: string },
  config: Config,
  length: number,
  style: StyleProfile,
  insertion?: InsertionPoint,
): string {
  const parts: string[] = [
    args.mode === 'dialogue'
      ? '你是一个对话体写作引擎。严格按设定与格式输出，不要解释。'
      : '你是一个小说续写引擎。你的核心任务是严格模仿原文文风，从指定位置继续写作。',
    '',
  ]
  if (args.mode === 'dialogue') {
    parts.push(
      '## 文风要求',
      ...formatStyleProfile(style).slice(0, 3),
      '保持口语化、自然，不要书面腔。',
      '',
    )
  } else {
    parts.push(
      '## 原文文风（必须严格模仿）',
      ...formatStyleProfile(style),
      '规则：完全沿用原文的用词、句式、标点、节奏、人称与叙事视角；禁止擅自切换成古风、文言、翻译腔或任何与原文不一致的风格。',
      '',
    )
  }

  if (args.worldview && args.worldview.trim().length > 0) {
    parts.push('## 世界观/背景设定', args.worldview.trim(), '')
  }
  if (args.characters && args.characters.trim().length > 0) {
    parts.push('## 人物信息', args.characters.trim(), '')
  }
  if (args.role && args.role.trim().length > 0) {
    parts.push('## 角色设定（JSON）', args.role.trim(), '')
  }
  if (args.preset && args.preset.trim().length > 0) {
    parts.push('## 预设/风格（JSON）', args.preset.trim(), '')
  }
  if (args.style_hint && args.style_hint.trim().length > 0) {
    parts.push('## 用户文风要求', args.style_hint.trim(), '')
  }

  if (args.story && args.story.trim().length > 0) {
    const storyForPrompt = insertion ? insertion.prefix.trim() : args.story.trim()
    parts.push('## 正文/最近剧情' + (insertion ? '（截至插入点）' : ''), storyForPrompt, '')
  } else if (args.mode === 'dialogue') {
    parts.push('## 正文/最近剧情', '（无既有正文，直接开始新对话）', '')
  }

  if (insertion) {
    parts.push('## 插入点', `上文结尾的片段是：“${insertion.marker.trim()}”`, '请从该片段之后继续，不要重复插入点之前的内容。', '')
  } else if (args.mode === 'dialogue') {
    parts.push(
      '## 输出格式（对话体）',
      '- 每行格式：角色名：台词',
      '- 动作/心理/环境用（）或【】括起来',
      '- 不要输出大段旁白，不要解释，不要复述设定',
      '- 直接开始对话',
      '',
    )
  } else {
    parts.push('## 续写起点', '请从正文结尾处继续。', '')
  }

  const instruction = args.instruction?.trim() || config.defaultInstruction?.trim() || ''
  parts.push(
    '## 续写要求',
    instruction || (args.mode === 'dialogue' ? '请自然开始一段对话。' : '请自然续写。'),
    `期望长度：约 ${length} 个字符。`,
    '',
  )
  parts.push(args.mode === 'dialogue' ? '请只输出对话内容。' : '请只输出续写正文。')
  return parts.join('\n')
}

/** 把文风分析结果格式化为提示词片段。 */
function formatStyleProfile(style: StyleProfile): string[] {
  const lines = [
    `- 语言：${style.language}`,
    `- 时代感：${style.era}`,
    `- 人称：${style.pov}`,
    `- 句式：${style.sentenceLength}`,
    `- 语气：${style.tone.length > 0 ? style.tone.join('、') : '无明显倾向'}`,
  ]
  if (style.notes.length > 0) lines.push(`- 提示：${style.notes.join('；')}`)
  return lines
}

/** 定位插入点：找到正文中最后一次出现的片段，并截取到该片段结尾。 */
function resolveInsertion(story: string, marker?: string): InsertionPoint | undefined {
  if (!marker || marker.trim().length === 0) return undefined
  const needle = marker.trim()
  const index = story.lastIndexOf(needle)
  if (index !== -1) {
    return { marker: needle, prefix: story.slice(0, index + needle.length) }
  }
  const normalizedStory = story.replace(/\r\n/g, '\n')
  const normalizedNeedle = needle.replace(/\r\n/g, '\n')
  const normalizedIndex = normalizedStory.lastIndexOf(normalizedNeedle)
  if (normalizedIndex === -1) {
    throw new Error(`未在正文中找到插入点片段：“${needle}”`)
  }
  return {
    marker: normalizedNeedle,
    prefix: normalizedStory.slice(0, normalizedIndex + normalizedNeedle.length),
  }
}

/** 通过 DSH fs 服务读取 TXT 文件内容（受沙箱约束）。 */
async function readTextFile(ctx: Context, filePath: string, signal?: AbortSignal): Promise<string> {
  const target = await ctx.fs.resolve(filePath, { signal })
  const info = await ctx.fs.stat(target, signal)
  if (!info) {
    throw new Error(`文件不存在：${filePath}`)
  }
  if (info.type !== 'file') {
    throw new Error(`不是普通文件：${filePath}`)
  }
  return ctx.fs.readText(target, signal)
}

/** 从原文中提取简化的文风特征，用于约束续写风格。 */
function analyzeStyle(text: string): StyleProfile {
  const sample = text.slice(0, 20000)
  const cjkCount = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latinCount = (sample.match(/[A-Za-z]/g) ?? []).length
  const language = cjkCount === 0 && latinCount > 0
    ? '英文/非中文'
    : cjkCount > 0 && latinCount === 0
      ? '中文'
      : '中英混合/其他'

  const classicalWords = ['之', '乎', '者', '也', '矣', '焉', '兮', '汝', '吾', '妾', '公子', '姑娘', '王爷', '将军', '殿下', '小生', '奴家', '朕', '寡人']
  const modernWords = ['手机', '电脑', '微信', '电话', '地铁', '公司', '酒店', '咖啡', '网络', '汽车', '电视', '空调', '互联网', 'app', 'ok']
  const classicalHits = classicalWords.filter(word => sample.includes(word)).length
  const modernHits = modernWords.filter(word => sample.toLowerCase().includes(word.toLowerCase())).length
  const era = modernHits > 0
    ? '现代（检测到现代词汇）'
    : classicalHits > 0
      ? '古典/古风（检测到文言或古风词汇）'
      : '中性（无明显时代特征）'

  const first = (sample.match(/我们|咱们|我|俺|咱/g) ?? []).length
  const second = (sample.match(/你们|您们|您|你/g) ?? []).length
  const third = (sample.match(/她们|他们|它们|她|他|它/g) ?? []).length
  const pov = first >= second && first >= third && first > 0
    ? '第一人称'
    : second > third && second > 0
      ? '第二人称'
      : third > 0
        ? '第三人称'
        : '未知/混合'

  const sentences = sample
    .split(/[。！？!?…]+|\n+/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
  const avg = sentences.length > 0
    ? sentences.reduce((sum, part) => sum + part.length, 0) / sentences.length
    : 0
  const sentenceLength = avg > 0
    ? (avg <= 15 ? '短句为主' : avg <= 30 ? '中等句长' : '长句铺陈')
    : '未知'

  const tone: string[] = []
  const exclaim = (sample.match(/[！!]/g) ?? []).length
  const ellipsis = (sample.match(/…{2}|\.{3,}/g) ?? []).length
  const question = (sample.match(/[？?]/g) ?? []).length
  const quotes = (sample.match(/["'“”‘’]/g) ?? []).length
  if (exclaim > 0) tone.push('情绪强烈')
  if (ellipsis > 0) tone.push('留白/细腻')
  if (question > 0) tone.push('疑问/内心活动多')
  if (quotes > 0) tone.push('对话多')
  if (avg > 0 && avg <= 15) tone.push('简洁')
  if (avg > 30) tone.push('铺陈')

  const notes: string[] = []
  if (modernHits > 0 && classicalHits > 0) notes.push('原文同时含现代与古风词汇，以实际语境为准，不要整体切换风格')
  if (modernHits > 0) notes.push('原文偏现代白话，续写必须保持现代语感，禁止古风化')
  if (classicalHits > 0 && modernHits === 0) notes.push('原文偏古风，续写可保持古风，但同样严格沿用原文用词')
  if (pov === '第一人称') notes.push('保持“我”视角')
  if (pov === '第三人称') notes.push('保持第三人称视角')
  return { language, era, pov, sentenceLength, tone, notes }
}

/** 简单识别 JSON 是角色卡还是预设。 */
function detectJsonType(data: Record<string, unknown>): 'character' | 'preset' | 'unknown' {
  const keys = Object.keys(data)
  const lower = keys.map(key => key.toLowerCase())
  const hasCharacterField = lower.some(key => ['name', 'persona', 'personality', 'character', 'description'].includes(key))
  const hasPresetField = lower.some(key => ['system', 'prompt', 'style', 'preset', 'template'].includes(key))
  if (hasCharacterField) return 'character'
  if (hasPresetField) return 'preset'
  return 'unknown'
}

/** 把流结束原因映射为可抛错误。 */
function finishErrorOf(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error = new Error('续写被 token 上限截断（可增大 maxTokens 或缩短正文）') as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}
