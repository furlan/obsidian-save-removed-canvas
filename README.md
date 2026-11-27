# Save Removed Canvas Elements

When you remove a text card or a Markdown note card from `Projects/Board.canvas`, the plugin appends the full card text or a link to the note to `Projects/Board.md`. Each entry also includes the text or note links of directly connected cards from the last saved Canvas snapshot, regardless of connection direction. Cards connected more than once are listed once; groups, web links, and attachments are omitted. A newly created archive note starts with YAML frontmatter containing a `description` of its purpose and a `canvas` link to the source Canvas. Existing notes keep their contents and properties. Each new entry starts with a `***` horizontal rule followed by the local date and time it was archived. Links retain any heading or block reference. The plugin ignores deletion of groups, connections, web links, attachments, and the Canvas itself.

If you undo a removal and the same node ID returns, the plugin removes its archive entry when it can verify that it still owns that exact text range. It does not insert hidden comments. If edits to the archive make an entry ambiguous, the plugin leaves it in place and shows a notice. Redo archives the card again. Canvas renames and moves leave old archive notes in place; new removals use the current Canvas name and folder.

The plugin compares saved Canvas snapshots while it is enabled. Sync and external edits can also trigger archiving. Changes that are never saved, or that happen while the plugin is disabled, are not recorded.

