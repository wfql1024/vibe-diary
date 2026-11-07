import { useEffect, useState } from "react";
import "./App.css";
import TagGraph from "./components/TagGraph";
import TagManager from "./components/TagManager";
import { hasTagToken, parseQuery, toggleTagToken } from "./query";
import {
  addEntryTag,
  createEntry,
  createTagLink,
  deleteTagLink,
  getStats,
  listTagLinks,
  listTags,
  searchEntries,
  removeEntryTag,
  tagCountLabel,
  tagsForEntries,
  today,
  type EntryRow,
  type Stats,
  type Tag,
  type TagLink,
} from "./db";

const EMPTY_STATS: Stats = { entries: 0, tags: 0, links: 0 };

type Tab = "records" | "graph";

function App() {
  const [tab, setTab] = useState<Tab>("records");
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [entryTags, setEntryTags] = useState<Map<number, Tag[]>>(new Map());
  const [tags, setTags] = useState<Tag[]>([]);
  const [links, setLinks] = useState<TagLink[]>([]);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(today());
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);
  const [draft, setDraft] = useState<{ entryId: number; value: string } | null>(null);


  async function refresh(search = query) {
    const parsed = parseQuery(search);
    try {
      const [nextStats, nextEntries, nextTags, nextLinks] = await Promise.all([
        getStats(),
        searchEntries({ text: parsed.text, tags: parsed.tags }),
        listTags(),
        listTagLinks(),
      ]);
      const nextEntryTags = await tagsForEntries(nextEntries.map((entry) => entry.id));
      setStats(nextStats);
      setEntries(nextEntries);
      setTags(nextTags);
      setLinks(nextLinks);
      setEntryTags(nextEntryTags);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh("");
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    try {
      await createEntry({
        date,
        content,
        tags: tagInput.split(/[,，\s]+/).filter(Boolean),
      });
      setContent("");
      setTagInput("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeTagFromEntry(entryId: number, tagId: number) {
    await removeEntryTag(entryId, tagId);
    await refresh();
  }

  async function commitDraft(entryId: number, value: string) {
    const name = value.trim();
    setDraft(null);
    if (!name) return;
    try {
      await addEntryTag(entryId, name);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const parsedQuery = parseQuery(query);
  const filterSummary = parsedQuery.tags.length
    ? `筛选 ${parsedQuery.tags.map((tag) => `tag:${tag}`).join(" + ")}` +
      (parsedQuery.text ? ` + 文字「${parsedQuery.text}」` : "")
    : parsedQuery.text
      ? `「${parsedQuery.text}」`
      : null;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>vibe-diary</h1>
          <p className="muted">
            {busy
              ? "正在打开数据库…"
              : `${stats.entries} 条记录 · ${stats.tags} 个标签 · ${stats.links} 条标签关系`}
          </p>
        </div>

        <nav className="tabs">
          <button type="button" className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}>
            记录
          </button>
          <button type="button" className={tab === "graph" ? "active" : ""} onClick={() => setTab("graph")}>
            标签画布
          </button>
          <button type="button" className="ghost" onClick={() => setManagerOpen(true)}>
            标签管理
          </button>
        </nav>
      </header>

      {error && <div className="error">数据库错误：{error}</div>}

      {managerOpen && (
        <TagManager tags={tags} onClose={() => setManagerOpen(false)} onChanged={() => refresh()} />
      )}

      {tab === "graph" ? (
        <TagGraph
          tags={tags}
          links={links}
          onCreateLink={async (sourceId, targetId) => {
            await createTagLink(sourceId, targetId);
            await refresh();
          }}
          onDeleteLink={async (sourceId, targetId) => {
            // 双向关系在画布上合并成一条线，删就整条删掉
            await deleteTagLink(sourceId, targetId);
            await deleteTagLink(targetId, sourceId);
            await refresh();
          }}
        />
      ) : (
        <>
          <form className="composer" onSubmit={submit}>
            <div className="composer-row">
              <input type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} />
              <input
                value={tagInput}
                placeholder="标签，逗号分隔（新标签会自动创建）"
                onChange={(event) => setTagInput(event.currentTarget.value)}
              />
              <input
                className="search"
                value={query}
                placeholder='搜索… 点标签会插入 tag:名称，例：tag:暖暖 文字'
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  void refresh(event.currentTarget.value);
                }}
              />
            </div>
            <textarea
              value={content}
              rows={3}
              placeholder="今天发生了什么…"
              onChange={(event) => setContent(event.currentTarget.value)}
            />
            <button type="submit">记一笔</button>
          </form>

          <section className="list">
            <p className="muted list-count">
              {filterSummary ? `${filterSummary} 命中 ${entries.length} 条` : `共 ${entries.length} 条`}
              {entries.length >= 300 ? "，仅显示前 300 条" : ""}
              {query.trim() && (
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    setQuery("");
                    void refresh("");
                  }}
                >
                  清空搜索
                </button>
              )}
            </p>
            {entries.length === 0 && !busy && (
              <p className="muted">没有匹配的记录。</p>
            )}
            {entries.map((entry) => {
              const chips = entryTags.get(entry.id) ?? [];
              return (
                <article key={entry.id} className="entry">
                  <div className="entry-head">
                    <time>{entry.date}</time>
                    <span className={`status status-${entry.status}`}>{entry.status}</span>
                  </div>
                  <p className="entry-content">{entry.content}</p>
                  <div className="chips">
                    {chips.map((tag) => (
                      <span key={tag.id} className="chip chip-editable" style={tag.color ? { borderColor: tag.color } : undefined}>
                        {tag.name}
                        <button
                          type="button"
                          title="从这条记录移除标签"
                          onClick={() => void removeTagFromEntry(entry.id, tag.id)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {draft?.entryId === entry.id ? (
                      <input
                        autoFocus
                        className="chip-input"
                        list="tag-suggestions"
                        value={draft.value}
                        placeholder="标签名，回车确认"
                        onChange={(event) => setDraft({ entryId: entry.id, value: event.currentTarget.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitDraft(entry.id, draft.value);
                          }
                          if (event.key === "Escape") setDraft(null);
                        }}
                        onBlur={() => void commitDraft(entry.id, draft.value)}
                      />
                    ) : (
                      <button type="button" className="chip chip-add" onClick={() => setDraft({ entryId: entry.id, value: "" })}>
                        ＋ 标签
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          <aside className="sidebar">
            <h2>
              标签 <span className="muted">（全部 {tags.length} 个，按含关系总数排序）</span>
            </h2>
            <div className="chips">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className={`chip ${hasTagToken(query, tag.name) ? "chip-active" : ""}`}
                  style={tag.color ? { borderColor: tag.color } : undefined}
                  onClick={() => {
                    const token = toggleTagToken(query, tag.name);
                    setQuery(token);
                    void refresh(token);
                  }}
                >
                  {tag.name} <em>{tagCountLabel(tag).main}</em>
                  {tagCountLabel(tag).extra && (
                    <em className="reach" title="总数(自身+外部)">
                      {tagCountLabel(tag).extra}
                    </em>
                  )}
                </button>
              ))}
            </div>
          </aside>
        </>
      )}

      <datalist id="tag-suggestions">
        {tags.map((tag) => (
          <option key={tag.id} value={tag.name} />
        ))}
      </datalist>
    </main>
  );
}

export default App;