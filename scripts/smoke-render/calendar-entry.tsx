import { renderToString } from "react-dom/server";
import CalendarView from "../../src/components/CalendarView";

const noop = () => {};
for (const mode of ["week", "month", "year", "years"] as const) {
  const html = renderToString(
    <CalendarView mode={mode} anchor="2025-09-28" onAnchor={noop} selected="2025-09-28" onSelectDay={noop} onOpen={noop} onCreateAt={noop} />,
  );
  console.log("CALENDAR_" + mode.toUpperCase() + "_OK length=" + html.length);
}
