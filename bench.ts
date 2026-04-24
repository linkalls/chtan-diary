import { Database } from "bun:sqlite";
import { performance } from "perf_hooks";

function runBench(wal: boolean) {
  const db = new Database(":memory:");
  if (wal) db.exec("PRAGMA journal_mode = WAL;");
  
  db.exec("CREATE TABLE tests (id INTEGER PRIMARY KEY, val TEXT);");
  
  const start = performance.now();
  const insert = db.prepare("INSERT INTO tests (val) VALUES (?)");
  
  db.transaction(() => {
    for (let i = 0; i < 10000; i++) {
      insert.run(`test_${i}`);
    }
  })();
  
  const end = performance.now();
  db.close();
  return end - start;
}

console.log("Normal mode:", runBench(false), "ms");
console.log("WAL mode:", runBench(true), "ms");
