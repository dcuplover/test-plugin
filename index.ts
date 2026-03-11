import { Type } from "@sinclair/typebox";

export default function (api) {

  // ── 1. 注册 AI 工具 ──────────────────────────────────────
  api.registerTool({
    name: "get_weather",
    description: "测试获取天气",
    parameters: Type.Object({
        city: Type.String()
    }),
    async execute(_id, params){
        const { city } = params;
        return { content: [{ type: "text", text: `这是 ${city} 的天气：晴天，25度。` }] };
    }
  });

  api.on("before_agent_start", async (event) => {
    api.logger.info("Agent 即将启动，事件数据：", event);
  });
}