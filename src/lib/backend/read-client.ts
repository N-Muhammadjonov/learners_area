import pg from "pg";
import { backendServerCall } from "./server";

type WireResult = {
  fields: { name: string; dataTypeID: number }[];
  rows: (string | null)[][];
};
type Query = { text: string; rowMode?: "array"; types?: { getTypeParser(oid: number, format?: "text"): (value: string) => unknown } };

/**
 * The existing server-rendered view selectors keep their typed result shapes.
 * Python owns the connection, statement timeout, codecs and read-only transaction.
 * No PostgreSQL socket or mutation is available in the Next.js runtime.
 */
export class FrontendReadClient {
  constructor(private readonly execute = (sql: string, params: unknown[]) => backendServerCall<WireResult>("/_frontend/query", { sql, params })) {}
  async query(query: string | Query, values: unknown[] = []) {
    const config = typeof query === "string" ? { text: query } : query;
    const result = await this.execute(config.text, values);
    const rows = result.rows.map(row => {
      const parsed = row.map((value, i) => {
        if (value === null) return null;
        const field = result.fields[i]!;
        const parser = config.types?.getTypeParser(field.dataTypeID, "text") ?? pg.types.getTypeParser(field.dataTypeID, "text");
        return parser(value);
      });
      return config.rowMode === "array" ? parsed : Object.fromEntries(result.fields.map((field, i) => [field.name, parsed[i]]));
    });
    return { rows, fields: result.fields, rowCount: rows.length, command: "SELECT", oid: 0 };
  }
}
