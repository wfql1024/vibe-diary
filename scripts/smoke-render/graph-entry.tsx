import { renderToString } from "react-dom/server";
import TagGraph from "../../src/components/TagGraph";
import type { Tag, TagLink } from "../../src/db";

// 假数据，只为验证画布组件能渲染（不读真库）
const tags: Tag[] = [
  { id: 1, name: "标签A", color: "#2f6bff", usage: 120, reach: 300 },
  { id: 2, name: "标签B", color: "#e0603c", usage: 40, reach: 40 },
  { id: 3, name: "标签C", color: "#2fa36b", usage: 0, reach: 180 },
];
const links: TagLink[] = [
  { source_tag_id: 1, target_tag_id: 2 },
  { source_tag_id: 2, target_tag_id: 1 },
  { source_tag_id: 3, target_tag_id: 1 },
];

const html = renderToString(
  <TagGraph tags={tags} links={links} onCreateLink={() => {}} onDeleteLink={() => {}} />,
);
console.log("GRAPH_RENDER_OK length=" + html.length + " svg=" + html.includes("<svg") + " circle=" + html.includes("<circle"));
