import type { PublicProfile } from "@/features/leads/scoring";

/** Upper bound on lines per import, so one paste cannot flood the queue. */
export const MAX_IMPORT_ROWS = 1000;

/** Instagram usernames: letters, digits, "." and "_", up to 30 characters. */
const HANDLE_RE = /^[a-z0-9._]{1,30}$/i;

/** Accepted header names (normalized) for each profile field, PT and EN. */
const COLUMN_ALIASES: Record<keyof PublicProfile, string[]> = {
  instagramHandle: ["handle", "instagram", "usuario", "username", "perfil", "@"],
  displayName: ["nome", "name", "displayname", "nome de exibicao"],
  bio: ["bio", "biografia", "descricao", "description"],
  category: ["categoria", "category", "nicho", "niche"],
  followerCount: ["seguidores", "followers", "followercount"],
  location: ["localizacao", "location", "cidade", "city", "local"],
  hashtags: ["hashtags", "tags"],
};

export interface ImportParseResult {
  profiles: PublicProfile[];
  /** Human-readable problems, one per rejected line (PT-BR, shown in the panel). */
  errors: string[];
}

function normalizeHeader(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_-]+/g, " ");
}

/** Split one CSV line, honoring double quotes ("a, b" and "" escapes). */
function splitCsvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === separator) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Accept "@loja", "loja" or a profile URL like https://instagram.com/loja/. */
export function parseHandle(raw: string): string | null {
  let value = raw.trim();
  const url = value.match(/instagram\.com\/([^/?#\s]+)/i);
  if (url) value = url[1];
  value = value.replace(/^@+/, "");
  return HANDLE_RE.test(value) ? `@${value.toLowerCase()}` : null;
}

function parseFollowers(raw: string): number | null {
  // "12.500", "12,500" and "12500" all mean 12500; "12k" / "1,2m" are expanded.
  const value = raw.trim().toLowerCase().replace(/\s/g, "");
  if (!value) return null;
  const suffix = value.match(/^([\d.,]+)(k|mil|m)$/);
  if (suffix) {
    const base = Number(suffix[1].replace(",", "."));
    if (Number.isNaN(base)) return null;
    return Math.round(base * (suffix[2] === "m" ? 1_000_000 : 1_000));
  }
  const digits = value.replace(/[.,]/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,;|]+/)
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean);
}

/**
 * Parse an operator-supplied lead list. Two formats are accepted:
 * - a CSV/TSV with a header row naming the columns (only the handle column is
 *   required; name, bio, category, followers, location and hashtags improve
 *   ICP scoring), separated by comma, semicolon or tab;
 * - a plain list with one handle or profile URL per line.
 * Duplicate handles within the file are dropped silently.
 */
export function parseLeadImport(text: string): ImportParseResult {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const errors: string[] = [];
  const profiles: PublicProfile[] = [];
  if (lines.length === 0) return { profiles, errors: ["Nenhuma linha para importar."] };

  const first = lines[0];
  const separator = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const header = splitCsvLine(first, separator).map(normalizeHeader);
  const columns = new Map<keyof PublicProfile, number>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [keyof PublicProfile, string[]][]) {
    const index = header.findIndex((h) => aliases.includes(h));
    if (index >= 0) columns.set(field, index);
  }

  const hasHeader = columns.has("instagramHandle");
  if (!hasHeader && header.length > 1) {
    return {
      profiles,
      errors: ['Cabeçalho sem coluna de perfil. Use uma coluna "handle" (ou "instagram", "usuario").'],
    };
  }

  const allRows = hasHeader ? lines.slice(1) : lines;
  const rows = allRows.slice(0, MAX_IMPORT_ROWS);
  if (allRows.length > rows.length) {
    errors.push(`Limite de ${MAX_IMPORT_ROWS} linhas por importação; ${allRows.length - rows.length} foram ignoradas.`);
  }
  const firstLineNumber = hasHeader ? 2 : 1;
  const seen = new Set<string>();
  rows.forEach((line, i) => {
    const lineNumber = firstLineNumber + i;
    const cells = hasHeader ? splitCsvLine(line, separator) : [line.trim()];
    const cell = (field: keyof PublicProfile): string => {
      const index = columns.get(field);
      return index === undefined ? "" : (cells[index] ?? "");
    };

    const rawHandle = hasHeader ? cell("instagramHandle") : cells[0];
    const handle = parseHandle(rawHandle);
    if (!handle) {
      errors.push(`Linha ${lineNumber}: perfil inválido "${rawHandle}".`);
      return;
    }
    if (seen.has(handle)) return;
    seen.add(handle);

    profiles.push({
      instagramHandle: handle,
      displayName: cell("displayName") || null,
      bio: cell("bio") || null,
      category: cell("category") || null,
      followerCount: parseFollowers(cell("followerCount")),
      location: cell("location") || null,
      hashtags: parseHashtags(cell("hashtags")),
    });
  });

  return { profiles, errors };
}
