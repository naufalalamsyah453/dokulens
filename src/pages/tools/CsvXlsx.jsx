import { useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Settings2,
  Table2,
} from 'lucide-react'
import ToolShell from '../../components/ToolShell'
import DropZone from '../../components/DropZone'
import FilePreview from '../../components/FilePreview'
import DownloadButton from '../../components/DownloadButton'
import { useIncomingFile } from '../../hooks/useIncomingFile'
import { BTN_TOGGLE_ACTIVE, BTN_TOGGLE_INACTIVE } from '../../utils/activeButtonStyles'
import { fmtBytes } from '../../utils/helpers'
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

export default function CsvXlsx() {
  const [mode, setMode] = useState('csv2xlsx')
  const [file, setFile] = useState(null)
  const [csvText, setCsvText] = useState('')
  const [detectedSep, setDetectedSep] = useState(',')
  const [sepMode, setSepMode] = useState('auto')
  const [customSep, setCustomSep] = useState('')
  const [sheets, setSheets] = useState([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [xlsxSheetName, setXlsxSheetName] = useState('Sheet1')
  const [autoNumber, setAutoNumber] = useState(true)
  const [headerRow, setHeaderRow] = useState(true)
  const [utf8Bom, setUtf8Bom] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const effectiveSeparator =
    sepMode === 'auto' ? detectedSep : sepMode === 'custom' ? customSep || ',' : sepMode

  const rows = useMemo(() => {
    if (mode === 'csv2xlsx') {
      if (!csvText) return []
      return parseDelimited(csvText, effectiveSeparator)
    }
    const sheet = sheets.find((item) => item.name === selectedSheet)
    return sheet ? sheet.rows : []
  }, [mode, csvText, effectiveSeparator, sheets, selectedSheet])

  const columnCount = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.length), 0),
    [rows]
  )

  // Results depend on the parsed data & options; invalidate them when those change.
  const resetResult = () => {
    setResult(null)
    setError('')
  }

  const updateSeparator = (value) => {
    setSepMode(value)
    setResult(null)
  }

  const updateCustomSeparator = (value) => {
    setCustomSep(value)
    setResult(null)
  }

  const updateSheet = (name) => {
    setSelectedSheet(name)
    setResult(null)
  }

  const updateAutoNumber = (value) => {
    setAutoNumber(value)
    setResult(null)
  }

  const updateHeaderRow = (value) => {
    setHeaderRow(value)
    setResult(null)
  }

  const updateSheetName = (value) => {
    setXlsxSheetName(value)
    setResult(null)
  }

  const updateUtf8Bom = (value) => {
    setUtf8Bom(value)
    setResult(null)
  }

  const switchMode = (next) => {
    if (next === mode || busy) return
    setMode(next)
    setFile(null)
    setCsvText('')
    setSheets([])
    setSelectedSheet('')
    setResult(null)
    setError('')
    if (next === 'xlsx2csv' && sepMode === 'auto') setSepMode(',')
    if (next === 'csv2xlsx') setSepMode('auto')
  }

  const loadFile = async ([selected]) => {
    resetResult()
    setFile(selected)
    setCsvText('')
    setSheets([])
    setSelectedSheet('')
    setBusy(true)

    try {
      const kind = fileKind(selected.name)
      if (kind === 'xlsx') {
        setMode('xlsx2csv')
        if (sepMode === 'auto') setSepMode(',')
        const loaded = await readWorkbook(selected)
        setSheets(loaded)
        setSelectedSheet(loaded[0]?.name || '')
        setXlsxSheetName(suggestSheetName(selected.name))
        if (!loaded.length) setError('File Excel tidak memiliki sheet yang bisa dibaca.')
      } else if (kind === 'csv') {
        setMode('csv2xlsx')
        const buffer = await selected.arrayBuffer()
        let text = decodeText(buffer)
        const hint = extractSeparatorHint(text)
        if (hint) {
          text = hint.text
          setDetectedSep(hint.separator)
          setSepMode('auto')
        } else {
          setDetectedSep(detectSeparator(text))
          setSepMode('auto')
        }
        setCsvText(text)
        setXlsxSheetName(suggestSheetName(selected.name))
        if (!text.trim()) setError('File CSV kosong.')
      } else {
        setError('Format tidak didukung. Pilih file .csv, .tsv, .txt, .xlsx, atau .xlsm.')
        setFile(null)
      }
    } catch (e) {
      setError(`Gagal membaca file: ${e.message}`)
      setFile(null)
    } finally {
      setBusy(false)
    }
  }

  useIncomingFile((incoming) => loadFile([incoming]))

  const runConvert = async () => {
    if (!file || !rows.length) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      if (mode === 'csv2xlsx') {
        const blob = await rowsToXlsxBlob(rows, {
          sheetName: xlsxSheetName,
          detectNumbers: autoNumber,
          headerRow,
        })
        setResult({ blob, type: 'xlsx' })
      } else {
        let csv = rowsToCsv(rows, effectiveSeparator)
        if (utf8Bom) csv = '\uFEFF' + csv
        setResult({ blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), type: 'csv' })
      }
    } catch (e) {
      setError(`Gagal konversi: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const baseName = file ? suggestFileName(file.name) : 'data'
  const resultName = file
    ? mode === 'csv2xlsx'
      ? `${baseName}.xlsx`
      : `${suggestFileName(file.name, selectedSheet || 'sheet')}.csv`.replace(/[\\/:*?"<>|]/g, '_')
    : ''

  const previewRows = rows.slice(0, PREVIEW_ROWS)
  const previewCols = Math.min(columnCount, PREVIEW_COLS)

  return (
    <ToolShell
      title="Konversi CSV ↔ Excel (XLSX)"
      description="Ubah CSV/TSV menjadi Excel (.xlsx) atau sebaliknya. Pemisah kolom bisa dideteksi otomatis atau dipilih manual."
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
        multiple={false}
        onFiles={loadFile}
        label={mode === 'csv2xlsx' ? 'Pilih file CSV untuk diubah ke Excel' : 'Pilih file Excel untuk diubah ke CSV'}
        hint={
          mode === 'csv2xlsx'
            ? '.csv · .tsv · .txt — pemisah kolom dideteksi otomatis'
            : '.xlsx · .xlsm — bisa pilih sheet sebelum konversi'
        }
      />

      {file && <FilePreview file={file} />}

      {busy && !rows.length && (
        <div className="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-surface) p-3 text-sm text-(--color-text-2)">
          <Loader2 size={16} className="animate-spin text-(--color-brand)" /> Membaca file…
        </div>
      )}

      {error && (
        <p className="rounded border border-(--color-danger-light) bg-(--color-danger-light) px-3 py-2 text-sm text-(--color-danger)">
          {error}
        </p>
      )}

      {file && (
        <div className="space-y-4 rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
            <Settings2 size={15} className="text-(--color-brand)" /> Opsi konversi
          </div>

          {mode === 'xlsx2csv' && sheets.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-(--color-text-2)">Sheet</label>
              <select
                value={selectedSheet}
                onChange={(e) => updateSheet(e.target.value)}
                className="w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-brand)"
              >
                {sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rows.length} baris)
                  </option>
                ))}
              </select>
            </div>
          )}

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
                <span className="font-semibold text-(--color-brand)">{separatorLabel(detectedSep)}</span>
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

      {file && rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-border) bg-(--color-surface-2) px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-(--color-text)">
              <Table2 size={14} className="text-(--color-brand)" /> Pratinjau data
            </span>
            <span className="text-[11px] font-medium text-(--color-text-3)">
              {rows.length.toLocaleString('id-ID')} baris · {columnCount.toLocaleString('id-ID')} kolom
            </span>
          </div>
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
          {(rows.length > PREVIEW_ROWS || columnCount > PREVIEW_COLS) && (
            <p className="border-t border-(--color-border) px-3 py-2 text-[11px] text-(--color-text-3)">
              Menampilkan {Math.min(rows.length, PREVIEW_ROWS)} baris pertama
              {columnCount > PREVIEW_COLS ? ` dan ${PREVIEW_COLS} kolom pertama` : ''}. Semua data tetap ikut
              dikonversi.
            </p>
          )}
        </div>
      )}

      {file && rows.length > 0 && (
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
              ? 'Konversi ke Excel (.xlsx)'
              : 'Konversi ke CSV'}
        </button>
      )}

      {result && (
        <div className="rounded-lg border border-(--color-success-light) bg-(--color-success-light) p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-(--color-success)">
            <CheckCircle2 size={16} /> Konversi selesai
          </p>
          <p className="mt-0.5 text-sm text-(--color-text-2)">
            {resultName} — {fmtBytes(result.blob.size)} · {rows.length.toLocaleString('id-ID')} baris
          </p>
          <DownloadButton
            blob={result.blob}
            fileName={resultName}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-(--color-success) px-4 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 cursor-pointer"
          >
            <FileDown size={16} /> Unduh {result.type === 'xlsx' ? 'Excel (.xlsx)' : 'CSV'}
          </DownloadButton>
        </div>
      )}
    </ToolShell>
  )
}
