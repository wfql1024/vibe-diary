import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  dailyCompletedCounts,
  dayOf,
  isOverdue,
  momentLabel,
  listEntriesBetween,
  listPendingDueBetween,
  tagsForEntries,
  type EntryFilter,
  type EntryRow,
  type Tag,
} from "../db";

export type CalendarMode = "week" | "month" | "year" | "years";

interface Props {
  mode: CalendarMode;
  anchor: string;
  onAnchor: (next: string) => void;
  selected: string;
  onSelectDay: (day: string) => void;
  /** 年/跨年视图点击后跳到周或月视图 */
  onOpen: (mode: "week" | "month", day: string) => void;
  /** 双击某天：弹出记录页并预填日期 */
  onCreateAt: (day: string) => void;
  /** 与列表同一套筛选条件：周/月视图与热力图都只显示命中的记录 */
  filter?: EntryFilter;
  /** 切到"某天"（点击年视图方块跳周视图时用） */
  onAnchorDate?: (day: string) => void;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
/** 周视图卡片高度与间距必须和 CSS 里 .cal-entry 一致，否则"能放几条"会算错 */
const WEEK_CARD_H = 116;
const WEEK_CARD_GAP = 6;
/** 折叠提示占一行 */
const WEEK_MORE_H = 26;
const MAX_MONTH_CHIPS = 4;
/** 热力图色阶放模块级：避免每个格子都新建一次数组 */
/** 没有标签颜色时的主题色（按主题名散列，稳定且彩色） */
const THEME_PALETTE = ["#2f6bff", "#d6538a", "#1f9bb5", "#c9a227", "#7f8c3a", "#9a5bd6", "#e0603c", "#2fa36b"];

function themeColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  return THEME_PALETTE[hash % THEME_PALETTE.length];
}

const HEAT_SCALE = ["#f1f1ee", "#dcebd9", "#b3d9ad", "#7fb87e", "#4c8f52"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toKey(date: Date) {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function parseKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  return addDays(date, -date.getDay());
}

function monthMatrix(year: number, month: number) {
  const start = startOfWeek(new Date(year, month, 1));
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) cells.push(addDays(start, i));
  return cells;
}

function groupByDay(entries: EntryRow[]) {
  const map = new Map<string, EntryRow[]>();
  for (const entry of entries) {
    const day = dayOf(entry);
    if (!day) continue;
    const list = map.get(day) ?? [];
    list.push(entry);
    map.set(day, list);
  }
  return map;
}

/** 主题 = 标题第一个冒号之前的部分；没有冒号用整个标题 */
function themeOf(entry: EntryRow) {
  const title = entry.title || entry.content;
  const index = title.search(/[：:]/);
  return index > 0 ? title.slice(0, index) : title.slice(0, 12);
}

function heatColor(count: number, max: number) {
  if (count <= 0) return HEAT_SCALE[0];
  if (max <= 1) return HEAT_SCALE[2];
  const level = Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
  return HEAT_SCALE[level];
}

function unitOf(mode: CalendarMode) {
  return mode === "week" ? "周" : mode === "month" ? "月" : mode === "year" ? "年" : "3 年";
}

function CalendarView({ mode, anchor, onAnchor, selected, onSelectDay, onOpen, onCreateAt, filter, onAnchorDate }: Props) {
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [tagsOfEntry, setTagsOfEntry] = useState<Map<number, Tag[]>>(new Map());
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [dueItems, setDueItems] = useState<EntryRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const anchorDate = useMemo(() => parseKey(anchor), [anchor]);
  const todayKey = toKey(new Date());
  const todayMonth = todayKey.slice(0, 7);
  const selectedMonth = selected.slice(0, 7);

  const range = useMemo(() => {
    if (mode === "week") {
      const start = startOfWeek(anchorDate);
      return {
        from: toKey(start),
        to: toKey(addDays(start, 6)),
        label: toKey(start) + " ~ " + toKey(addDays(start, 6)),
      };
    }
    if (mode === "month") {
      const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
      const end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
      return { from: toKey(start), to: toKey(end), label: start.getFullYear() + " 年 " + (start.getMonth() + 1) + " 月" };
    }
    if (mode === "year") {
      const y = anchorDate.getFullYear();
      return { from: y + "-01-01", to: y + "-12-31", label: y + " 年" };
    }
    const y = anchorDate.getFullYear();
    return { from: y - 2 + "-01-01", to: y + "-12-31", label: y - 2 + " – " + y + " 年" };
  }, [mode, anchorDate]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const needEntries = mode === "week" || mode === "month";
        const rows = needEntries ? await listEntriesBetween(range.from, range.to, filter) : [];
        const dueRows = needEntries ? await listPendingDueBetween(range.from, range.to) : [];
        const daily = await dailyCompletedCounts(range.from, range.to, filter);
        const map = needEntries ? await tagsForEntries(rows.map((row) => row.id)) : new Map<number, Tag[]>();
        if (cancelled) return;
        setEntries(rows);
        setDueItems(dueRows);
        setTagsOfEntry(map);
        setCounts(daily);
        setLoadError(null);
      } catch (error) {
        // 查询失败也要停下"载入中"，并把原因显示出来
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, range.from, range.to, filter?.text, filter?.includeTags, filter?.excludeTags, filter?.includeThemes, filter?.excludeThemes]);

  // 周视图不放滚动条：按父容器高度算出能放几张卡，放不下的折叠成 +n 条
  const [weekBodyHeight, setWeekBodyHeight] = useState(0);
  const weekBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mode !== "week") return;
    const node = weekBodyRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWeekBodyHeight(node.clientHeight));
    observer.observe(node);
    setWeekBodyHeight(node.clientHeight);
    return () => observer.disconnect();
  }, [mode, range.from, range.to]);

  const weekCapacity = useMemo(() => {
    if (weekBodyHeight <= 0) return 6;
    // 预留折叠行的位置，再多留一个间距，保证 n 张卡 + 一行提示一定塞得下
    return Math.max(1, Math.floor((weekBodyHeight - WEEK_MORE_H - WEEK_CARD_GAP) / (WEEK_CARD_H + WEEK_CARD_GAP)));
  }, [weekBodyHeight]);

  const dueIds = useMemo(() => new Set(dueItems.map((item) => item.id)), [dueItems]);

  /** 日历上每天要显示的条目：已完成的记录 + 未完成但截止落在当天的 */
  const byDay = useMemo(() => {
    const merged = groupByDay(entries);
    for (const item of dueItems) {
      const key = (item.due_at ?? "").slice(0, 10);
      if (!key) continue;
      const list = merged.get(key) ?? [];
      list.push(item);
      merged.set(key, list);
    }
    return merged;
  }, [entries, dueItems]);
  const maxDayCount = useMemo(() => Math.max(1, ...[...counts.values()]), [counts]);

  /** 12 个月的格子只在年份变化时重算，避免每次渲染都造 504 个 Date */
  const yearCells = useMemo(() => {
    if (mode === "year") {
      const year = anchorDate.getFullYear();
      return Array.from({ length: 12 }, (_, month) => monthMatrix(year, month));
    }
    if (mode === "month") {
      return [monthMatrix(anchorDate.getFullYear(), anchorDate.getMonth())];
    }
    return [];
  }, [mode, anchorDate]);

  const monthTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const [key, count] of counts) {
      const monthKey = key.slice(0, 7);
      map.set(monthKey, (map.get(monthKey) ?? 0) + count);
    }
    return map;
  }, [counts]);

  function navigate(step: number) {
    if (mode === "week") onAnchor(toKey(addDays(anchorDate, step * 7)));
    else if (mode === "month") onAnchor(toKey(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + step, 1)));
    else if (mode === "year") onAnchor(toKey(new Date(anchorDate.getFullYear() + step, 0, 1)));
    else onAnchor(toKey(new Date(anchorDate.getFullYear() + step * 3, 0, 1)));
  }

  const bar = (
    <div className="cal-bar">
      <button type="button" className="ghost" onClick={() => navigate(-1)}>
        {"← 上一" + unitOf(mode)}
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          onAnchor(todayKey);
          onSelectDay(todayKey);
        }}
        title="跳到今天，右侧同时列出所有未完成的待办"
      >
        今日(待办)
      </button>
      <button type="button" className="ghost" onClick={() => navigate(1)}>
        {"下一" + unitOf(mode) + " →"}
      </button>
      <strong className="cal-label">{range.label}</strong>
      {busy && <span className="muted">载入中…</span>}
      {loadError && <span className="error-inline">加载失败：{loadError}</span>}
    </div>
  );

  if (mode === "week") {
    const start = startOfWeek(anchorDate);
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    return (
      <section className="cal">
        {bar}
        <div
          className="cal-week"
          role="grid"
          onClick={(event) => {
            // 事件委托：整个日列都能点，只在这里判断该选哪天
            const target = (event.target as HTMLElement).closest("[data-day]");
            const day = target instanceof HTMLElement ? target.dataset.day : undefined;
            if (day) onSelectDay(day);
          }}
          onDoubleClick={(event) => {
            const target = (event.target as HTMLElement).closest("[data-day]");
            const day = target instanceof HTMLElement ? target.dataset.day : undefined;
            if (day) onCreateAt(day);
          }}
        >
          {days.map((day, index) => {
            const key = toKey(day);
            const list = byDay.get(key) ?? [];
            const shown = list.slice(0, weekCapacity);
            return (
              <div
                key={key}
                data-day={key}
                className={"cal-week-col" + (key === todayKey ? " today" : "") + (key === selected ? " selected" : "")}
              >
                <div className="cal-week-head">
                  <span className="cal-week-day">{WEEKDAYS[index]}</span>
                  <span className="cal-week-date">{day.getMonth() + 1}/{day.getDate()}</span>
                  <span className="muted">{list.length} 条</span>
                </div>
                <div className="cal-week-body" ref={index === 0 ? weekBodyRef : undefined}>
                  {shown.map((entry) => (
                    <div
                      key={entry.id}
                      className={"cal-entry" + (dueIds.has(entry.id) ? " due-only" : "")}
                      style={{ borderLeftColor: (tagsOfEntry.get(entry.id) ?? [])[0]?.color ?? themeColor(themeOf(entry)) }}
                    >
                      <div
                        className="cal-entry-theme"
                        style={{ color: (tagsOfEntry.get(entry.id) ?? [])[0]?.color ?? themeColor(themeOf(entry)) }}
                      >
                        {themeOf(entry)}
                      </div>
                      <p className="cal-entry-content clamp-3">{entry.content}</p>
                      {isOverdue(entry) ? <span className="row-flag overdue">逾期</span> : null}
                      {entry.due_at ? <span className="cal-entry-due muted">{"截止 " + momentLabel(entry.due_at)}</span> : null}
                      <div className="cal-entry-tags">
                        {(tagsOfEntry.get(entry.id) ?? []).map((tag) => (
                          <span key={tag.id} className="chip" style={tag.color ? { borderColor: tag.color } : undefined}>
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {list.length > shown.length && (
                    <p className="cal-more">{"+" + (list.length - shown.length) + " 条"}</p>
                  )}
                  {list.length === 0 && <p className="muted cal-empty">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (mode === "month") {
    const cells = yearCells[0] ?? [];
    return (
      <section className="cal">
        {bar}
        <div className="cal-grid-head">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div
          className="cal-grid"
          role="grid"
          onClick={(event) => {
            const target = (event.target as HTMLElement).closest("[data-day]");
            const day = target instanceof HTMLElement ? target.dataset.day : undefined;
            if (day) onSelectDay(day);
          }}
          onDoubleClick={(event) => {
            const target = (event.target as HTMLElement).closest("[data-day]");
            const day = target instanceof HTMLElement ? target.dataset.day : undefined;
            if (day) onCreateAt(day);
          }}
        >
          {cells.map((day) => {
            const key = toKey(day);
            const list = byDay.get(key) ?? [];
            const outside = day.getMonth() !== anchorDate.getMonth();
            return (
              <div
                key={key}
                data-day={key}
                className={
                  "cal-cell" + (outside ? " outside" : "") + (key === todayKey ? " today" : "") + (key === selected ? " selected" : "")
                }
              >
                <div className="cal-cell-head">
                  <span>{day.getDate()}</span>
                  {list.length > 0 && <span className="muted">{list.length}</span>}
                </div>
                <div className="cal-cell-body">
                  {list.slice(0, MAX_MONTH_CHIPS).map((entry) => (
                    <span
                      key={entry.id}
                      className={
                        "cal-theme-chip" + (isOverdue(entry) ? " overdue" : "") + (dueIds.has(entry.id) ? " due-only" : "")
                      }
                      style={{ background: (tagsOfEntry.get(entry.id) ?? [])[0]?.color ?? themeColor(themeOf(entry)) }}
                      title={entry.content}
                    >
                      {themeOf(entry)}
                    </span>
                  ))}
                  {list.length > MAX_MONTH_CHIPS && <span className="muted">{"+" + (list.length - MAX_MONTH_CHIPS)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (mode === "year") {
    const year = anchorDate.getFullYear();
    return (
      <section className="cal">
        {bar}
        <div
          className="cal-year"
          role="grid"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            // 具体日期格子 → 周视图；其它任何位置（含月份标题、空白） → 该月的月视图
            const dayHit = target.closest("[data-heat-day]");
            if (dayHit instanceof HTMLElement && dayHit.dataset.heatDay) {
              onAnchorDate?.(dayHit.dataset.heatDay);
              onOpen("week", dayHit.dataset.heatDay);
              return;
            }
            const monthHit = target.closest("[data-month]");
            if (monthHit instanceof HTMLElement && monthHit.dataset.month) {
              onOpen("month", monthHit.dataset.month + "-01");
            }
          }}
        >
          {yearCells.map((cells, month) => {
            const monthCount = cells.reduce(
              (sum, day) => sum + (day.getMonth() === month ? counts.get(toKey(day)) ?? 0 : 0),
              0,
            );
            return (
              <div key={month} data-month={year + "-" + pad(month + 1)} className="cal-year-month">
                <div className="cal-year-head">
                  <span>{month + 1} 月</span>
                  <span className="muted">{monthCount} 完成</span>
                </div>
                <div className="cal-heat-grid">
                  {WEEKDAYS.map((day) => (
                    <span key={day} className="cal-heat-head">
                      {day}
                    </span>
                  ))}
                  {cells.map((day) => {
                    const key = toKey(day);
                    const outside = day.getMonth() !== month;
                    const count = outside ? 0 : counts.get(key) ?? 0;
                    return (
                      <span
                        key={key}
                        data-heat-day={outside ? undefined : key}
                        className={
                          "cal-heat" +
                          (outside ? " outside" : "") +
                          (!outside && key === todayKey ? " today" : "") +
                          (!outside && key === selected ? " selected" : "")
                        }
                        style={outside ? undefined : { background: heatColor(count, maxDayCount) }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  const years = [anchorDate.getFullYear() - 2, anchorDate.getFullYear() - 1, anchorDate.getFullYear()];
  const maxMonth = Math.max(1, ...[...monthTotals.values()]);
  return (
    <section className="cal">
      {bar}
      <div
        className="cal-years"
        role="grid"
        onClick={(event) => {
          const hit = (event.target as HTMLElement).closest("[data-month]");
          if (hit instanceof HTMLElement && hit.dataset.month) onOpen("month", hit.dataset.month + "-01");
        }}
      >
        {years.map((year) => {
          const total = Array.from({ length: 12 }, (_, month) => monthTotals.get(year + "-" + pad(month + 1)) ?? 0).reduce(
            (a, b) => a + b,
            0,
          );
          return (
            <div key={year} className="cal-year-block">
              <header>
                <strong>{year}</strong>
                <span className="muted">{total + " 条完成"}</span>
              </header>
              <div className="cal-months">
                {Array.from({ length: 12 }, (_, month) => {
                  const key = year + "-" + pad(month + 1);
                  const count = monthTotals.get(key) ?? 0;
                  return (
                    <div
                      key={key}
                      data-month={key}
                      className={
                        "cal-month-cell" +
                        (key === todayMonth ? " today" : "") +
                        (key === selectedMonth ? " selected" : "")
                      }
                      style={{ background: heatColor(count, maxMonth) }}
                      title={key + " · " + count + " 条（点击看月视图）"}
                    >
                      <span>{month + 1} 月</span>
                      <em>{count}</em>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default memo(CalendarView);
