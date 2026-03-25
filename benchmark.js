import { Database } from "bun:sqlite";
const db = new Database(":memory:");
db.query("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT);").run();
const insert = db.prepare("INSERT INTO test (val) VALUES ($val)");
const start = performance.now();
const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run({ $val: row });
});
const data = Array(100000).fill("hello");
insertMany(data);
const end = performance.now();
console.log(`Inserted 100,000 rows in ${end - start} ms`);
