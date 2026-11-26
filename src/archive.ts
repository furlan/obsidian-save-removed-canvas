import { isRecord } from "./canvas";

type Range = { start: number; end: number; separator: number };
type Entry = { id: string; range: Range | null };
export type Archive = { revision: string; entries: Entry[] };

const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

export async function revision(content: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function validEntry(value: unknown): value is Entry {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  const range = value.range;
  return range === null || (isRecord(range) &&
    typeof range.start === "number" && Number.isSafeInteger(range.start) && range.start >= 0 &&
    typeof range.end === "number" && Number.isSafeInteger(range.end) &&
    (range.separator === 0 || range.separator === 2) && range.end >= range.start + range.separator);
}

export function readArchives(data: unknown): Map<string, Archive> {
  const result = new Map<string, Archive>();
  if (data == null) return result;
  if (!isRecord(data) || data.version !== 1 || !isRecord(data.archives)) {
    throw new Error("Invalid archive ownership data");
  }
  for (const [path, archive] of Object.entries(data.archives)) {
    if (!isRecord(archive) || typeof archive.revision !== "string" || !/^[0-9a-f]{64}$/.test(archive.revision) ||
        !Array.isArray(archive.entries) || !archive.entries.every(validEntry)) {
      throw new Error("Invalid archive entry data");
    }
    let end = 0;
    const ids = new Set<string>();
    for (const entry of archive.entries) {
      if (ids.has(entry.id) || (entry.range && entry.range.start < end)) {
        throw new Error("Overlapping or duplicate archive entries");
      }
      ids.add(entry.id);
      if (entry.range) end = entry.range.end;
    }
    result.set(path, { revision: archive.revision, entries: archive.entries });
  }
  return result;
}

export function updateArchive(
  original: string,
  archive: Archive | undefined,
  currentRevision: string,
  restored: Set<string>,
  removed: { id: string; text: string }[],
): { content: string; entries: Entry[]; ambiguous: number } {
  let content = original;
  let ambiguous = 0;
  const entries: Entry[] = [];
  const reRemoved = new Set(removed.map(entry => entry.id));
  let deleted = 0;
  const trusted = archive?.revision === currentRevision && archive.entries.every(entry =>
    !entry.range || (entry.range.end <= original.length &&
      (!entry.range.separator || original.startsWith("\n\n", entry.range.start))),
  );

  for (const entry of archive?.entries ?? []) {
    if (reRemoved.has(entry.id)) continue;
    const range = trusted ? entry.range : null;
    if (restored.has(entry.id)) {
      if (!range) {
        ambiguous++;
        continue;
      }
      content = content.slice(0, range.start - deleted) + content.slice(range.end - deleted);
      deleted += range.end - range.start;
    } else {
      entries.push({ id: entry.id, range: range && {
        start: range.start - deleted,
        end: range.end - deleted,
        separator: range.separator,
      } });
    }
  }

  // Trim leading blank lines when an entry becomes first, but keep its horizontal rule.
  const first = entries.find(entry => entry.range && entry.range.end > entry.range.start);
  if (first?.range?.start === 0 && first.range.separator) {
    const separator = first.range.separator;
    content = content.slice(separator);
    for (const { range } of entries) {
      if (!range || range.end === 0) continue;
      range.start = Math.max(0, range.start - separator);
      range.end -= separator;
    }
    first.range.separator = 0;
  }

  const timestamp = removed.length ? timestampFormat.format(new Date()) : "";
  for (const { id, text } of removed) {
    const start = content.length;
    const separator = start ? 2 : 0;
    content += `${separator ? "\n\n" : ""}***\n\n${timestamp}\n\n${text}`;
    entries.push({ id, range: { start, end: content.length, separator } });
  }
  return { content, entries, ambiguous };
}
