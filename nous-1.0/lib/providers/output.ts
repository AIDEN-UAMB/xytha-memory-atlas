export class ModelOutputError extends Error {
  constructor(public raw: string) { super(raw.trim()?'模型输出不是有效 JSON。':'模型没有返回可读回答。'); this.name = 'ModelOutputError'; }
}

// Accept one complete object, optionally surrounded by prose or a Markdown fence.
// Never close truncated JSON, execute text, or guess missing chart facts.
export function parseModelJSON(text: string): unknown {
  const s = text.replace(/^\uFEFF/, '').trim();
  try { return JSON.parse(s); } catch { /* inspect a single complete object */ }
  const objects: string[] = [];
  let depth = 0, start = -1, quoted = false, escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (start < 0) { if (ch === '{') { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { objects.push(s.slice(start, i + 1)); start = -1; }
  }
  if (objects.length === 1 && start < 0) { try { return JSON.parse(objects[0]); } catch { /* bounded repair at workflow boundary */ } }
  throw new ModelOutputError(s.slice(0, 24000));
}
