import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import CalendarView, { type CalendarMode } from "./components/CalendarView";
import BatchEditDialog from "./components/BatchEditDialog";
import ConfirmDialog from "./components/ConfirmDialog";
import EntryDialog from "./components/EntryDialog";
import FilterPanel from "./components/FilterPanel";
import TagGraph from "./components/TagGraph";
import TagManager from "./components/TagManager";
import {
  batchUpdateEntries,
  countEntries,
  isOverdue,
  listPendingDueBetween,
  listPendingEntries,
  momentKey,
  momentLabel,
  setEntryDate,
  dayOf,
  setEntryDue,
  createTagLink,
  deleteTagLink,
  getStats,
  latestEntryDate,
  listEntriesBetween,
  listTagLinks,
  listTags,
  listThemes,
  searchEntries,
  tagCountLabel,
  tagsForEntries,
  today,
  type EntryRow,
  type Stats,
  type Tag,
  type TagLink,
  type ThemeCount,
} from "./db";

const EMPTY_STATS: Stats = { entries: 0, tags: 0, links: 0 };
const PAGE_SIZE = 50;
const PAGE_SIZES = [20, 50, 100, 200];

type Tab = "records" | "graph";
type FilterKind = "tags" | "themes";

/** 三态循环：未选 → 选中 → 排除 → 未选 */
function cycleSelection(includes: string[], excludes: string[], name: string) {
  if (includes.includes(name)) {
    return { includes: includes.filter((item) => item !== name), excludes: [...excludes, name] };
  }
  if (excludes.includes(name)) {
    return { includes, excludes: excludes.filter((item) => item !== name) };
  }
  return { includes: [...includes, name], excludes };
}

function App() {
  const [tab, setTab] = useState<Tab>("records");
  const [recordView, setRecordView] = useState<"list" | CalendarMode>("list");
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [entryTags, setEntryTags] = useState<Map<number, Tag[]>>(new Map());
  const [tags, setTags] = useState<Tag[]>([]);
  const [themes, setThemes] = useState<ThemeCount[]>([]);
  const [links, setLinks] = useState<TagLink[]>([]);
  const [query, setQuery] = useState("");
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [includeThemes, setIncludeThemes] = useState<string[]>([]);
  const [excludeThemes, setExcludeThemes] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState<FilterKind | null>(null);
  const [dialog, setDialog] = useState<{ date: string; entry: EntryRow | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);
  const [calDate, setCalDate] = useState(() => today());
  const [selectedDay, setSelectedDay] = useState(() => today());
  const [dayEntries, setDayEntries] = useState<EntryRow[]>([]);
  const [dayTags, setDayTags] = useState<Map<number, Tag[]>>(new Map());
  const [dataVersion, setDataVersion] = useState(0);
  const [pending, setPending] = useState<EntryRow[]>([]);
  const [dueToday, setDueToday] = useState<EntryRow[]>([]);
  const [completing, setCompleting] = useState<EntryRow | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [jump, setJump] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listPendingEntries();
      if (!cancelled) setPending(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  async function loadEntries(filters: {
    text?: string;
    includeTags?: string[];
    excludeTags?: string[];
    includeThemes?: string[];
    excludeThemes?: string[];
    /** 目标页（1 起）；不传就用当前页 */
    page?: number;
    /** 每页条数；不传就用当前设置 */
    size?: number;
  }) {
    const target = filters.page ?? page;
    const where = {
      text: filters.text ?? "",
      includeTags: filters.includeTags ?? [],
      excludeTags: filters.excludeTags ?? [],
      includeThemes: filters.includeThemes ?? [],
      excludeThemes: filters.excludeThemes ?? [],
    };
    const size = filters.size ?? pageSize;
    const rows = await searchEntries({ ...where, limit: size, offset: (target - 1) * size });
    setEntries(rows);
    setEntryTags(await tagsForEntries(rows.map((row) => row.id)));
    setTotal(await countEntries(where));
  }

  async function refresh(nextQuery = "") {
    try {
      const [nextStats, nextTags, nextLinks, nextThemes] = await Promise.all([
        getStats(),
        listTags(),
        listTagLinks(),
        listThemes(),
      ]);
      await loadEntries({ text: nextQuery, includeTags, excludeTags, includeThemes, excludeThemes, page: 1 });
      setPage(1);
      setStats(nextStats);
      setTags(nextTags);
      setLinks(nextLinks);
      setThemes(nextThemes);
      setError(null);
      setDataVersion((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // 限制窗口不能再窄：搜索框放不下提示语时就没法用了（非 Tauri 环境自动忽略）
  useEffect(() => {
    void (async () => {
      try {
        const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setMinSize(new LogicalSize(920, 620));
      } catch {
        /* 浏览器/冒烟环境没有 Tauri，忽略 */
      }
    })();
  }, []);

  useEffect(() => {
    void refresh("");
    // 首屏定位到最近有记录的一天（数据往往是历史日期）
    void latestEntryDate().then((latest) => {
      if (latest) {
        setCalDate(latest);
        setSelectedDay(latest);
      }
    });
  }, []);

  // 侧栏：选中那天的完整明细
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const dueRows = await listPendingDueBetween(selectedDay, selectedDay);
      if (!cancelled) setDueToday(dueRows);
      const rows = await listEntriesBetween(selectedDay, selectedDay, {
        text: query,
        includeTags,
        excludeTags,
        includeThemes,
        excludeThemes,
      });
      const map = await tagsForEntries(rows.map((row) => row.id));
      if (cancelled) return;
      setDayEntries(rows);
      setDayTags(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDay, dataVersion, includeTags, excludeTags, includeThemes, excludeThemes, query, pageSize]);

  /**
   * 勾选即完成：写入当前时间；晚于截止时间时询问按哪个时间记。
   * 取消勾选：没有截止时间就把完成时间挪成截止时间，再清空完成时间。
   */
  async function toggleCompleted(entry: EntryRow) {
    if (entry.date) {
      // 取消完成：没有截止时间就把完成时间挪成截止时间，再清空
      if (!entry.due_at) await setEntryDue(entry.id, entry.date);
      await setEntryDate(entry.id, null);
    } else {
      const now = momentKey();
      if (entry.due_at && isOverdue({ date: now, due_at: entry.due_at })) {
        // 已经过了截止时间：让用户自己挑记哪个时间，也可以干脆不完成
        setCompleting(entry);
        return;
      }
      await setEntryDate(entry.id, now);
    }
    await refresh(query);
  }

  function togglePick(entryId: number) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  const selectedRows = entries.filter((entry) => picked.has(entry.id));

  async function applyBatch(patch: Parameters<typeof batchUpdateEntries>[1]) {
    await batchUpdateEntries(selectedRows.map((row) => row.id), patch);
    setPicked(new Set());
    await refresh(query);
  }

  function applyFilter(kind: FilterKind, name: string) {
    if (kind === "tags") {
      const next = cycleSelection(includeTags, excludeTags, name);
      setIncludeTags(next.includes);
      setExcludeTags(next.excludes);
      setPage(1);
      setJump(1);
      void loadEntries({
        text: query,
        includeTags: next.includes,
        excludeTags: next.excludes,
        includeThemes,
        excludeThemes,
        page: 1,
      });
      return;
    }
    const next = cycleSelection(includeThemes, excludeThemes, name);
    setIncludeThemes(next.includes);
    setExcludeThemes(next.excludes);
    setPage(1);
    setJump(1);
    void loadEntries({
      text: query,
      includeTags,
      excludeTags,
      includeThemes: next.includes,
      excludeThemes: next.excludes,
      page: 1,
    });
  }

  function clearFilters() {
    setIncludeTags([]);
    setExcludeTags([]);
    setIncludeThemes([]);
    setExcludeThemes([]);
    setQuery("");
    setPage(1);
    setJump(1);
    void loadEntries({ text: "", includeTags: [], excludeTags: [], includeThemes: [], excludeThemes: [], page: 1 });
  }

  const tagFilterCount = includeTags.length + excludeTags.length;
  const themeFilterCount = includeThemes.length + excludeThemes.length;
  const anyFilter = tagFilterCount + themeFilterCount > 0;

  const filterSummary = [
    includeTags.length > 0 ? "标签：" + includeTags.join(" + ") : "",
    excludeTags.length > 0 ? "排除标签：" + excludeTags.join(" / ") : "",
    includeThemes.length > 0 ? "主题：" + includeThemes.join(" + ") : "",
    excludeThemes.length > 0 ? "排除主题：" + excludeThemes.join(" / ") : "",
  ]
    .filter(Boolean)
    .join("  ·  ");

  const grouped = useMemo(() => {
    const groups: [string, EntryRow[]][] = [];
    for (const entry of entries) {
      const last = groups[groups.length - 1];
      const day = dayOf(entry) ?? "未完成";
      if (last && last[0] === day) last[1].push(entry);
      else groups.push([day, [entry]]);
    }
    return groups;
  }, [entries]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function turnPage(next: number) {
    const target = Math.min(Math.max(1, next), pageCount);
    setPage(target);
    setJump(target);
    void loadEntries({ text: query, includeTags, excludeTags, includeThemes, excludeThemes, page: target });
  }

  // 稳定的引用，避免 memo 化的日历被父组件重渲染带着重画
  const calendarFilter = useMemo(
    () => ({ text: query, includeTags, excludeTags, includeThemes, excludeThemes }),
    [query, includeTags, excludeTags, includeThemes, excludeThemes],
  );

  const openCreateAt = useCallback((day: string) => {
    setDialog({ date: day, entry: null });
  }, []);

  const openFromCalendar = useCallback((mode: "week" | "month", day: string) => {
    setRecordView(mode);
    setCalDate(day);
    setSelectedDay(day);
  }, []);

  const twoColumn = recordView === "week" || recordView === "month";

  function changePageSize(next: number) {
    setPageSize(next);
    setPage(1);
    setJump(1);
    void loadEntries({ text: query, includeTags, excludeTags, includeThemes, excludeThemes, page: 1, size: next });
  }

  return (
    <main className="app">
      {/* 第一层 */}
      <header className="topbar">
        <div className="brand">
          <h1>vibe-diary</h1>
          <p className="muted">
            {busy
              ? "正在打开数据库…"
              : stats.entries + " 条记录 · " + stats.tags + " 个标签 · " + stats.links + " 条标签关系"}
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

      {dialog && (
        <EntryDialog
          key={(dialog.entry?.id ?? "new") + ":" + dialog.date}
          date={dialog.date}
          entry={dialog.entry}
          tags={tags}
          onClose={() => setDialog(null)}
          onSaved={() => void refresh(query)}
        />
      )}

      {batchOpen && (
        <BatchEditDialog
          selected={selectedRows}
          tags={tags}
          onClose={() => setBatchOpen(false)}
          onApply={(patch) => void applyBatch(patch)}
        />
      )}

      {completing && (
        <ConfirmDialog
          title="这条已经过了截止时间"
          message={
            "截止 " +
            momentLabel(completing.due_at) +
            "，现在是 " +
            momentLabel(momentKey()) +
            "。完成时间要记成哪个？"
          }
          options={[
            { label: "按当前时间", hint: momentLabel(momentKey()), primary: true },
            { label: "按截止时间", hint: momentLabel(completing.due_at) },
          ]}
          onPick={(index) => {
            const target = completing;
            setCompleting(null);
            void (async () => {
              await setEntryDate(target.id, index === 0 ? momentKey() : target.due_at);
              await refresh(query);
            })();
          }}
          onCancel={() => setCompleting(null)}
        />
      )}

      {managerOpen && (
        <TagManager tags={tags} onClose={() => setManagerOpen(false)} onChanged={() => refresh(query)} />
      )}

      {tab === "graph" ? (
        <TagGraph
          tags={tags}
          links={links}
          onCreateLink={async (sourceId, targetId) => {
            await createTagLink(sourceId, targetId);
            await refresh(query);
          }}
          onDeleteLink={async (sourceId, targetId) => {
            await deleteTagLink(sourceId, targetId);
            await deleteTagLink(targetId, sourceId);
            await refresh(query);
          }}
        />
      ) : (
        <>
          {/* 第二层：一整行 */}
          <div className="toolbar">
            <button
              type="button"
              className="primary new-entry"
              onClick={() => setDialog({ date: selectedDay || today(), entry: null })}
              title="新建一条记录（也可以直接双击日历里的日期）"
            >
              ＋ 记一笔
            </button>

            <input
              className="search"
              value={query}
              placeholder="搜索内容、标签、主题…"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setPage(1);
                setJump(1);
                void loadEntries({
                  text: event.currentTarget.value,
                  includeTags,
                  excludeTags,
                  includeThemes,
                  excludeThemes,
                  page: 1,
                });
              }}
            />

            <div className="filter-buttons">
              <button
                type="button"
                className={"flat filter-btn" + (tagFilterCount > 0 ? " active" : "")}
                onClick={() => setFilterOpen(filterOpen === "tags" ? null : "tags")}
              >
                {"标签" + (tagFilterCount > 0 ? " " + includeTags.length + "+" + excludeTags.length : "") + " ▾"}
              </button>
              <button
                type="button"
                className={"flat filter-btn" + (themeFilterCount > 0 ? " active" : "")}
                onClick={() => setFilterOpen(filterOpen === "themes" ? null : "themes")}
              >
                {"主题" + (themeFilterCount > 0 ? " " + includeThemes.length + "+" + excludeThemes.length : "") + " ▾"}
              </button>

              {filterOpen === "tags" && (
                <FilterPanel
                  hint="点一次选中，再点排除，第三次取消"
                  items={tags.map((tag) => ({
                    key: tag.name,
                    label: tag.name,
                    count: tagCountLabel(tag).main,
                    color: tag.color,
                  }))}
                  includes={includeTags}
                  excludes={excludeTags}
                  onToggle={(name) => applyFilter("tags", name)}
                  onClear={clearFilters}
                />
              )}

              {filterOpen === "themes" && (
                <FilterPanel
                  hint="主题取标题里第一个冒号前面的部分"
                  items={themes.map((item) => ({ key: item.theme, label: item.theme, count: item.count }))}
                  includes={includeThemes}
                  excludes={excludeThemes}
                  onToggle={(name) => applyFilter("themes", name)}
                  onClear={clearFilters}
                />
              )}
            </div>

            <div className="cal-switch">
              {(["list", "week", "month", "year", "years"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={"flat" + (recordView === mode ? " active" : "")}
                  onClick={() => setRecordView(mode)}
                >
                  {mode === "list" ? "列表" : mode === "week" ? "周" : mode === "month" ? "月" : mode === "year" ? "年" : "跨年"}
                </button>
              ))}
            </div>
          </div>

          {/* 第三层：列表/年/跨年一栏；周/月两栏 */}
          <div className={"content" + (twoColumn ? " two-col" : "")}>
            <section className="workspace">
              {recordView === "list" ? (
                <>
                  <div className="list-count muted batch-bar">
                    <button type="button" className="flat" onClick={() => setPicked(new Set(entries.map((entry) => entry.id)))}>
                      全选
                    </button>
                    <button
                      type="button"
                      className="flat"
                      onClick={() =>
                        setPicked((current) => {
                          const next = new Set<number>();
                          for (const entry of entries) if (!current.has(entry.id)) next.add(entry.id);
                          return next;
                        })
                      }
                    >
                      反选
                    </button>
                    <button type="button" className="flat" onClick={() => setPicked(new Set())}>
                      取消
                    </button>
                    <span className="muted">{"点行选中，双击编辑" + (picked.size > 0 ? " · 已选 " + picked.size + " 条" : "")}</span>
                    <button type="button" className="flat" disabled={picked.size === 0} onClick={() => setBatchOpen(true)}>
                      {"编辑选中" + (picked.size > 0 ? " (" + picked.size + ")" : "")}
                    </button>
                  </div>

                  <div className="list-count muted">
                    <span>
                      {(anyFilter || query.trim() ? (filterSummary || "筛选") + " · " : "") + "共 " + total + " 条"}
                    </span>
                    {anyFilter || query.trim() ? (
                      <button type="button" className="linkish" onClick={clearFilters}>
                        清空筛选
                      </button>
                    ) : null}
                  </div>

                  <section className="list">
                    {entries.length === 0 && !busy && <p className="muted">没有匹配的记录。</p>}
                    {grouped.map(([date, rows]) => (
                      <div key={date} className="day-group">
                        {date === "未完成" ? (
                          <span className="day-group-date">未完成</span>
                        ) : (
                          <button type="button" className="linkish day-group-date" onClick={() => setSelectedDay(date)}>
                            {date}
                          </button>
                        )}
                        {rows.map((entry) => {
                          const chips = entryTags.get(entry.id) ?? [];
                          return (
                            <div
                              key={entry.id}
                              className={
                                "row-entry" +
                                (entry.date ? " done" : "") +
                                (picked.has(entry.id) ? " picked" : "")
                              }
                              role="button"
                              tabIndex={0}
                              title="点一下选中，双击打开编辑"
                              onClick={() => togglePick(entry.id)}
                              onDoubleClick={() => setDialog({ date: dayOf(entry) ?? "", entry })}
                            >
                              <button
                                type="button"
                                className={"flat tick" + (entry.date ? " on" : "")}
                                title={entry.date ? "已完成，点击取消勾选" : "勾选表示已完成"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleCompleted(entry);
                                }}
                              >
                              {entry.date ? "☑" : "☐"}
                              </button>
                              <span className="row-tags">
                                {chips.map((tag) => (
                                  <span key={tag.id} className="chip chip-mini" style={tag.color ? { borderColor: tag.color } : undefined}>
                                    {tag.name}
                                  </span>
                                ))}
                              </span>
                              <span className="row-content">{entry.content.replace(/\s+/g, " ")}</span>
                              {isOverdue(entry) ? <span className="row-flag overdue">逾期</span> : null}
                              {entry.due_at ? <span className="row-due muted">{"截止 " + momentLabel(entry.due_at)}</span> : null}
                              {entry.pinned ? <span className="row-flag">置顶</span> : null}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </section>

                  <footer className="pager">
                    <button type="button" className="flat" disabled={page <= 1} onClick={() => turnPage(1)}>
                      «
                    </button>
                    <button type="button" className="flat" disabled={page <= 1} onClick={() => turnPage(page - 1)}>
                      ‹ 上一页
                    </button>
                    <span className="muted">{page + " / " + pageCount}</span>
                    <button
                      type="button"
                      className="flat"
                      disabled={page >= pageCount}
                      onClick={() => turnPage(page + 1)}
                    >
                      下一页 ›
                    </button>
                    <button
                      type="button"
                      className="flat"
                      disabled={page >= pageCount}
                      onClick={() => turnPage(pageCount)}
                    >
                      »
                    </button>

                    <label className="pager-jump muted">
                      跳到
                      <input
                        className="page-input"
                        type="number"
                        min={1}
                        max={pageCount}
                        value={jump}
                        onChange={(event) => setJump(Number(event.currentTarget.value) || 1)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") turnPage(jump);
                        }}
                      />
                      页
                    </label>

                    <label className="pager-size muted">
                      每页
                      <select value={pageSize} onChange={(event) => changePageSize(Number(event.currentTarget.value))}>
                        {PAGE_SIZES.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                      条
                    </label>
                  </footer>
                </>
              ) : (
                <CalendarView
                  mode={recordView}
                  anchor={calDate}
                  onAnchor={setCalDate}
                  selected={selectedDay}
                  onSelectDay={setSelectedDay}
                  onOpen={openFromCalendar}
                  onCreateAt={openCreateAt}
                  filter={calendarFilter}
                  onAnchorDate={setSelectedDay}
                />
              )}
            </section>

            {twoColumn && (
              <aside className="sidebar">
                <h2>
                  {selectedDay} <span className="muted">· {dayEntries.length} 条</span>
                </h2>
                {dayEntries.length === 0 && <p className="muted">这天没有记录。</p>}
                {dayEntries.map((entry) => (
                  <article
                    key={entry.id}
                    className="day-entry clickable"
                    role="button"
                    tabIndex={0}
                    title="点击编辑这条记录"
                    onClick={() => setDialog({ date: dayOf(entry) ?? "", entry })}
                  >
                    <div className="day-entry-head">
                      <button
                        type="button"
                        className={"flat tick" + (entry.date ? " on" : "")}
                        title={entry.date ? "已完成，点击取消勾选" : "勾选表示已完成"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleCompleted(entry);
                        }}
                      >
                        {entry.date ? "☑" : "☐"}
                      </button>
                    <p className="entry-content">{entry.content}</p>
                    </div>
                    <div className="chips">
                      {(dayTags.get(entry.id) ?? []).map((tag) => (
                        <span
                          key={tag.id}
                          className="chip"
                          style={tag.color ? { borderColor: tag.color } : undefined}
                        >
                          {tag.name}
                        </span>
                      ))}
                      {isOverdue(entry) ? <span className="row-flag overdue">逾期</span> : null}
                      {entry.date ? null : <span className="row-flag due-only">到期</span>}
                    </div>
                  </article>
                ))}
                {dueToday.map((item) => (
                  <article
                    key={"due-" + item.id}
                    className="day-entry clickable due-only"
                    role="button"
                    tabIndex={0}
                    title="到期未完成，点击编辑"
                    onClick={() => setDialog({ date: dayOf(item) ?? selectedDay, entry: item })}
                  >
                    <div className="day-entry-head">
                      <button
                        type="button"
                        className="flat tick"
                        title="勾选表示已完成"
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleCompleted(item);
                        }}
                      >
                        ☐
                      </button>
                      <p className="entry-content">{item.content}</p>
                    </div>
                    <div className="chips">
                      {isOverdue(item) ? <span className="row-flag overdue">逾期</span> : null}
                      <span className="row-due muted">{"截止 " + momentLabel(item.due_at)}</span>
                    </div>
                  </article>
                ))}

                {selectedDay === today() && (
                  <section className="todo-section">
                    <h3>待办 <span className="muted">· 未完成 {pending.length} 条</span></h3>
                    {pending.length === 0 && <p className="muted">没有未完成的事项。</p>}
                    {pending
                      .filter((item) => dayOf(item) !== selectedDay)
                      .map((item) => (
                        <div
                          key={item.id}
                          className={
                            "todo-item" + (isOverdue(item) ? " overdue" : "") + (item.date ? " done" : "")
                          }
                          role="button"
                          tabIndex={0}
                          title="点击编辑"
                          onClick={() => setDialog({ date: dayOf(item) ?? "", entry: item })}
                        >
                          <button
                            type="button"
                            className="flat tick on"
                            title="勾选表示已完成"
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleCompleted(item);
                            }}
                          >
                            {"\u2610"}
                          </button>
                          <span className="todo-content">{item.content.replace(/\s+/g, " ")}</span>
                          {item.due_at ? <span className="row-due muted">{"截止 " + momentLabel(item.due_at)}</span> : null}
                          {isOverdue(item) ? <span className="row-flag overdue">逾期</span> : null}
                        </div>
                      ))}
                  </section>
                )}
              </aside>
            )}
          </div>
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
