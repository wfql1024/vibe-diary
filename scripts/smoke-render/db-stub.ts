// 渲染冒烟测试用的空壳：把 Tauri 的 sql 插件替换掉（不连真库）
export default class Database {
  static async load(_url?: string) {
    return new Database();
  }
  async select() {
    return [];
  }
  async execute() {
    return { rowsAffected: 0, lastInsertId: 0 };
  }
}
