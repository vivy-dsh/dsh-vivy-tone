/**
 * dsh-vivy-tone — the 语气 card inside Settings -> 人格与语气.
 *
 * The settings section itself belongs to dsh-laputa (the persona owner); it
 * declares the `settings.laputa.item` slot and this plugin registers the card
 * there, so the tone editor ships with the plugin that owns the tone text and
 * simply disappears when that plugin is not mounted.
 *
 * All data goes through this package's loopback API: reading never touches
 * Superagent, saving writes the composed prompt part through Superagent's own
 * prompt API.
 */

window.__ModuleLoader__.load({
  id: 'dsh-vivy-tone',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React
    const API = '/dsh-vivy-tone/api/tone'

    const CSS = `
      .vt-card{margin-top:24px;padding-top:20px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24))}
      .vt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
      .vt-card h3{margin:0;font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary)}
      .vt-sub{margin:6px 0 0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);max-width:620px}
      .vt-badge{flex:none;margin-top:1px;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .vt-badge.custom{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
      .vt-textarea{width:100%;box-sizing:border-box;min-height:240px;margin-top:14px;resize:vertical;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:12px 13px;outline:none}
      .vt-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px rgba(47,111,237,.14)}
      .vt-textarea:disabled{opacity:.6}
      .vt-meta{margin:6px 0 0;font-size:11.5px;color:var(--dsw-alias-label-tertiary);display:flex;flex-wrap:wrap;gap:10px}
      .vt-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
      .vt-btn{appearance:none;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;font-weight:550;padding:6px 12px;cursor:pointer}
      .vt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .vt-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .vt-btn.primary{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:#fff}
      .vt-btn.primary:hover:not(:disabled){filter:brightness(1.06)}
      .vt-btn:disabled{opacity:.55;cursor:default}
      .vt-error{margin-top:12px;font-size:12.5px;color:var(--dsw-alias-status-error,#b42318)}
      .vt-note{margin-top:12px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
      .vt-note.ok{color:var(--dsw-alias-state-success-primary,#1a7f4b)}
      .vt-loading{margin-top:14px;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
    `

    async function request(method, body) {
      const response = await fetch(API, {
        method,
        cache: 'no-store',
        ...(body === undefined ? {} : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      })
      let data
      try {
        data = await response.json()
      } catch {
        throw Object.assign(new Error('语气接口没有返回 JSON（插件可能未启用或未重启）'), { code: 'NOT_JSON' })
      }
      if (!response.ok || data.ok === false) {
        throw Object.assign(new Error(data.error || `HTTP ${response.status}`), {
          code: data.code, hint: data.hint, status: response.status,
        })
      }
      return data
    }

    const describe = failure => (failure?.hint ? `${failure.message}（${failure.hint}）` : (failure?.message ?? '未知错误'))

    function ToneCard() {
      const [entry, setEntry] = useState(undefined)
      const [draft, setDraft] = useState('')
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const mounted = useRef(false)

      const load = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const data = await request('GET')
          if (!mounted.current) return
          setEntry(data)
          setDraft(data.text ?? '')
        } catch (failure) {
          if (mounted.current) setError(describe(failure))
        } finally {
          if (mounted.current) setLoading(false)
        }
      }, [])

      useEffect(() => {
        mounted.current = true
        void load()
        return () => { mounted.current = false }
      }, [load])

      async function save() {
        if (saving || entry === undefined) return
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const data = await request('PUT', { text: draft })
          if (!mounted.current) return
          setEntry({ ...entry, text: data.text ?? '', custom: true })
          setDraft(data.text ?? '')
          setNotice(`已保存 · r${data.revision}，下一轮请求生效；需要时可在 Superagent 的提示词历史里回退。`)
        } catch (failure) {
          if (mounted.current) setError(describe(failure))
        } finally {
          if (mounted.current) setSaving(false)
        }
      }

      const saved = (entry?.text ?? '').trim()
      const dirty = (draft ?? '').trim() !== saved
      const custom = entry?.custom === true

      return h('section', { className: 'vt-card', 'aria-busy': loading || saving },
        h('style', null, CSS),
        h('div', { className: 'vt-head' },
          h('div', null,
            h('h3', null, '语气'),
            h('p', { className: 'vt-sub' },
              'Superagent 主 Session 中文提示词里「怎么跟人说话」这一段：结论先行、长度、口气与不自我描述。'
              + '保存会写入 Superagent 的提示词，下一轮请求生效；那是一份带历史的新版本，可在 Settings → Prompts 回退。')),
          entry === undefined
            ? null
            : h('span', { className: `vt-badge ${custom ? 'custom' : ''}` }, custom ? '已自定义' : '插件默认')),

        loading && entry === undefined
          ? h('p', { className: 'vt-loading' }, '正在读取语气…')
          : null,

        entry === undefined
          ? null
          : h('textarea', {
            className: 'vt-textarea',
            value: draft,
            disabled: saving,
            spellCheck: false,
            'aria-label': '语气文本',
            onChange: event => { setDraft(event.target.value); setNotice('') },
          }),

        entry === undefined
          ? null
          : h('p', { className: 'vt-meta' },
            h('span', null, `${(draft ?? '').trim().length} 字符`
              + (typeof entry.maxChars === 'number' ? ` / ${entry.maxChars}` : '')),
            dirty ? h('span', null, '有未保存的修改') : null,
            h('span', null, '留空保存 = 去掉语气小节，只保留编排器规则')),

        h('div', { className: 'vt-actions' },
          h('button', {
            type: 'button',
            className: 'vt-btn primary',
            disabled: entry === undefined || saving || !dirty,
            onClick: save,
          }, saving ? '保存中…' : '保存'),
          h('button', {
            type: 'button',
            className: 'vt-btn',
            disabled: entry === undefined || saving,
            onClick: () => { setDraft(entry.defaultText ?? ''); setNotice('已载入插件默认语气，点「保存」写入。') },
          }, '恢复默认'),
          h('button', {
            type: 'button',
            className: 'vt-btn',
            disabled: loading || saving,
            onClick: () => { setNotice(''); void load() },
          }, loading ? '读取中…' : '重新读取')),

        error ? h('p', { className: 'vt-error', role: 'alert' }, error) : null,
        notice ? h('p', { className: 'vt-note ok', role: 'status' }, notice) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.laputa.item', () => ctx.slots.register({
          name: 'settings.laputa.item',
          id: 'vivy-tone',
          order: 10,
          inject: () => ({}),
        }, ToneCard))
      },
    }
  },
})
