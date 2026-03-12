declare module "@lancedb/lancedb" {
  export type LanceDbRow = Record<string, unknown>;

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
  };

  export function connect(uri: string): Promise<{
    openTable(name: string): Promise<LanceDbTable>;
  }>;
}