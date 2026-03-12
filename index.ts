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

  api.on("before_prompt_build", async (event, ctx) => {
    api.logger.info("ctx keys:", ctx);
    api.logger.info("api.agentId:", api);

    console.log(event);
    console.log(ctx);
    
    // 尝试从 ctx 或 api 上获取 agentId
    const agentId = ctx?.agentId || api.agentId;
    
    api.logger.info("resolved agentId:", agentId);

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
        async handler(ctx) {
            console.log("测试命令被触发了！", ctx);
            return {
                text: "这是测试命令的响应！"
            };
        },
  });

  // 注册一个cli工具
  api.registerCli(
    ({program}) => {
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

}