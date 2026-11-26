import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

class TAbstractFile {
  constructor(path) {
    this.path = path;
  }
}
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile {}

const archivedAt = "2026-11-26T20:34:56Z";
function entry(text, time = archivedAt) {
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
  return `***\n\n${date.format(new Date(time))}\n\n${text}`;
}

function harness() {
  const events = new EventEmitter();
  const files = new Map();
  const notes = [];
  const links = [];
  let data;
  let beforeProcess;
  let time = archivedAt;
  const put = (path, content) => {
    if (files.has(path)) throw new Error(`File already exists: ${path}`);
    const file = new TFile(path);
    file.content = content;
    files.set(path, file);
    events.emit("create", file);
    return file;
  };
  const change = (file, content) => {
    file.content = content;
    events.emit("modify", file);
  };
  const remove = file => {
    files.delete(file.path);
    events.emit("delete", file);
  };
  const rename = (file, path) => {
    const old = file.path;
    files.delete(old);
    file.path = path;
    files.set(path, file);
    events.emit("rename", file, old);
  };
  const app = {
    workspace: { onLayoutReady: callback => callback() },
    vault: {
      on: (name, callback) => {
        events.on(name, callback);
        return () => events.off(name, callback);
      },
      getFiles: () => [...files.values()],
      getFileByPath: path => files.get(path) ?? null,
      getAbstractFileByPath: path => files.get(path) ?? null,
      read: async file => file.content,
      create: async (path, text) => put(path, text),
      process: async (file, callback) => {
        const hook = beforeProcess;
        beforeProcess = undefined;
        hook?.(file);
        change(file, callback(file.content));
        return file.content;
      },
    },
    fileManager: {
      generateMarkdownLink(file, source, subpath = "") {
        links.push([file.path, source, subpath]);
        return `[[${file.path.slice(0, -3)}${subpath}]]`;
      },
    },
  };
  const module = { exports: {} };
  runInNewContext(bundle, {
    module, crypto, TextEncoder, console: { error() {} },
    Date: class extends Date { constructor() { super(time); } },
    require(name) {
      assert.equal(name, "obsidian");
      return {
        TAbstractFile, TFile, TFolder,
        Notice: class { constructor(message) { notes.push(message); } },
        Plugin: class {
          app = app;
          cleanup = [];
          registerEvent(cleanup) { this.cleanup.push(cleanup); }
          async loadData() { return structuredClone(data); }
          async saveData(next) { data = structuredClone(next); }
        },
      };
    },
  });
  return {
    put, change, remove, rename, notes, links,
    file: path => files.get(path),
    content: path => files.get(path)?.content,
    beforeNextProcess: callback => { beforeProcess = callback; },
    setTime: value => { time = value; },
    async start() {
      const plugin = new module.exports.default();
      await plugin.onload();
      await plugin.pending;
      return {
        flush: () => plugin.pending,
        stop() {
          plugin.onunload();
          for (const cleanup of plugin.cleanup) cleanup();
        },
      };
    },
  };
}

const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
const canvas = (...nodes) => JSON.stringify({ nodes, edges: [] });
const card = (id, text) => ({ id, type: "text", text });
const frontmatter = path =>
  `---\ndescription: Archives text cards and note links removed from the source Canvas.\ncanvas: "[[${path}]]"\n---`;

test("archives only removed text and Markdown notes, preserving content and link subpaths", async () => {
  const h = harness();
  const cardText = "  an entire card\n\n```js\nconsole.log(1)\n```\n";
  const text = card("t", cardText);
  const note = { id: "n", type: "file", file: "other/Page.md", subpath: "#^block" };
  const missing = { id: "m", type: "file", file: "other/Lost page.md", subpath: "#Some heading" };
  const ignored = [
    { id: "g", type: "group" }, { id: "l", type: "link" },
    { id: "a", type: "file", file: "assets/photo.png" },
  ];
  const board = h.put("folder/Board.canvas", canvas(text, note, missing, ...ignored));
  const plugin = await h.start();
  assert.equal(h.content("folder/Board.md"), undefined);
  h.put("folder/Board.md", "---\ntags: [mine]\n---\nExisting");
  h.put("other/Page.md", "Not copied.");
  h.change(board, canvas(text, note, missing));
  await plugin.flush();
  assert.equal(h.content("folder/Board.md"), "---\ntags: [mine]\n---\nExisting");
  h.change(board, canvas({ ...text, text: "Edited" }, note, missing));
  h.change(board, canvas(text, note, missing));
  h.change(board, canvas());
  await plugin.flush();
  assert.deepEqual(h.links, [["other/Page.md", "folder/Board.md", "#^block"]]);
  assert.equal(h.content("folder/Board.md"),
    ["---\ntags: [mine]\n---\nExisting", entry(cardText), entry("[[other/Page#^block]]"),
      entry("[Lost page](../other/Lost%20page.md#Some%20heading)")].join("\n\n"));
  assert.deepEqual(h.notes, []);
});

test("restores the right duplicate after restart and archives it again on redo", async () => {
  const h = harness();
  const first = card("first", "duplicate");
  const middle = card("middle", "between");
  const last = card("last", "duplicate");
  const board = h.put("Board.canvas", canvas(first, middle, last));
  let plugin = await h.start();
  const header = frontmatter("Board.canvas");
  h.change(board, canvas());
  await plugin.flush();
  assert.equal(h.content("Board.md"), [header, entry("duplicate"), entry("between"), entry("duplicate")].join("\n\n"));
  plugin.stop();
  plugin = await h.start();
  h.change(board, canvas(first));
  await plugin.flush();
  assert.equal(h.content("Board.md"), [header, entry("between"), entry("duplicate")].join("\n\n"));
  h.change(board, canvas(first, last));
  await plugin.flush();
  assert.equal(h.content("Board.md"), [header, entry("between")].join("\n\n"));
  const redoneAt = "2026-11-27T22:35:57Z";
  h.setTime(redoneAt);
  h.change(board, canvas(last));
  await plugin.flush();
  assert.equal(h.content("Board.md"), [header, entry("between"), entry("duplicate", redoneAt)].join("\n\n"));
  h.change(board, canvas(first, middle, last));
  await plugin.flush();
  assert.equal(h.content("Board.md"), header);
  assert.deepEqual(h.notes, []);
});

test("keeps ambiguous content after note edits and can restore a later re-deletion", async () => {
  const h = harness();
  const first = card("id", "card");
  const board = h.put("Board.canvas", canvas(first));
  const plugin = await h.start();
  h.change(board, canvas());
  await plugin.flush();
  assert.equal(h.content("Board.md"), [frontmatter("Board.canvas"), entry("card")].join("\n\n"));
  h.change(h.file("Board.md"), "manually edited card");
  h.change(board, canvas(first));
  await plugin.flush();
  assert.equal(h.content("Board.md"), "manually edited card");
  assert.match(h.notes[0], /could not be verified/);
  h.change(board, canvas());
  await plugin.flush();
  assert.equal(h.content("Board.md"), `manually edited card\n\n${entry("card")}`);
  h.change(board, canvas(first));
  await plugin.flush();
  assert.equal(h.content("Board.md"), "manually edited card");
});

test("retains the last valid snapshot, follows renames, and does not archive Canvas deletion", async () => {
  const h = harness();
  const first = card("a", "first");
  const second = card("b", "second");
  const board = h.put("old/Board.canvas", canvas(first, second));
  const plugin = await h.start();
  h.change(board, canvas(card("b", 1)));
  await plugin.flush();
  assert.match(h.notes[0], /Could not process Canvas/);
  assert.equal(h.content("old/Board.md"), undefined);
  h.change(board, canvas(second));
  await plugin.flush();
  const oldArchive = [frontmatter("old/Board.canvas"), entry("first")].join("\n\n");
  assert.equal(h.content("old/Board.md"), oldArchive);
  h.rename(board, "new/Work Plan.canvas");
  h.change(board, canvas());
  await plugin.flush();
  const newArchive = [frontmatter("new/Work Plan.canvas"), entry("second")].join("\n\n");
  assert.equal(h.content("new/Work Plan.md"), newArchive);
  h.change(board, canvas(first));
  await plugin.flush();
  h.remove(board);
  await plugin.flush();
  assert.equal(h.content("new/Work Plan.md"), newArchive);
  assert.equal(h.content("old/Board.md"), oldArchive);
});

test("does not overwrite a concurrent archive edit and can process the removal on a later save", async () => {
  const h = harness();
  const board = h.put("Board.canvas", canvas(card("a", "first")));
  h.put("Board.md", "existing");
  const plugin = await h.start();
  h.beforeNextProcess(note => h.change(note, "concurrent edit"));
  h.change(board, canvas());
  await plugin.flush();
  assert.equal(h.content("Board.md"), "concurrent edit");
  assert.match(h.notes[0], /Could not process Canvas/);
  h.change(board, canvas());
  await plugin.flush();
  assert.equal(h.content("Board.md"), `concurrent edit\n\n${entry("first")}`);
});
