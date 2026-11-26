import { Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { Archive, readArchives, revision, updateArchive } from "./archive";
import { Card, missingNoteLink, parseCanvas, Snapshot } from "./canvas";

const isCanvasPath = (path: string) => /\.canvas$/i.test(path);
const archivePath = (path: string) => path.slice(0, -".canvas".length) + ".md";

export default class SaveRemovedCanvas extends Plugin {
  private snapshots = new Map<TFile, Snapshot>();
  private archives = new Map<string, Archive>();
  private pending = Promise.resolve();
  private dirty = false;
  private stopped = false;

  async onload(): Promise<void> {
    try {
      this.archives = readArchives(await this.loadData());
    } catch (error) {
      this.report("Could not load archive ownership. Archiving is disabled.", error);
      return;
    }
    if (!globalThis.crypto?.subtle) {
      this.report("Archive verification is unavailable. Archiving is disabled.");
      return;
    }

    this.app.workspace.onLayoutReady(() => {
      if (this.stopped) return;
      const vault = this.app.vault;
      this.registerEvent(vault.on("create", file => this.observe(file)));
      this.registerEvent(vault.on("modify", file => this.observe(file)));
      this.registerEvent(vault.on("delete", file => this.invalidate(file, file.path, true)));
      this.registerEvent(vault.on("rename", (file, oldPath) => {
        this.invalidate(file, oldPath, !isCanvasPath(file.path));
        this.observe(file);
      }));
      for (const file of vault.getFiles()) this.observe(file);
    });
  }

  onunload(): void {
    this.stopped = true;
  }

  private schedule(context: string, operation: () => Promise<void>): void {
    this.pending = this.pending.then(async () => {
      if (this.stopped) return;
      await operation();
      if (this.dirty) {
        await this.saveData({ version: 1, archives: Object.fromEntries(this.archives) });
        this.dirty = false;
      }
    }).catch(error => this.report(context, error));
  }

  private observe(file: TAbstractFile): void {
    if (!(file instanceof TFile) || !isCanvasPath(file.path)) return;
    const path = file.path;
    const vault = this.app.vault;
    const read = vault.read(file).then(content => ({ content }), error => ({ error }));
    this.schedule(`Could not process Canvas "${path}".`, async () => {
      if (!isCanvasPath(file.path) || vault.getFileByPath(file.path) !== file) return;
      const result = await read;
      if (this.stopped || !isCanvasPath(file.path) || vault.getFileByPath(file.path) !== file) return;
      if ("error" in result) throw result.error;
      const next = parseCanvas(result.content);
      const previous = this.snapshots.get(file);
      if (previous && !await this.archiveChanges(file, previous, next)) return;
      this.snapshots.set(file, next);
    });
  }

  private invalidate(file: TAbstractFile, oldPath: string, forgetSnapshot: boolean): void {
    this.schedule(`Could not update archive ownership for "${oldPath}".`, async () => {
      if (forgetSnapshot && file instanceof TFile) this.snapshots.delete(file);
      if (forgetSnapshot && file instanceof TFolder) {
        for (const canvas of this.snapshots.keys()) {
          if (this.app.vault.getFileByPath(canvas.path) !== canvas) this.snapshots.delete(canvas);
        }
      }
      const path = isCanvasPath(oldPath) ? archivePath(oldPath) : oldPath;
      if (file instanceof TFolder) {
        for (const key of this.archives.keys()) {
          if (key.startsWith(`${oldPath}/`)) this.forgetArchive(key);
        }
      } else {
        this.forgetArchive(path);
      }
    });
  }

  private forgetArchive(path: string): void {
    if (this.archives.delete(path)) this.dirty = true;
  }

  private async archiveChanges(canvas: TFile, previous: Snapshot, next: Snapshot): Promise<boolean> {
    const canvasPath = canvas.path;
    const path = archivePath(canvasPath);
    const archive = this.archives.get(path);
    const restored = new Set(archive?.entries.filter(entry => next.has(entry.id) && !previous.has(entry.id))
      .map(entry => entry.id));
    const removed = [];
    for (const [id, card] of previous) {
      if (card && !next.has(id)) removed.push({ id, text: this.renderCard(card, path) });
    }
    if (!removed.length && !restored.size) return true;

    const vault = this.app.vault;
    const note = vault.getAbstractFileByPath(path);
    if (note && !(note instanceof TFile)) throw new Error(`Archive path "${path}" is not a file`);
    const original = note ? await vault.read(note) : [
      "---",
      "description: Archives text cards and note links removed from the source Canvas.",
      `canvas: ${JSON.stringify(`[[${canvasPath}]]`)}`,
      "---",
    ].join("\n");
    const currentRevision = await revision(original);
    const update = updateArchive(original, note ? archive : undefined, currentRevision, restored, removed);
    const nextRevision = update.content === original ? currentRevision : await revision(update.content);
    const canvasStillCurrent = () => !this.stopped && canvas.path === canvasPath && vault.getFileByPath(canvasPath) === canvas;
    if (!canvasStillCurrent()) return false;
    if (note) {
      if (note.path !== path || vault.getFileByPath(path) !== note) {
        throw new Error(`Archive "${path}" moved or was replaced while processing`);
      }
      if (update.content !== original) {
        let applied = false;
        await vault.process(note, current => {
          if (!canvasStillCurrent()) return current;
          if (note.path !== path || vault.getFileByPath(path) !== note) {
            throw new Error(`Archive "${path}" moved or was replaced while processing`);
          }
          if (current !== original) throw new Error(`Archive "${path}" changed while processing`);
          applied = true;
          return update.content;
        });
        if (!applied) return false;
      }
    } else if (removed.length) {
      await vault.create(path, update.content);
    }

    if (update.entries.length) {
      this.archives.set(path, { revision: nextRevision, entries: update.entries });
      this.dirty = true;
    } else {
      this.forgetArchive(path);
    }
    if (update.ambiguous) this.report(`Left ${update.ambiguous} restored card(s) in "${path}" because their entries could not be verified.`);
    return true;
  }

  private renderCard(card: Card, path: string): string {
    if (card.type === "text") return card.text;
    const file = this.app.vault.getFileByPath(card.path);
    return file
      ? this.app.fileManager.generateMarkdownLink(file, path, card.subpath)
      : missingNoteLink(card.path, path, card.subpath);
  }

  private report(message: string, error?: unknown): void {
    if (error !== undefined) console.error(`[Save Removed Canvas] ${message}`, error);
    new Notice(`Save Removed Canvas: ${message}`);
  }
}
