import MiniSearch from 'minisearch';

export interface Chunk { id: string; section: string; title: string; text: string }

/** Split markdown by '##'/'###' headings. Each chunk keeps its section number (e.g. "2.1") and title. */
export function chunkMarkdown(md: string): Chunk[] {
  const chunks: Chunk[] = [];
  let parent = '';
  let cur: { section: string; title: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur && cur.lines.join(' ').trim()) {
      chunks.push({ id: `S${cur.section}`, section: cur.section, title: cur.title, text: cur.lines.join('\n').trim() });
    }
  };
  for (const line of md.split(/\r?\n/)) {
    const h = /^(##|###)\s+(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (h[1] === '##') parent = h[3];
      cur = { section: h[2], title: h[1] === '###' ? `${parent} > ${h[3]}` : h[3], lines: [] };
    } else if (cur && !line.startsWith('#')) {
      cur.lines.push(line);
    }
  }
  flush();
  return chunks;
}

const OPTIONS = {
  fields: ['title', 'text'],
  storeFields: ['section', 'title', 'text'],
  searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.2 },
};

export function buildIndex(chunks: Chunk[]) {
  const ms = new MiniSearch<Chunk>(OPTIONS);
  ms.addAll(chunks);
  return ms;
}

export function loadIndex(json: string) {
  return MiniSearch.loadJSON<Chunk>(json, OPTIONS);
}

export function search(ms: MiniSearch<Chunk>, query: string, limit = 3) {
  return ms.search(query).slice(0, limit).map((r) => ({
    section: r.section as string, heading: r.title as string, text: r.text as string, score: Number(r.score.toFixed(2)),
  }));
}
