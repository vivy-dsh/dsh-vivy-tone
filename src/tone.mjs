/**
 * dsh-vivy-tone — the editable tone section of Superagent's orchestrator prompt.
 *
 * The tone (「怎么跟人说话」) is the one part of the prompt a person is expected to
 * tune, so it is stored on its own in the state directory and composed back into
 * `runtime/orchestrator` on every write. Keeping the text here rather than only
 * in the prompt override matters at startup: the plugin recomposes the part it
 * owns from this file, so a restart keeps an edit instead of reverting it to
 * the shipped default.
 *
 * An empty tone is meaningful: the composed part is the head alone, i.e. the
 * deployment keeps Superagent's rules but has no tone section.
 *
 * @module dsh-vivy-tone/tone
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_TONE, ORCHESTRATOR_HEAD, TRANSLATIONS } from './zh.mjs'

/** The file holding the tone text, inside the state directory. */
export const TONE_FILE = 'tone.md'

/** How much text a tone may hold; well under Superagent's own config budget (100,000 chars). */
export const MAX_TONE_CHARS = 20000

/**
 * The orchestrator part for a tone: this package's head, a blank line, the tone.
 *
 * @param {string} toneText
 * @returns {string}
 */
export function composeOrchestrator(toneText) {
  const text = String(toneText ?? '').replace(/\r\n/g, '\n').trim()
  return text ? `${ORCHESTRATOR_HEAD}\n\n${text}` : ORCHESTRATOR_HEAD
}

/**
 * The text a save may store: normalized newlines, trimmed, within the budget.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTone(raw) {
  if (typeof raw !== 'string') throw new TypeError('dsh-vivy-tone: "text" must be a string')
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (text.length > MAX_TONE_CHARS) {
    throw new TypeError(`dsh-vivy-tone: the tone is ${text.length} characters; the limit is ${MAX_TONE_CHARS}`)
  }
  return text
}

/**
 * Read the stored tone, or the shipped default when nothing was saved.
 *
 * @param {string} stateDir
 * @returns {{text: string, custom: boolean}}
 */
export function readTone(stateDir) {
  const file = join(stateDir, TONE_FILE)
  if (!existsSync(file)) return { text: DEFAULT_TONE, custom: false }
  try {
    return { text: readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/u, ''), custom: true }
  } catch {
    // An unreadable file reads as unsaved rather than failing the panel; the
    // next save rewrites it atomically.
    return { text: DEFAULT_TONE, custom: false }
  }
}

/**
 * Store the tone text atomically, so a crash cannot leave a half-written file.
 *
 * @param {string} stateDir
 * @param {string} text - text already passed through {@link normalizeTone}.
 * @returns {string} the file written.
 */
export function writeTone(stateDir, text) {
  mkdirSync(stateDir, { recursive: true })
  const file = join(stateDir, TONE_FILE)
  const temporary = join(dirname(file), `.${TONE_FILE}.tmp`)
  writeFileSync(temporary, text ? `${text}\n` : '', 'utf8')
  renameSync(temporary, file)
  return file
}

/**
 * The part table an install writes: this package's translations, with the
 * orchestrator part composed from the given tone.
 *
 * @param {string} toneText
 * @returns {Record<string, string>}
 */
export function toneTable(toneText) {
  return { ...TRANSLATIONS, 'runtime/orchestrator': composeOrchestrator(toneText) }
}
