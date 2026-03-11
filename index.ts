export default function (api) {

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
    async execute(_id, params){
        const { city } = params;
        return { content: [{ type: "text", text: `这是 ${city} 的天气：晴天，25度。` }] };
    }
  });

  api.on("before_prompt_build", async (event) => {
    api.logger.info("Agent 即将启动，事件数据：", event);

    console.log(event);

    api.logger.info("event keys:", Object.keys(event));

    const agentId = event.sessionKey?.split(":")[1]

    api.logger.info("agentId:", event.sessionKey?.split(":")[1], "full key:", event.sessionKey);

    if (agentId === "main") {
        return {
            prependContext: "我将测试prompt添加到了Agent的上下文中。"
        }
    } else {
        return {
            prependContext: "这是一个子Agent，我没有添加任何上下文。"
        }
    }
  });
}