/** 搜索框语法：`tag:名称` 过滤标签，其余部分当文字搜索（类 GitHub 的 repo: 写法）。 */

export interface ParsedQuery {
  /** 去掉 tag: 之后的自由文字部分 */
  text: string;
  /** tag: 后面的标签名，多个之间是"同时具备"（AND） */
  tags: string[];
}

const TAG_TOKEN = /(?:^|\s)tag:(?:"([^"]*)"|(\S+))/gi;

export function parseQuery(input: string): ParsedQuery {
  const tags: string[] = [];
  let rest = input;
  for (const match of input.matchAll(TAG_TOKEN)) {
    const name = (match[1] ?? match[2] ?? "").trim();
    if (name) tags.push(name);
    rest = rest.replace(match[0], " ");
  }
  return { text: rest.replace(/\s+/g, " ").trim(), tags };
}

function quoteIfNeeded(name: string): string {
  return /\s/.test(name) ? `"${name}"` : name;
}

/** 点击侧栏标签：已有同名 tag: 就移除，否则追加 */
export function toggleTagToken(current: string, name: string): string {
  const parsed = parseQuery(current);
  const exists = parsed.tags.some((tag) => tag === name);
  const tags = exists ? parsed.tags.filter((tag) => tag !== name) : [...parsed.tags, name];
  const tokens = tags.map((tag) => `tag:${quoteIfNeeded(tag)}`).join(" ");
  return [tokens, parsed.text].filter(Boolean).join(" ").trim();
}

export function hasTagToken(current: string, name: string): boolean {
  return parseQuery(current).tags.includes(name);
}
