# Save Removed Canvas Elements

When you remove a text card or a Markdown note card from `Projects/Board.canvas`, the plugin appends the full card text or a link to the note to `Projects/Board.md`. A newly created archive note starts with YAML frontmatter containing a `description` of its purpose and a `canvas` link to the source Canvas. Existing notes keep their contents and properties. Each new entry starts with a `***` horizontal rule followed by the local date and time it was archived. Links retain any heading or block reference. The plugin ignores groups, connections, web links, attachments, and deletion of the Canvas itself.

If you undo a removal and the same node ID returns, the plugin removes its archive entry when it can verify that it still owns that exact text range. It does not insert hidden comments. If edits to the archive make an entry ambiguous, the plugin leaves it in place and shows a notice. Redo archives the card again. Canvas renames and moves leave old archive notes in place; new removals use the current Canvas name and folder.

The plugin compares saved Canvas snapshots while it is enabled. Sync and external edits can also trigger archiving. Changes that are never saved, or that happen while the plugin is disabled, are not recorded.

## Build and install

1. With Node.js 22 or newer, run `npm ci` and `npm run build`.
2. Copy `main.js` and `manifest.json` to `<vault>/.obsidian/plugins/save-removed-canvas/`.
3. Enable **Save Removed Canvas Elements** under **Settings → Community plugins**.

Run `npm test` to type-check and build the plugin and run the automated tests.
