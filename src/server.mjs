/**
 * dsh-vivy-tone — the loopback API behind Settings -> 人格与语气 -> 语气.
 *
 * The panel reads the tone text and saves a new one. A save both stores the
 * text in this package's state directory and writes the composed
 * `runtime/orchestrator` part through Superagent's own prompt API, so the
 * change is one revision away from undo in its prompt history.
 *
 * Same guards as Superagent's own panel: loopback Host only, same-origin
 * writes, JSON bodies, and the host connection's session check.
 *
 * @module dsh-vivy-tone/server
 */

import { saveTone } from './install.mjs'
import { MAX_TONE_CHARS, readTone } from './tone.mjs'
import { DEFAULT_TONE } from './zh.mjs'
import { PromptsApiError } from './write.mjs'

/** Route prefix served by the DSH web server. */
export const TONE_PREFIX = '/dsh-vivy-tone/api'

/** A UTF-8 character costs at most four bytes in the JSON body of a maximal tone. */
const BODY_LIMIT = MAX_TONE_CHARS * 4 + 4096

/**
 * @typedef {object} TonePanelWebServer
 * @property {(route: {kind: 'prefix', path: string, handler: (req: IncomingMessage, res: ServerResponse) => unknown}) => () => void} register
 */

/**
 * @typedef {object} TonePanelConnection
 * @property {(req: IncomingMessage) => unknown} requestRejection
 */

/**
 * @typedef {object} TonePanelOptions
 * @property {string} baseUrl - loopback base URL of the deployment's web server.
 * @property {string} stateDir - this package's state directory.
 * @property {number} [timeoutMs]
 * @property {(message: string) => void} [log]
 */

function send(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

function failure(res, status, code, error, hint) {
  send(res, status, { ok: false, code, error, hint })
}

function allowedHost(host) {
  const value = String(host ?? '').toLowerCase()
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(value)
}

function sameOrigin(req) {
  if (req.headers.origin === undefined) return true
  try {
    return new URL(req.headers.origin).host.toLowerCase() === String(req.headers.host).toLowerCase()
  } catch {
    return false
  }
}

function requireJson(req) {
  return String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > BODY_LIMIT) {
      throw Object.assign(new Error('request body is too large'), { code: 'BODY_TOO_LARGE' })
    }
    chunks.push(Buffer.from(chunk))
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw Object.assign(new Error('request body is not valid JSON'), { code: 'INVALID_JSON' })
  }
}

function failFrom(res, error) {
  if (error instanceof PromptsApiError) {
    if (error.status === 409) {
      failure(res, 409, 'PROMPT_CONFLICT', 'Superagent 的提示词已被别处改动', '刷新后重试；你的语气文本没有保存')
      return
    }
    if (error.status === 404) {
      failure(res, 502, 'PROMPT_PART_MISSING', '这个 Superagent 没有可写的 runtime/orchestrator 提示词',
        '确认 Superagent 版本后重试，或改用它的提示词面板')
      return
    }
    failure(res, 502, 'PROMPTS_UNAVAILABLE', `写入 Superagent 提示词失败（HTTP ${error.status ?? '未知'}）`,
      '确认 Superagent 正在运行，然后重试')
    return
  }
  if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') {
    failure(res, 400, error.code, '请求内容不合法', '重新输入后保存')
    return
  }
  if (error instanceof TypeError) {
    failure(res, 400, 'INVALID_TONE', error.message, '检查语气文本的长度后重试')
    return
  }
  failure(res, 500, 'TONE_SAVE_FAILED', '保存语气失败', '稍后重试；详细原因见插件日志')
}

/**
 * Register the tone API. Returns the host's route disposer.
 *
 * @param {any} ctx - child context providing `webServer` and `connection`.
 * @param {TonePanelOptions} options
 * @returns {() => void}
 */
export function registerTonePanel(ctx, options) {
  /** @type {TonePanelWebServer | undefined} */
  const webServer = ctx.get('webServer')
  if (webServer === undefined || webServer === null) return () => {}

  return webServer.register({
    kind: 'prefix',
    path: TONE_PREFIX,
    handler: async (req, res) => {
      if (!allowedHost(req.headers.host)) {
        failure(res, 403, 'HOST_REJECTED', '只接受本机访问', '使用本地 DSH 面板打开设置')
        return
      }
      if (req.method !== 'GET' && !sameOrigin(req)) {
        failure(res, 403, 'ORIGIN_REJECTED', '跨站请求被拒绝', '在 DSH 面板内重试')
        return
      }
      /** @type {TonePanelConnection | undefined} */
      const connection = ctx.get('connection')
      if (connection === undefined || typeof connection.requestRejection !== 'function') {
        failure(res, 503, 'AUTH_UNAVAILABLE', '会话验证不可用', '检查 DSH 连接服务')
        return
      }
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined && rejection !== null && rejection !== false) {
        failure(res, typeof rejection === 'number' ? rejection : 403, 'AUTH_REJECTED', '会话未通过验证', '重新打开本地面板链接')
        return
      }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      try {
        if (url.pathname === `${TONE_PREFIX}/tone` && req.method === 'GET') {
          const { text, custom } = readTone(options.stateDir)
          send(res, 200, {
            ok: true, text, defaultText: DEFAULT_TONE, custom, maxChars: MAX_TONE_CHARS,
          })
          return
        }
        if (url.pathname === `${TONE_PREFIX}/tone` && req.method === 'PUT') {
          if (!requireJson(req)) {
            failure(res, 415, 'CONTENT_TYPE_REQUIRED', '只接受 JSON 请求', '在 DSH 面板内保存')
            return
          }
          const body = await readBody(req)
          const text = body?.text
          const saved = await saveTone({
            baseUrl: options.baseUrl,
            stateDir: options.stateDir,
            text,
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
            log: options.log,
          })
          options.log?.(`dsh-vivy-tone: tone saved at revision ${saved.revision}`)
          send(res, 200, { ok: true, text: saved.text, custom: true, revision: saved.revision })
          return
        }
        failure(res, 404, 'NOT_FOUND', '未知的语气接口', '刷新页面后重试')
      } catch (error) {
        failFrom(res, error)
      }
    },
  })
}
