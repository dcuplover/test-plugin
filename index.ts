import * as lancedb from "@lancedb/lancedb";

const PLUGIN_ID = "test-plugin";
const DEFAULT_RESULT_LIMIT = 3;
const DEFAULT_MIN_PROMPT_LENGTH = 5;
const DEFAULT_MAX_FIELD_LENGTH = 240;
const DEFAULT_SELECT_COLUMNS = ["id", "title", "content", "text", "summary", "source"];
const DEFAULT_TEST_FTS_COLUMNS = ["title", "content", "summary"];
const DEFAULT_TOP_K = 10;

type TestDocument = {
    id: string;
    title: string;
    content: string;
    summary: string;
    source: string;
};

type PluginConfig = {
    lanceDbPath?: string;
    tableName?: string;
    ftsColumns?: string[];
    selectColumns?: string[];
    resultLimit?: number;
    minPromptLength?: number;
    maxFieldLength?: number;
    embedBaseUrl?: string;
    embedModel?: string;
    embedApiKey?: string;
    rerankBaseUrl?: string;
    rerankModel?: string;
    rerankApiKey?: string;
    topK?: number;
};

type LanceDbRow = Record<string, unknown>;

type LanceDbTable = {
    search(
        query: string | number[] | Float32Array,
        queryType?: string,
        ftsColumns?: string[],
    ): {
        limit(limit: number): {
            toArray(): Promise<LanceDbRow[]>;
        };
    };
};

type LanceDbWritableTable = LanceDbTable & {
    add(data: LanceDbRow[]): Promise<unknown>;
    createIndex(column: string, options?: Record<string, unknown>): Promise<void>;
};

type LanceDbConnection = {
    tableNames(): Promise<string[]>;
    openTable(name: string): Promise<LanceDbWritableTable>;
    createTable(name: string, data: LanceDbRow[]): Promise<LanceDbWritableTable>;
};

type CachedTableState = {
    dbPath: string;
    tableName: string;
    table: LanceDbTable;
};

let cachedTableState: CachedTableState | undefined;

function getPluginConfig(api: any): PluginConfig {
    return api.config?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
}

function getConfiguredDbTarget(api: any): { dbPath: string; tableName: string } | undefined {
    const cfg = getPluginConfig(api);
    const dbPath = cfg.lanceDbPath?.trim();
    const tableName = cfg.tableName?.trim();

    if (!dbPath || !tableName) {
        return undefined;
    }

    return { dbPath, tableName };
}

async function generateEmbedding(text: string, cfg: PluginConfig): Promise<number[]> {
    const baseUrl = cfg.embedBaseUrl?.trim()?.replace(/\/$/, "");
    const model = cfg.embedModel?.trim();
    const apiKey = cfg.embedApiKey?.trim();

    if (!baseUrl || !model) {
        throw new Error("未配置 embedBaseUrl 或 embedModel，无法生成嵌入向量。");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: text }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Embedding API 请求失败 (${response.status}): ${body}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
}

async function rerankDocuments(
    query: string,
    documents: string[],
    cfg: PluginConfig,
    topN: number,
): Promise<number[]> {
    const baseUrl = cfg.rerankBaseUrl?.trim()?.replace(/\/$/, "");
    const model = cfg.rerankModel?.trim();
    const apiKey = cfg.rerankApiKey?.trim();

    if (!baseUrl || !model) {
        throw new Error("未配置 rerankBaseUrl 或 rerankModel，无法进行重排序。");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/rerank`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, query, documents, top_n: topN }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Rerank API 请求失败 (${response.status}): ${body}`);
    }

    const data = await response.json() as {
        results: Array<{ index: number; relevance_score: number }>;
    };
    return data.results.map((r) => r.index);
}

function buildTestDocuments(): TestDocument[] {
    const batchId = Date.now();

    return [
        {
            id: `test-doc-${batchId}-1`,
            title: "OpenClaw 插件测试文档",
            content:
                "这是写入 LanceDB 的第一条测试数据，用于验证 before_prompt_build 检索链路是否正常工作。",
            summary: "用于测试插件检索上下文注入。",
            source: "test_command",
        },
        {
            id: `test-doc-${batchId}-2`,
            title: "LanceDB 全文检索样例",
            content:
                "这条数据包含 LanceDB、全文检索、插件命令等关键词，便于验证 test-plugin 的 FTS 搜索效果。",
            summary: "用于测试全文索引与搜索结果格式化。",
            source: "test_command",
        },
        {
            id: `test-doc-${batchId}-3`,
            title: "测试命令自动建表",
            content:
                "如果目标表不存在，test_command 会自动创建数据表并写入测试记录，然后为配置列创建全文索引。",
            summary: "用于测试表初始化与索引创建。",
            source: "test_command",
        },
    ];
}

async function seedTestData(api: any): Promise<string> {
    const target = getConfiguredDbTarget(api);

    if (!target) {
        return "未配置 lanceDbPath 或 tableName，请先在插件配置中填写 LanceDB 路径和表名。";
    }

    const cfg = getPluginConfig(api);
    const documents = buildTestDocuments();
    const ftsColumns = normalizeStringArray(cfg.ftsColumns) ?? DEFAULT_TEST_FTS_COLUMNS;
    const hasEmbedding = !!(cfg.embedBaseUrl?.trim() && cfg.embedModel?.trim());

    let docsToStore: LanceDbRow[];
    if (hasEmbedding) {
        docsToStore = await Promise.all(
            documents.map(async (doc) => {
                const embedText = [doc.title, doc.content, doc.summary]
                    .filter(Boolean)
                    .join(" ");
                const vector = await generateEmbedding(embedText, cfg);
                return { ...doc, vector };
            }),
        );
        api.logger.info("嵌入向量生成完成，准备写入 LanceDB。");
    } else {
        docsToStore = documents;
    }

    const db = (await lancedb.connect(target.dbPath)) as unknown as LanceDbConnection;
    const tableNames = await db.tableNames();
    const tableExists = tableNames.includes(target.tableName);

    const table = tableExists
        ? await db.openTable(target.tableName)
        : await db.createTable(target.tableName, docsToStore);

    if (tableExists) {
        await table.add(docsToStore);
    }

    for (const column of ftsColumns) {
        if (!(column in documents[0])) {
            api.logger.warn(`跳过不存在的 FTS 列: ${column}`);
            continue;
        }

        await table.createIndex(column, {
            config: (lancedb as any).Index.fts(),
            replace: true,
        });
    }

    cachedTableState = {
        dbPath: target.dbPath,
        tableName: target.tableName,
        table,
    };

    api.logger.info(
        `LanceDB 测试数据写入完成: table=${target.tableName}, inserted=${documents.length}, created=${!tableExists}, embedding=${hasEmbedding}`,
    );

    const action = tableExists ? "已向现有表追加测试数据" : "已创建表并写入测试数据";
    const embeddingNote = hasEmbedding ? "，含嵌入向量字段" : "";
    return `${action}：${target.tableName}。本次写入 ${documents.length} 条记录${embeddingNote}，并尝试为以下列创建全文索引：${ftsColumns.join(", ")}。`;
}

function normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const items = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);

    return items.length > 0 ? items : undefined;
}

function truncateText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return undefined;
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatSearchResults(rows: LanceDbRow[], cfg: PluginConfig): string | undefined {
    if (rows.length === 0) {
        return undefined;
    }

    const selectColumns = normalizeStringArray(cfg.selectColumns) ?? DEFAULT_SELECT_COLUMNS;
    const maxFieldLength = Math.max(cfg.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH, 20);

    const lines = rows
        .map((row, index) => {
            const fields = selectColumns
                .map((key) => {
                    const text = truncateText(row[key], maxFieldLength);
                    return text ? `${key}: ${text}` : undefined;
                })
                .filter((value): value is string => Boolean(value));

            return fields.length > 0 ? `${index + 1}. ${fields.join(" | ")}` : undefined;
        })
        .filter((value): value is string => Boolean(value));

    if (lines.length === 0) {
        return undefined;
    }

    return [
        "以下内容来自 LanceDB 检索结果，请仅在与用户问题直接相关时使用：",
        ...lines,
    ].join("\n");
}

async function getTable(dbPath: string, tableName: string): Promise<LanceDbTable> {
    if (
        cachedTableState &&
        cachedTableState.dbPath === dbPath &&
        cachedTableState.tableName === tableName
    ) {
        return cachedTableState.table;
    }

    const db = await lancedb.connect(dbPath);
    const table = await db.openTable(tableName);
    cachedTableState = { dbPath, tableName, table };
    return table;
}

async function queryLanceDb(api: any, prompt: string): Promise<string | undefined> {
    const cfg = getPluginConfig(api);
    const lanceDbPath = cfg.lanceDbPath?.trim();
    const tableName = cfg.tableName?.trim();
    const minPromptLength = Math.max(cfg.minPromptLength ?? DEFAULT_MIN_PROMPT_LENGTH, 1);

    if (!lanceDbPath || !tableName) {
        api.logger.warn("LanceDB 未配置 lanceDbPath 或 tableName，已跳过检索。");
        return undefined;
    }

    const normalizedPrompt = prompt.trim();
    if (normalizedPrompt.length < minPromptLength) {
        return undefined;
    }

    const resultLimit = Math.max(cfg.resultLimit ?? DEFAULT_RESULT_LIMIT, 1);
    const hasEmbedding = !!(cfg.embedBaseUrl?.trim() && cfg.embedModel?.trim());
    const hasRerank = !!(cfg.rerankBaseUrl?.trim() && cfg.rerankModel?.trim());
    const topK = Math.max(cfg.topK ?? DEFAULT_TOP_K, resultLimit);
    const fetchLimit = hasRerank ? topK : resultLimit;

    try {
        const table = await getTable(lanceDbPath, tableName);
        let rows: LanceDbRow[];

        if (hasEmbedding) {
            const vector = await generateEmbedding(normalizedPrompt, cfg);
            rows = await table.search(vector).limit(fetchLimit).toArray();
        } else {
            const ftsColumns = normalizeStringArray(cfg.ftsColumns);
            rows = await table.search(normalizedPrompt, "fts", ftsColumns).limit(fetchLimit).toArray();
        }

        if (!Array.isArray(rows)) {
            rows = [];
        }

        if (hasRerank && rows.length > 1) {
            const documents = rows.map((row) =>
                ["title", "content", "summary"]
                    .map((k) => (typeof row[k] === "string" ? (row[k] as string) : ""))
                    .filter(Boolean)
                    .join(" "),
            );
            try {
                const rerankedIndices = await rerankDocuments(normalizedPrompt, documents, cfg, resultLimit);
                rows = rerankedIndices.map((i) => rows[i]).filter(Boolean);
            } catch (rerankError) {
                api.logger.warn(`Rerank 失败，回退到原始排序: ${String(rerankError)}`);
                rows = rows.slice(0, resultLimit);
            }
        } else {
            rows = rows.slice(0, resultLimit);
        }

        api.logger.info(
            `LanceDB 检索完成: table=${tableName}, rows=${rows.length}, embedding=${hasEmbedding}, rerank=${hasRerank}`,
        );

        return formatSearchResults(rows, cfg);
    } catch (error) {
        api.logger.warn(`LanceDB 检索失败: ${String(error)}`);
        return undefined;
    }
}

export default function (api: any) {

  // ── 1. 注册 AI 工具 ──────────────────────────────────────
  api.registerTool({
    name: "get_weather",
    description: "测试获取天气",
    parameters: {
        type: "object",
        properties: {
            city: { type: "string" }
        }
    },
    async execute(_id: string, params: { city?: string }){
        const { city } = params;
        return { content: [{ type: "text", text: `这是 ${city} 的天气：晴天，25度。` }] };
    }
  });

    api.on("before_prompt_build", async (event: { prompt: string }, ctx: { trigger?: string }) => {
        if (ctx?.trigger && ctx.trigger !== "user") {
            return;
        }

        const retrievedContext = await queryLanceDb(api, event.prompt);
        if (!retrievedContext) {
            return;
        }

        return {
            prependContext: retrievedContext,
        };
  });

  // 添加斜杠命令hook
  api.registerHook(
    "command:new",
    async(event: any) => {
        api.logger.info("如果看到我，说明斜杠命令hook生效了！");
        api.logger.info("event:", event);
        console.log(event);
        
        return event;
    },
    {
        name: "test-plugin.command",
        description: "Append self-improvement note before /new",
    }
  );

  // 注册一个新的斜杠命令
  api.registerCommand(
  {
        name: "test_command",
        description: "这是一个测试命令",
        async handler(ctx: any) {
            console.log("测试命令被触发了！", ctx);

            try {
                const text = await seedTestData(api);
                return { text };
            } catch (error) {
                const message = `写入 LanceDB 测试数据失败: ${String(error)}`;
                api.logger.warn(message);
                return { text: message };
            }
        },
  });

  // 注册一个cli工具
  api.registerCli(
        ({program}: { program: any }) => {
        program.command("test-cli")
            .description("这是一个测试CLI命令")
            .action(() => {
                console.log("测试CLI命令被执行了！");
                console.log(program)
            });
    },
    {
        commands: ["test-cli"],
    }
  );

  //注册一个后台服务，
  api.registerService({
    id: "my-service",
    start: () => {
        api.logger.info("我的服务启动了！");
    },
    stop: () => {
        api.logger.info("我的服务停止了！");
    },
  });

  // 注册一个provider [暂时不用]
  
  // 注册一个channel 也就是注册一个通信通道插件
}