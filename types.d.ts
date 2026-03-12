declare module "@lancedb/lancedb" {
  export type LanceDbRow = Record<string, unknown>;

  export type LanceDbIndexConfig = {
    config?: {
      inner?: unknown;
    };
    replace?: boolean;
  };

  export type LanceDbTable = {
    search(
      query: string,
      queryType?: string,
      ftsColumns?: string[],
    ): {
      limit(limit: number): {
        toArray(): Promise<LanceDbRow[]>;
      };
    };
    add(data: LanceDbRow[]): Promise<unknown>;
    createIndex(column: string, options?: LanceDbIndexConfig): Promise<void>;
  };

  export class Index {
    static fts(): Index;
  }

  export function connect(uri: string): Promise<{
    tableNames(): Promise<string[]>;
    openTable(name: string): Promise<LanceDbTable>;
    createTable(name: string, data: LanceDbRow[]): Promise<LanceDbTable>;
  }>;
}