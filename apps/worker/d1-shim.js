// @ts-check
/**
 * A minimal D1-compatible wrapper over node:sqlite, for local dev and tests.
 * Implements exactly the surface worker.js uses:
 *   prepare(sql).bind(...).first(col?) / .all() / .run(), and batch([...]).
 */
import { DatabaseSync } from "node:sqlite";

export class D1Shim {
  /** @param {string} [file] */
  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
    /** @type {Promise<unknown>} tail of the batch queue */
    this.queue = Promise.resolve();
  }

  /** @param {string} sql */
  exec(sql) {
    this.db.exec(sql);
  }

  /** @param {string} sql */
  prepare(sql) {
    const db = this.db;
    /** @type {any[]} */
    let params = [];
    const stmt = {
      bind(...args) {
        params = args;
        return stmt;
      },
      async first(col) {
        const row = db.prepare(sql).get(...params);
        if (row === undefined) return null;
        return col === undefined ? row : (row[col] ?? null);
      },
      async all() {
        return { results: db.prepare(sql).all(...params), success: true };
      },
      async run() {
        const info = db.prepare(sql).run(...params);
        return { success: true, meta: { changes: info.changes } };
      },
    };
    return stmt;
  }

  /**
   * Batches run one at a time, as D1 runs them: two requests batching at once
   * must not open a transaction inside the other's.
   * @param {Array<{run(): Promise<any>}>} stmts
   */
  batch(stmts) {
    const run = async () => {
      this.db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        this.db.exec("COMMIT");
        return out;
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
}
