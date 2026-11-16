import readExcelFile from 'read-excel-file/browser'
import writeExcelFile from 'write-excel-file/browser'

export const SEPARATOR_CHOICES = [
  { id: 'auto', label: 'Auto-deteksi', short: 'Auto' },
  { id: ',', label: 'Koma  ,', short: 'Koma' },
  { id: ';', label: 'Titik koma  ;', short: 'Titik koma' },
  { id: '\t', label: 'Tab  ⇥', short: 'Tab' },
  { id: '|', label: 'Pipe  |', short: 'Pipe' },
  { id: 'custom', label: 'Lainnya…', short: 'Custom' },
]

export const OUTPUT_SEPARATOR_CHOICES = SEPARATOR_CHOICES.filter((s) => s.id !== 'auto')

export function separatorLabel(sep) {
  if (sep === ',') return 'Koma (,)'
  if (sep === ';') return 'Titik koma (;)'
  if (sep === '\t') return 'Tab'
  if (sep === '|') return 'Pipe (|)'
  if (sep === ' ') return 'Spasi'
  return `"${sep}"`
}

/** Decode CSV bytes, tolerating BOM, UTF-16 and legacy Windows-1252 files. */
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Excel sometimes writes a "sep=;" preamble. Return it so it can be honoured. */
export function extractSeparatorHint(text) {
  const match = /^sep=(.)\r?\n/i.exec(text)
  if (!match) return null
  return { separator: match[1], text: text.slice(match[0].length) }
}

function countDelimiter(line, delimiter) {
  let count = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++
        continue
      }
      inQuotes = !inQuotes
    } else if (!inQuotes && ch === delimiter) {
      count++
    }
  }
  return count
}

/** Take the first N logical records (newlines inside quotes don't split a record). */
function sampleRecords(text, max = 60) {
  const records = []
  let start = 0
  let inQuotes = false
  for (let i = 0; i < text.length && records.length < max; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++
        continue
      }
      inQuotes = !inQuotes
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      records.push(text.slice(start, i))
      start = i + 1
    }
  }
  if (records.length < max && start < text.length) records.push(text.slice(start))
  return records.filter((r) => r !== '')
}

/**
 * Guess the delimiter by looking for the candidate that produces the most
 * consistent number of columns across the first records.
 */
export function detectSeparator(text) {
  const clean = stripBom(text)
  const records = sampleRecords(clean)
  if (!records.length) return ','

  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestScore = -1

  for (const candidate of candidates) {
    const counts = records.map((line) => countDelimiter(line, candidate))
    const frequency = new Map()
    let maxFrequency = 0
    let mostCommon = 0
    let rowsWithDelimiter = 0
    for (const count of counts) {
      if (count <= 0) continue
      rowsWithDelimiter++
      const next = (frequency.get(count) || 0) + 1
      frequency.set(count, next)
      if (next > maxFrequency || (next === maxFrequency && count > mostCommon)) {
        maxFrequency = next
        mostCommon = count
      }
    }
    if (!rowsWithDelimiter) continue
    const consistency = maxFrequency / records.length
    const score = consistency * 1000 + Math.min(mostCommon, 100) + Math.min(rowsWithDelimiter, 60) * 2
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

/** RFC 4180-style parser with quoted fields, escaped quotes and embedded newlines. */
export function parseDelimited(text, delimiter = ',') {
  const src = stripBom(text)
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < src.length) {
    const ch = src[i]

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"' && field === '') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }

  row.push(field)
  rows.push(row)

  // Drop trailing completely-empty records (usually caused by a final newline).
  while (rows.length && rows[rows.length - 1].every((cell) => cell === '')) rows.pop()
  return rows
}

function csvEscape(value, delimiter) {
  const text = value == null ? '' : String(value)
  const needsQuotes =
    text.includes('"') ||
    text.includes(delimiter) ||
    /[\r\n]/.test(text) ||
    /^\s|\s$/.test(text)
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text
}

export function rowsToCsv(rows, delimiter = ',') {
  return rows
    .map((row) => row.map((cell) => csvEscape(cell, delimiter)).join(delimiter))
    .join('\r\n')
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const h = date.getUTCHours()
  const m = date.getUTCMinutes()
  const s = date.getUTCSeconds()
  return h || m || s ? `${day} ${pad(h)}:${pad(m)}:${pad(s)}` : day
}

export function formatCell(value) {
  if (value == null) return ''
  if (value instanceof Date) return formatDate(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function normalizeRows(rows) {
  const normalized = rows.map((row) => {
    const cells = row.map(formatCell)
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    return cells
  })
  while (normalized.length && normalized[normalized.length - 1].length === 0) normalized.pop()
  return normalized
}

/** Read every sheet from an .xlsx/.xlsm file as plain string rows. */
export async function readWorkbook(file) {
  const sheets = await readExcelFile(file)
  return sheets.map((sheet) => ({
    name: sheet.sheet,
    rows: normalizeRows(sheet.data || []),
  }))
}

function numericValue(value) {
  const text = value.trim()
  if (!text) return null
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return null
  if (/^[+-]?0\d/.test(text)) return null // preserve leading zeros (Kode pos, NIK, dll.)
  const digits = text.replace(/\D/g, '')
  if (digits.length > 15) return null // beyond Excel's reliable precision
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

function safeSheetName(name) {
  const cleaned = String(name || '').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31)
  return cleaned || 'Sheet1'
}

/**
 * Build an .xlsx Blob from string rows.
 * Numeric-looking values can be written as real numbers so Excel treats them as numbers.
 */
export async function rowsToXlsxBlob(rows, { sheetName, detectNumbers = true, headerRow = true } = {}) {
  if (!rows.length) throw new Error('Tidak ada data untuk dikonversi.')

  const data = rows.map((row, rowIndex) =>
    row.map((cell) => {
      const text = cell == null ? '' : String(cell)
      if (!text) return null

      const numeric = detectNumbers ? numericValue(text) : null
      const value = numeric == null ? text : numeric

      if (headerRow && rowIndex === 0) {
        return { value, fontWeight: 'bold', backgroundColor: '#F1F5F9' }
      }
      return value
    })
  )

  const columnCount = Math.max(...rows.map((row) => row.length), 1)
  const columns = Array.from({ length: columnCount }, (_, index) => {
    let width = 10
    for (let r = 0; r < Math.min(rows.length, 200); r++) {
      const length = rows[r]?.[index]?.length || 0
      if (length + 2 > width) width = length + 2
    }
    return { width: Math.min(60, width) }
  })

  return writeExcelFile(data, {
    sheet: safeSheetName(sheetName),
    columns,
    stickyRowsCount: headerRow ? 1 : 0,
  }).toBlob()
}

export function suggestSheetName(fileName) {
  return safeSheetName(String(fileName || '').replace(/\.[^.]+$/, ''))
}

export function suggestFileName(fileName, suffix = '') {
  const base = String(fileName || 'data').replace(/\.[^.]+$/, '')
  return suffix ? `${base}_${suffix}` : base
}
