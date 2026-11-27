export type Card = { type: "text"; text: string } | { type: "file"; path: string; subpath?: string };
export type Snapshot = { nodes: Map<string, Card | null>; connections: Map<string, Set<string>> };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCanvas(content: string): Snapshot {
  const data: unknown = JSON.parse(content);
  if (!isRecord(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error("Invalid Canvas document");
  }

  const nodes = new Map<string, Card | null>();
  for (const node of data.nodes as unknown[]) {
    if (!isRecord(node) || typeof node.id !== "string" || !node.id ||
        typeof node.type !== "string" || nodes.has(node.id)) {
      throw new Error("Invalid or duplicate Canvas node");
    }
    let card: Card | null = null;
    if (node.type === "text") {
      if (typeof node.text !== "string") throw new Error("Invalid Canvas text card");
      card = { type: "text", text: node.text };
    } else if (node.type === "file") {
      if (typeof node.file !== "string" || !node.file ||
          (node.subpath !== undefined && (typeof node.subpath !== "string" || !node.subpath.startsWith("#")))) {
        throw new Error("Invalid Canvas file card");
      }
      if (/\.md$/i.test(node.file)) card = { type: "file", path: node.file, subpath: node.subpath };
    }
    nodes.set(node.id, card);
  }
  const connections = new Map<string, Set<string>>();
  for (const edge of data.edges as unknown[]) {
    if (!isRecord(edge) || typeof edge.fromNode !== "string" || !edge.fromNode ||
        typeof edge.toNode !== "string" || !edge.toNode) {
      throw new Error("Invalid Canvas edge");
    }
    if (edge.fromNode === edge.toNode) continue;
    for (const [node, neighbor] of [[edge.fromNode, edge.toNode], [edge.toNode, edge.fromNode]]) {
      let connected = connections.get(node);
      if (!connected) connections.set(node, connected = new Set());
      connected.add(neighbor);
    }
  }
  return { nodes, connections };
}

export function missingNoteLink(path: string, source: string, subpath = ""): string {
  const target = path.split("/");
  const folder = source.split("/").slice(0, -1);
  let shared = 0;
  while (shared < folder.length && shared < target.length - 1 && folder[shared] === target[shared]) shared++;
  const encode = (part: string) => encodeURIComponent(part).replace(/[()]/g, char => char === "(" ? "%28" : "%29");
  const relative = "../".repeat(folder.length - shared) + target.slice(shared).map(encode).join("/");
  const label = target[target.length - 1].slice(0, -3).replace(/[\\[\]]/g, "\\$&");
  return `[${label}](${relative}${subpath ? `#${encode(subpath.slice(1))}` : ""})`;
}
