import { useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  CheckCircle2,
  FileArchive,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Settings2,
  Table2,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import JSZip from 'jszip'
import ToolShell from '../../components/ToolShell'
import DropZone from '../../components/DropZone'
import { RenameField, splitExt } from '../../components/DownloadButton'
import { useIncomingFile } from '../../hooks/useIncomingFile'
import { BTN_TOGGLE_ACTIVE, BTN_TOGGLE_INACTIVE } from '../../utils/activeButtonStyles'
import { fmtBytes, downloadBlob } from '../../utils/helpers'
import {
  OUTPUT_SEPARATOR_CHOICES,
  SEPARATOR_CHOICES,
  decodeText,
  detectSeparator,
  extractSeparatorHint,
  parseDelimited,
  readWorkbook,
  rowsToCsv,
  rowsToXlsxBlob,
  separatorLabel,
  suggestFileName,
  suggestSheetName,
} from '../../utils/csvXlsx'

const PREVIEW_ROWS = 40
const PREVIEW_COLS = 15

function fileKind(name) {
  if (/\.(xlsx|xlsm)$/i.test(name)) return 'xlsx'
  if (/\.(csv|tsv|txt)$/i.test(name)) return 'csv'
  return ''
}

function previewCell(value) {
  const text = value == null ? '' : String(value).replace(/\r?\n/g, ' ⏎ ')
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

function itemRows(item, mode, separator) {
  if (mode === 'csv2xlsx') return item.csvText ? parseDelimited(item.csvText, separator) : []
  const sheet = item.sheets.find((s) => s.name === item.selectedSheet)
  return sheet ? sheet.rows : []
}

function uniqueName(name, used) {
  const { base, ext } = splitExt(name)
  let candidate = name
  let n = 2
  while (used.has(candidate.toLowerCase())) candidate = `${base}_${n++}${ext}`
  used.add(candidate.toLowerCase())
  return candidate
}

export default function CsvXlsx() {
  const [mode, setMode] = useState('csv2xlsx')
  const [items, setItems] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sepMode, setSepMode] = useState('auto')
  const [customSep, setCustomSep] = useState('')
  const [xlsxSheetName, setXlsxSheetName] = useState('')
  const [autoNumber, setAutoNumber] = useState(true)
  const [headerRow, setHeaderRow] = useState(true)
  const [utf8Bom, setUtf8Bom] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState([])
  const [zipBase, setZipBase] = useState('hasil_konversi')

  const separatorFor = (item) =>
    sepMode === 'auto' ? item.detectedSep : sepMode === 'custom' ? customSep || ',' : sepMode

  const active = items.find((i) => i.id === activeId) || items[0] || null
  const activeIndex = active ? items.findIndex((i) => i.id === active.id) : -1
  const goPreview = (delta) => {
    if (!items.length) return
    const next = (activeIndex + delta + items.length) % items.length
    setActiveId(items[next].id)
  }
  const rows = useMemo(
    () => (active ? itemRows(active, mode, separatorFor(active)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, mode, sepMode, customSep]
  )

  const columnCount = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.length), 0),
    [rows]
  )

  const clearResults = () => setResults([])

  const updateSeparator = (value) => { setSepMode(value); clearResults() }
  const updateCustomSeparator = (value) => { setCustomSep(value); clearResults() }
  const updateAutoNumber = (value) => { setAutoNumber(value); clearResults() }
  const updateHeaderRow = (value) => { setHeaderRow(value); clearResults() }
  const updateSheetName = (value) => { setXlsxSheetName(value); clearResults() }
  const updateUtf8Bom = (value) => { setUtf8Bom(value); clearResults() }

  const updateItemSheet = (id, name) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, selectedSheet: name } : i)))
    clearResults()
  }

  const removeItem = (id) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
    if (activeId === id) setActiveId(null)
    clearResults()
    setError('')
  }

  const switchMode = (next) => {
    if (next === mode || busy) return
    setMode(next)
    setItems([])
    setActiveId(null)
    clearResults()
    setError('')
    setSepMode(next === 'xlsx2csv' ? ',' : 'auto')
  }

  const readItem = async (file) => {
    const kind = fileKind(file.name)
    const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`
    if (kind === 'xlsx') {
      const sheets = await readWorkbook(file)
      if (!sheets.length) throw new Error('tidak memiliki sheet yang bisa dibaca')
      return { id, file, kind, sheets, selectedSheet: sheets[0].name, csvText: '', detectedSep: ',' }
    }
    const buffer = await file.arrayBuffer()
    let text = decodeText(buffer)
    const hint = extractSeparatorHint(text)
    let detectedSep
    if (hint) {
      text = hint.text
      detectedSep = hint.separator
    } else {
      detectedSep = detectSeparator(text)
    }
    if (!text.trim()) throw new Error('file kosong')
    return { id, file, kind, sheets: [], selectedSheet: '', csvText: text, detectedSep }
  }

  const loadFiles = async (selected) => {
    if (!selected?.length) return
    clearResults()
    setError('')

    // Mode mengikuti jenis file pertama bila berbeda dari mode saat ini.
    const firstKind = fileKind(selected[0].name)
    if (!firstKind) {
      setError('Format tidak didukung. Pilih file .csv, .tsv, .txt, .xlsx, atau .xlsm.')
      return
    }
    const nextMode = firstKind === 'xlsx' ? 'xlsx2csv' : 'csv2xlsx'
    const modeChanged = nextMode !== mode
    if (modeChanged) {
      setMode(nextMode)
      setSepMode(nextMode === 'xlsx2csv' ? ',' : 'auto')
    }

    const accepted = selected.filter((f) => fileKind(f.name) === firstKind)
    const skipped = selected.length - accepted.length
    const base = modeChanged ? [] : items

    setBusy(true)
    const loaded = []
    const problems = []
    for (const file of accepted) {
      if (base.some((i) => i.file.name === file.name && i.file.size === file.size)) continue
      try {
        loaded.push(await readItem(file))
      } catch (e) {
        problems.push(`${file.name}: ${e.message}`)
      }
    }
    setItems([...base, ...loaded])
    if (loaded.length && (modeChanged || !active)) setActiveId(loaded[0].id)
    const msgs = []
    if (skipped) msgs.push(`${skipped} file dilewati (format tidak sama dengan file pertama).`)
    if (problems.length) msgs.push(`Gagal membaca: ${problems.join('; ')}`)
    if (msgs.length) setError(msgs.join(' '))
    setBusy(false)
  }

  useIncomingFile((incoming) => loadFiles([incoming]))

  const runConvert = async () => {
    if (!items.length) return
    setBusy(true)
    setError('')
    setResults([])
    try {
      const used = new Set()
      const out = []
      const failed = []
      for (const item of items) {
        const itemData = itemRows(item, mode, separatorFor(item))
        if (!itemData.length) {
          failed.push(`${item.file.name}: tidak ada data`)
          continue
        }
        const base = suggestFileName(item.file.name)
        if (mode === 'csv2xlsx') {
          const blob = await rowsToXlsxBlob(itemData, {
            sheetName: xlsxSheetName.trim() || suggestSheetName(item.file.name),
            detectNumbers: autoNumber,
            headerRow,
          })
          out.push({ id: item.id, name: uniqueName(`${base}.xlsx`, used), blob, rowCount: itemData.length })
        } else {
          let csv = rowsToCsv(itemData, separatorFor(item))
          if (utf8Bom) csv = '﻿' + csv
          const name = item.sheets.length > 1
            ? `${suggestFileName(item.file.name, item.selectedSheet || 'sheet')}.csv`
            : `${base}.csv`
          out.push({
            id: item.id,
            name: uniqueName(name.replace(/[\\/:*?"<>|]/g, '_'), used),
            blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
            rowCount: itemData.length,
          })
        }
      }
      setResults(out)
      if (failed.length) setError(`Dilewati: ${failed.join('; ')}`)
    } catch (e) {
      setError(`Gagal konversi: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const renameResult = (id, base) =>
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, name: `${base}${splitExt(r.name).ext}` } : r)))

  const downloadResult = (r) => {
    const { base, ext } = splitExt(r.name)
    downloadBlob(r.blob, `${base.trim() || 'hasil'}${ext}`)
  }

  const downloadZip = async () => {
    setBusy(true)
    try {
      const zip = new JSZip()
      const used = new Set()
      for (const r of results) {
        const { base, ext } = splitExt(r.name)
        zip.file(uniqueName(`${base.trim() || 'hasil'}${ext}`, used), r.blob)
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      downloadBlob(blob, `${zipBase.trim() || 'hasil_konversi'}.zip`)
    } catch (e) {
      setError(`Gagal membuat ZIP: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const totalSize = results.reduce((sum, r) => sum + r.blob.size, 0)
  const hasFiles = items.length > 0

  const previewRows = rows.slice(0, PREVIEW_ROWS)
  const previewCols = Math.min(columnCount, PREVIEW_COLS)

  return (
    <ToolShell
      title="Konversi CSV ↔ Excel (XLSX)"
      description="Ubah CSV/TSV menjadi Excel (.xlsx) atau sebaliknya. Bisa banyak file sekaligus dan unduh semuanya dalam ZIP."
    >
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-(--color-border) bg-(--color-surface-2) p-1">
        <button
          type="button"
          onClick={() => switchMode('csv2xlsx')}
          disabled={busy}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
            mode === 'csv2xlsx'
              ? 'bg-(--color-brand) text-white shadow-xs'
              : 'text-(--color-text-2) hover:bg-(--color-surface-3) hover:text-(--color-text)'
          }`}
        >
          <FileSpreadsheet size={14} /> CSV → XLSX
        </button>
        <button
          type="button"
          onClick={() => switchMode('xlsx2csv')}
          disabled={busy}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
            mode === 'xlsx2csv'
              ? 'bg-(--color-brand) text-white shadow-xs'
              : 'text-(--color-text-2) hover:bg-(--color-surface-3) hover:text-(--color-text)'
          }`}
        >
          <ArrowRightLeft size={14} /> XLSX → CSV
        </button>
      </div>

      <DropZone
        accept={
          mode === 'csv2xlsx'
            ? '.csv,.tsv,.txt,text/csv,text/plain,application/vnd.ms-excel'
            : '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }
        multiple
        onFiles={loadFiles}
        label={mode === 'csv2xlsx' ? 'Pilih satu atau banyak file CSV untuk diubah ke Excel' : 'Pilih satu atau banyak file Excel untuk diubah ke CSV'}
        hint={
          mode === 'csv2xlsx'
            ? '.csv · .tsv · .txt — pemisah kolom dideteksi otomatis'
            : '.xlsx · .xlsm — bisa pilih sheet sebelum konversi'
        }
      />

      {hasFiles && (
        <div className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
          <div className="flex items-center justify-between border-b border-(--color-border) bg-(--color-surface-2) px-3 py-2 text-xs font-bold text-(--color-text)">
            <span>{items.length} file dipilih</span>
            <button
              type="button"
              onClick={() => { setItems([]); setActiveId(null); clearResults(); setError('') }}
              className="text-[11px] font-semibold text-(--color-danger) hover:underline cursor-pointer"
            >
              Hapus semua
            </button>
          </div>
          <ul className="divide-y divide-(--color-border)">
            {items.map((item) => (
              <li
                key={item.id}
                className={`flex flex-wrap items-center gap-2 px-3 py-2 text-xs ${active?.id === item.id ? 'bg-(--color-surface-2)' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(item.id)}
                  className="min-w-0 flex-1 truncate text-left font-medium text-(--color-text) cursor-pointer"
                  title="Tampilkan pratinjau"
                >
                  {item.file.name}
                  <span className="ml-1.5 font-normal text-(--color-text-3)">{fmtBytes(item.file.size)}</span>
                </button>
                {mode === 'xlsx2csv' && item.sheets.length > 1 && (
                  <select
                    value={item.selectedSheet}
                    onChange={(e) => updateItemSheet(item.id, e.target.value)}
                    className="max-w-40 rounded border border-(--color-border) bg-(--color-surface) px-1.5 py-1 text-xs text-(--color-text) outline-none focus:border-(--color-brand)"
                  >
                    {item.sheets.map((sheet) => (
                      <option key={sheet.name} value={sheet.name}>{sheet.name} ({sheet.rows.length})</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={busy}
                  className="rounded p-1 text-(--color-text-3) hover:bg-(--color-surface-3) cursor-pointer"
                  title="Hapus"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {busy && !hasFiles && (
        <div className="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-surface) p-3 text-sm text-(--color-text-2)">
          <Loader2 size={16} className="animate-spin text-(--color-brand)" /> Membaca file…
        </div>
      )}

      {error && (
        <p className="rounded border border-(--color-danger-light) bg-(--color-danger-light) px-3 py-2 text-sm text-(--color-danger)">
          {error}
        </p>
      )}

      {hasFiles && (
        <div className="space-y-4 rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
            <Settings2 size={15} className="text-(--color-brand)" /> Opsi konversi
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-(--color-text-2)">
              {mode === 'csv2xlsx' ? 'Pemisah kolom CSV' : 'Pemisah kolom CSV hasil'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(mode === 'csv2xlsx' ? SEPARATOR_CHOICES : OUTPUT_SEPARATOR_CHOICES).map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => updateSeparator(choice.id)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
                    sepMode === choice.id ? BTN_TOGGLE_ACTIVE : BTN_TOGGLE_INACTIVE
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>

            {mode === 'csv2xlsx' && sepMode === 'auto' && (
              <p className="text-xs text-(--color-text-3)">
                Terdeteksi otomatis:{' '}
                <span className="font-semibold text-(--color-brand)">
                  {items.length === 1
                    ? separatorLabel(items[0].detectedSep)
                    : 'per file (dideteksi satu per satu)'}
                </span>
              </p>
            )}

            {sepMode === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={1}
                  value={customSep}
                  onChange={(e) => updateCustomSeparator(e.target.value)}
                  placeholder="Contoh: :"
                  className="w-24 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm text-(--color-text) outline-none focus:border-(--color-brand)"
                />
                <span className="text-xs text-(--color-text-3)">Satu karakter pemisah</span>
              </div>
            )}
          </div>

          {mode === 'csv2xlsx' ? (
            <>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-(--color-text-2) select-none">
                <input
                  type="checkbox"
                  checked={autoNumber}
                  onChange={(e) => updateAutoNumber(e.target.checked)}
                  className="mt-0.5 cursor-pointer accent-(--color-brand)"
                />
                <span>
                  Deteksi angka otomatis
                  <span className="block text-[11px] text-(--color-text-3)">
                    Nilai seperti 1234 atau 12.5 ditulis sebagai angka Excel. Angka dengan nol di depan tetap teks.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-(--color-text-2) select-none">
                <input
                  type="checkbox"
                  checked={headerRow}
                  onChange={(e) => updateHeaderRow(e.target.checked)}
                  className="mt-0.5 cursor-pointer accent-(--color-brand)"
                />
                <span>
                  Baris pertama adalah header
                  <span className="block text-[11px] text-(--color-text-3)">
                    Baris pertama ditebalkan dan dibekukan saat dibuka di Excel.
                  </span>
                </span>
              </label>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-(--color-text-2)">Nama sheet</label>
                <input
                  type="text"
                  maxLength={31}
                  placeholder="Otomatis dari nama file"
                  value={xlsxSheetName}
                  onChange={(e) => updateSheetName(e.target.value)}
                  className="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-brand)"
                />
              </div>
            </>
          ) : (
            <label className="flex cursor-pointer items-start gap-2 text-xs text-(--color-text-2) select-none">
              <input
                type="checkbox"
                checked={utf8Bom}
                onChange={(e) => updateUtf8Bom(e.target.checked)}
                className="mt-0.5 cursor-pointer accent-(--color-brand)"
              />
              <span>
                Tambahkan BOM UTF-8
                <span className="block text-[11px] text-(--color-text-3)">
                  Disarankan agar Excel di Windows membaca huruf beraksen dan karakter non-ASCII dengan benar.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {hasFiles && (
        <div className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-border) bg-(--color-surface-2) px-3 py-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-(--color-text)">
              <Table2 size={14} className="shrink-0 text-(--color-brand)" />
              <span className="truncate" title={active?.file.name}>Pratinjau{active ? ` — ${active.file.name}` : ''}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-(--color-text-3)">
                {rows.length.toLocaleString('id-ID')} baris · {columnCount.toLocaleString('id-ID')} kolom
              </span>
              {items.length > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => goPreview(-1)}
                    className="rounded border border-(--color-border) p-1 text-(--color-text-2) hover:bg-(--color-surface-3) cursor-pointer"
                    title="File sebelumnya"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="min-w-12 text-center text-[11px] font-semibold text-(--color-text-2)">
                    {activeIndex + 1} / {items.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => goPreview(1)}
                    className="rounded border border-(--color-border) p-1 text-(--color-text-2) hover:bg-(--color-surface-3) cursor-pointer"
                    title="File berikutnya"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
          {rows.length === 0 && (
            <p className="px-3 py-4 text-xs text-(--color-text-3)">Tidak ada data untuk ditampilkan.</p>
          )}
          {rows.length > 0 && (
          <div className="max-h-80 overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className={rowIndex === 0 && headerRow ? 'bg-(--color-surface-2)' : ''}
                  >
                    <td className="border-b border-(--color-border) px-2 py-1.5 text-right font-mono text-[10px] text-(--color-text-3) align-top">
                      {rowIndex + 1}
                    </td>
                    {Array.from({ length: previewCols }, (_, colIndex) => (
                      <td
                        key={colIndex}
                        className={`max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-(--color-border) px-2 py-1.5 align-top ${
                          rowIndex === 0 && headerRow
                            ? 'font-semibold text-(--color-text)'
                            : 'text-(--color-text-2)'
                        }`}
                      >
                        {previewCell(row[colIndex])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {(rows.length > PREVIEW_ROWS || columnCount > PREVIEW_COLS) && (
            <p className="border-t border-(--color-border) px-3 py-2 text-[11px] text-(--color-text-3)">
              Menampilkan {Math.min(rows.length, PREVIEW_ROWS)} baris pertama
              {columnCount > PREVIEW_COLS ? ` dan ${PREVIEW_COLS} kolom pertama` : ''}. Semua data tetap ikut
              dikonversi.
            </p>
          )}
        </div>
      )}

      {hasFiles && (
        <button
          type="button"
          onClick={runConvert}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-(--color-brand) px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-(--color-brand-hover) active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
          {busy
            ? 'Memproses…'
            : mode === 'csv2xlsx'
              ? `Konversi ${items.length > 1 ? `${items.length} file ` : ''}ke Excel (.xlsx)`
              : `Konversi ${items.length > 1 ? `${items.length} file ` : ''}ke CSV`}
        </button>
      )}

      {results.length > 0 && (
        <div className="space-y-3 rounded-lg border border-(--color-success-light) bg-(--color-success-light) p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-(--color-success)">
            <CheckCircle2 size={16} /> Konversi selesai
            <span className="font-normal text-(--color-text-3)">
              · {results.length} file · {fmtBytes(totalSize)}
            </span>
          </p>

          <ul className="space-y-2">
            {results.map((r) => {
              const { base, ext } = splitExt(r.name)
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <RenameField
                    base={base}
                    ext={ext}
                    onChange={(v) => renameResult(r.id, v)}
                    onEnter={() => downloadResult(r)}
                    className="basis-48 flex-1"
                  />
                  <span className="text-[11px] text-(--color-text-3)">
                    {fmtBytes(r.blob.size)} · {r.rowCount.toLocaleString('id-ID')} baris
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadResult(r)}
                    className="flex items-center gap-1.5 rounded bg-(--color-success) px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 cursor-pointer"
                  >
                    <FileDown size={14} /> Unduh
                  </button>
                </li>
              )
            })}
          </ul>

          {results.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-(--color-border) pt-3">
              <RenameField
                base={zipBase}
                ext=".zip"
                onChange={setZipBase}
                onEnter={downloadZip}
                className="basis-48 flex-1"
              />
              <button
                type="button"
                onClick={downloadZip}
                disabled={busy}
                className="flex items-center gap-1.5 rounded bg-(--color-success) px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60 cursor-pointer"
              >
                <FileArchive size={14} /> Unduh semua (ZIP)
              </button>
            </div>
          )}
        </div>
      )}
    </ToolShell>
  )
}
