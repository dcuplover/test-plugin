import * as lancedb from "@lancedb/lancedb";

const PLUGIN_ID = "test-plugin";
const DEFAULT_RESULT_LIMIT = 3;
const DEFAULT_MIN_PROMPT_LENGTH = 5;
const DEFAULT_MAX_FIELD_LENGTH = 240;
const DEFAULT_SELECT_COLUMNS = ["id", "title", "content", "text", "summary", "source"];

type PluginConfig = {
    lanceDbPath?: string;
    tableName?: string;
    ftsColumns?: string[];
    selectColumns?: string[];
    resultLimit?: number;
    minPromptLength?: number;
    maxFieldLength?: number;
};

type LanceDbRow = Record<string, unknown>;

type LanceDbTable = {
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

type CachedTableState = {
    dbPath: string;
    tableName: string;
    table: LanceDbTable;
};

let cachedTableState: CachedTableState | undefined;

function getPluginConfig(api: any): PluginConfig {
    return api.config?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
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
    const ftsColumns = normalizeStringArray(cfg.ftsColumns);

    try {
        const table = await getTable(lanceDbPath, tableName);
        const query = table.search(normalizedPrompt, "fts", ftsColumns);
        const rows = await query.limit(resultLimit).toArray();

        api.logger.info(
            `LanceDB 检索完成: table=${tableName}, rows=${Array.isArray(rows) ? rows.length : 0}`,
        );

        return formatSearchResults(Array.isArray(rows) ? rows : [], cfg);
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
            return {
                text: "这是测试命令的响应！"
            };
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