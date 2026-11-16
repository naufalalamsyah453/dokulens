import { useState, useEffect } from 'react'
import { downloadBlob } from '../utils/helpers'

export function splitExt(name) {
  const m = (name || '').match(/^(.*?)(\.[^.]+)?$/)
  return { base: m[1] || name || '', ext: m[2] || '' }
}

export function sanitizeBase(value) {
  return value.replace(/[\\/:*?"<>|]/g, '')
}

/** Input nama file inline: bagian nama bisa diedit, ekstensi tetap. */
export function RenameField({ base, ext, onChange, onEnter, className = '' }) {
  return (
    <div className={`flex min-w-0 items-center gap-1 ${className}`}>
      <input
        value={base}
        onChange={(e) => onChange(sanitizeBase(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }}
        placeholder="Nama file"
        aria-label="Nama file"
        className="min-w-0 flex-1 rounded border px-2 py-1.5 text-sm outline-none focus:border-(--color-brand)"
        style={{ borderColor: 'var(--color-border, #e5e7eb)', color: 'var(--color-text, #111)', background: 'var(--color-surface, #fff)' }}
      />
      <span className="select-none text-sm" style={{ color: 'var(--color-text-3, #6b7280)' }}>{ext}</span>
    </div>
  )
}

/**
 * Input nama file (inline, tanpa popup) + tombol unduh dalam satu baris.
 * Tempatkan di dalam kartu "selesai" agar nama & unduh jadi satu bagian.
 */
export default function DownloadButton({
  blob,
  fileName,
  children,
  className,
  onNameChange,
  onDownload,
}) {
  const init = splitExt(fileName)
  const [nameBase, setNameBase] = useState(init.base)

  // Sinkronkan bila nama dari induk berubah (mis. hasil baru).
  useEffect(() => { setNameBase(splitExt(fileName).base) }, [fileName])

  const doDownload = () => {
    const base = nameBase.trim() || init.base
    const name = `${base}${init.ext}`
    if (base !== init.base && onNameChange) onNameChange(base)
    if (onDownload) onDownload(name)
    else if (blob) downloadBlob(blob, name)
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <RenameField
        base={nameBase}
        ext={init.ext}
        onChange={setNameBase}
        onEnter={doDownload}
        className="basis-40 flex-1"
      />
      <button type="button" onClick={doDownload} className={className}>
        {children}
      </button>
    </div>
  )
}
