const { DatabaseSync } = require("node:sqlite");
const path = require("node:path").join(process.env.APPDATA, "com.peekode.vibeDiary", "vibe-diary.db");
const db = new DatabaseSync(path, { readOnly: true });
console.log("db:", path);
console.log(db.prepare("SELECT (SELECT COUNT(*) FROM entries) entries, (SELECT COUNT(*) FROM tags) tags, (SELECT COUNT(*) FROM tag_links) links, (SELECT COUNT(*) FROM entry_tags) entry_tags").get());
console.log("links:");
for (const row of db.prepare("SELECT s.name AS source, t.name AS target FROM tag_links l JOIN tags s ON s.id = l.source_tag_id JOIN tags t ON t.id = l.target_tag_id ORDER BY s.name, t.name").all()) {
  console.log("  " + row.source + " -> " + row.target);
}
db.close();
