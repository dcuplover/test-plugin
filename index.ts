export default function (api) {

  // ── 1. 注册 AI 工具 ──────────────────────────────────────
  api.registerTool({
    name: "get_weather",
    description: "获取天气",
    parameters: { 
        type: "object", properties: { 
            city: { type: "string" } 
        } 
    },
    handler: async ({ city }) => {
        return `${city} 今天晴天`;
    }
  });

  // ── 2. 注册自定义命令（绕过 LLM）────────────────────────
  api.registerCommand({
    name: "ping",
    description: "健康检查",
    handler: async ({ctx}) => ({ text: `pong from ${ctx.channel}` }),
  });

  // ── 3. 注册 HTTP 路由（接收 Webhook）────────────────────
  api.registerHttpRoute({
    path: "/my-webhook",
    auth: "plugin",
    handler: (req, res) => {
      res.writeHead(200);
      res.end("ok");
    },
  });

  // ── 4. 注册后台服务 ──────────────────────────────────────
  api.registerService({
    id: "my-service",
    start: (ctx) => {
      ctx.logger.info("service started, stateDir=" + ctx.stateDir);
    },
    stop: () => {},
  });

  // ── 5. 监听 LLM 输出 Hook ────────────────────────────────
  api.on("llm_output", (event, ctx) => {
    api.logger.info(`[${ctx.agentId}] tokens used: ${event.usage?.total}`);
  });

  // ── 6. 在发送消息前修改内容 ──────────────────────────────
  api.on("message_sending", (event) => {
    if (event.content.includes("bad word")) {
      return { content: event.content.replace("bad word", "***") };
    }
  });

  // ── 7. 在工具调用前拦截 ──────────────────────────────────
  api.on("before_tool_call", (event) => {
    if (event.toolName === "dangerous_tool") {
      return { block: true, blockReason: "该工具已被禁用" };
    }
  });

  // ── 8. 在 Prompt 构建前注入系统 Prompt ─────────────────
  api.on("before_prompt_build", (event, ctx) => {
    return { appendSystemContext: "请始终用中文回答。" };
  });

  // ── 9. 在模型解析前覆盖模型 ─────────────────────────────
  api.on("before_model_resolve", (event) => {
    if (event.prompt.includes("代码")) {
      return { modelOverride: "claude-3-5-sonnet" };
    }
  });

  // ── 10. 使用 Runtime：分割长文本 ────────────────────────
  api.registerTool({
    name: "send_long_text",
    description: "发送长文本（自动分段）",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    run: ({ text }, toolCtx) => {
      const limit = api.runtime.channel.text.resolveTextChunkLimit(
        api.config,
        toolCtx?.messageChannel ?? "telegram",
      );
      const chunks = api.runtime.channel.text.chunkMarkdownText(text, limit);
      return `将分为 ${chunks.length} 段发送`;
    },
  });

  // ── 11. 使用 Runtime：启动子 Agent ──────────────────────
  api.registerTool({
    name: "delegate_to_agent",
    description: "委托给另一个 Agent",
    parameters: {
      type: "object",
      properties: {
        agentSessionKey: { type: "string" },
        task: { type: "string" },
      },
    },
    run: ({ agentSessionKey, task }) => {
      return api.runtime.subagent
        .run({
          sessionKey: agentSessionKey,
          message: task,
        })
        .then(({ runId }) =>
          api.runtime.subagent.waitForRun({
            runId,
            timeoutMs: 30_000,
          }),
        )
        .then((result) =>
          result.status === "ok" ? "子 Agent 完成" : `失败: ${result.error}`,
        );
    },
  });

  // ── 12. 使用 Runtime：下载远程媒体 ──────────────────────
  api.registerTool({
    name: "fetch_image",
    description: "下载图片",
    parameters: { type: "object", properties: { url: { type: "string" } } },
    run: ({ url }) => {
      return api.runtime.channel.media.fetchRemoteMedia({ url }).then(({ buffer, contentType }) => {
        return `下载完成，类型: ${contentType}，大小: ${buffer.length} bytes`;
      });
    },
  });

  // ── 13. 使用 Runtime：获取子 Logger ─────────────────────
  const log = api.runtime.logging.getChildLogger("my-module");
  log.info("plugin loaded");

  // ── 14. 使用 Runtime：state 目录 ────────────────────────
  const stateDir = api.runtime.state.resolveStateDir(api.config);
  api.logger.info(`state stored at: ${stateDir}`);
}