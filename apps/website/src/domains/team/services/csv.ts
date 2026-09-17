/**
 * Minimal RFC 4180 CSV parser — no dependency exists anywhere in this
 * monorepo for this (checked before writing it), and the real schedule
 * export needs it: several of its own date cells are quoted because they
 * contain a literal comma (e.g. `"March 5,2025"`), which a naive
 * `line.split(",")` would silently corrupt. Handles quoted fields,
 * embedded commas/newlines within quotes, and escaped `""` for a literal
 * quote character — the exact subset Google Sheets' own CSV export uses.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      // Bare CR outside quotes — ignore; CRLF is handled by the \n branch below.
      continue;
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Trailing field/row with no final newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
