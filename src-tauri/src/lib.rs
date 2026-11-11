use tauri_plugin_sql::{Migration, MigrationKind};

/// SQLite 数据库标识：前端用 Database.load("sqlite:vibe-diary.db") 打开同一个库
const DB_URL: &str = "sqlite:vibe-diary.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "tag_links_directed",
            sql: include_str!("../migrations/002_tag_links_directed.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "entry_todo_fields",
            sql: include_str!("../migrations/003_entry_todo_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "entry_completed_at",
            sql: include_str!("../migrations/004_entry_completed_at.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "entry_single_datetime",
            sql: include_str!("../migrations/005_entry_single_datetime.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
