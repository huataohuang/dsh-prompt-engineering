#!/usr/bin/env node
/**
 * 生成「发现」标签页可用的插件索引（format 1）。
 *
 * 索引文件是发布物本身：把它放到任意静态托管上，用户在
 * 插件 → 发现 → 索引源 里粘贴它的最终 URL 即可浏览与安装。
 * 格式细节与校验器：@deepseek-ai/dsh-plugin-market-index 的 parseMarketIndex
 * （本脚本产出后由 tests/index.spec.mjs 用真实校验器验一遍）。
 *
 * 用法：
 *   node scripts/make-index.mjs --version 0.1.0 --channel npm \
 *     --base-url https://example.com/dsh-plugins/index.json
 *   node scripts/make-index.mjs --channel git \
 *     --git-url https://github.com/you/repo --git-commit <40位小写sha> --git-path 提示词工程
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/** 读取 --name value 形式的参数。 */
function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = arg('version', manifest.version)
const channel = arg('channel', 'npm')
const timestamp = Number(arg('timestamp', Math.floor(Date.now() / 1000)))
const baseUrl = arg('base-url', 'https://example.com/dsh-plugins/index.json')
const author = arg('author', '')
const out = resolve(root, arg('out', 'dist/index.json'))

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('[make-index] --version 必须是精确 SemVer，收到：' + version)
  process.exit(1)
}
if (!Number.isInteger(timestamp) || timestamp <= 0) {
  console.error('[make-index] --timestamp 必须是 Unix 秒整数')
  process.exit(1)
}

let source
if (channel === 'git') {
  const url = arg('git-url', '')
  const commit = arg('git-commit', '')
  const path = arg('git-path', '')
  if (!/^https:\/\/[^\s?#]+$/.test(url) || !/^[0-9a-f]{40}$/.test(commit)) {
    console.error('[make-index] git 通道需要 --git-url（https，无查询与片段）与 40 位小写 --git-commit')
    process.exit(1)
  }
  source = { type: 'git', url, commit }
  if (path !== '') source.path = path
} else if (channel === 'npm') {
  source = { type: 'npm' }
} else {
  console.error('[make-index] --channel 只能是 npm 或 git')
  process.exit(1)
}

const index = {
  format: 1,
  title: {
    zh: arg('index-title-zh', '元枢插件'),
    en: arg('index-title-en', 'YuanShu plugins')
  },
  description: {
    zh: arg('index-desc-zh', '自建 DSH 插件索引：收录元枢出品的可选插件。'),
    en: arg('index-desc-en', 'Self-hosted DSH plugin index for optional plugins published by YuanShu.')
  },
  metadata: {
    categories: {
      input: { title: { zh: '输入', en: 'Input' } },
      display: { title: { zh: '显示', en: 'Display' } }
    },
    labels: {
      'third-party': { title: { zh: '第三方', en: 'Third-party' } },
      prompt: { title: { zh: '提示词', en: 'Prompt' } }
    }
  },
  plugins: [
    {
      name: manifest.name,
      title: { zh: '提示词工程', en: 'Prompt engineering' },
      description: {
        zh: '发送区一个星芒图标，点一下就把输入框里的草稿改写成更专业的提示词，直接替换回输入框。',
        en: 'A sparkle icon in the composer: one click rewrites the draft into a professional prompt and puts it back in place.'
      },
      icon: 'icon.svg',
      ...author === '' ? {} : { author },
      metadata: { category: 'input', labels: ['third-party', 'prompt'] },
      versions: [
        {
          version,
          publishTimestamp: timestamp,
          source,
          engines: manifest.engines && manifest.engines.dsh ? { dsh: manifest.engines.dsh } : {}
        }
      ]
    }
  ]
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(index, null, 2) + '\n')
console.log('[make-index] 已生成 ' + out)
console.log('[make-index] 索引 URL 必须是最终地址（DSH 拒绝重定向）：' + baseUrl)
console.log('[make-index] 插件 ' + manifest.name + '@' + version + ' 来源 ' + JSON.stringify(source))
