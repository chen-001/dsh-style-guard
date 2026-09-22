# AGENTS.md — dsh-style-guard

DSH 回复风格检查插件。拦在模型的输出流中间，先检查、改写，再把结果交给上层。

- **形态**：host + client 两半，bundle 插件，`cordis.patch.yml` 只有一行 insert。
  host 拦输出流并留档；client 在右侧栏挂一个标签页展示记录。
- **入口**：`src/index.ts` 监听 `llm/stream` 瀑布。判断某次调用是不是主对话写回复，见 `looksLikeAgentCall`。
- **模块**：`guard.ts` 分片收集与替换、事实核对；`improve.ts` 审改轮次；`critic.ts` 两次模型调用与提示词；`rubric.ts` 现读规范；`audit.ts` 留档。
- **构建**：`bash scripts/build.sh`（host，走 DSH_CHECKOUT 里的 tsc）加 `bash scripts/build-client.sh`（client，走同一个 checkout 里的 tsdown）。`npm run build:all` 两半一起。
- **自测**：`node scripts/test-guard.mjs`，纯逻辑，不调用模型。
- **注入检查回归**：`node scripts/test-runtime.mjs <宿主 cordis 的 lib/index.js>`，用真实 Context 验证插件能挂载、主回复被拦、子 agent 与附带调用被放行。改动 inject 或判断逻辑之后必须跑一次。
- **配置**：profile patch 的 `config`，可被 `~/.dsh/style-guard/config.json` 覆盖；改完重载插件即生效。
- **面板数据**：host 侧 `registerRecordsApi` 用延迟注入挂一个只读接口 `/dsh-style-guard/api/records`，client 侧只读它，不碰文件。

## 三条必须守住的边界

1. 这个位置在每次模型调用的必经之路上，监听体必须包在 try 里，任何异常都退回原始流。
2. 不要直接读没有声明 inject 的服务。曾经漏声明 `agents` 并用类型断言绕过，
   运行时照样抛错，整轮对话在模型开口前就断了。用 `reflect.get` 读可选服务。
3. 改写必须过 `preservesFacts`，数字、路径、反引号名字少一个就整段作废。

## 两个踩过的坑

**一、弱集合不共享。** 框架的 `isAgentLoopRequest` 依据是按对象身份记录的弱集合，
构建时链接的 `@deepseek-ai/dsh-llm` 与运行时宿主加载的那份是两个模块实例，弱集合不共享，
判断永远是假。改用 `Object.isFrozen(request)` 加 `purpose === undefined` 判断。

**二、client-modules 会缓存「这个包没有 client 半」。** 插件第一次注入时没有
`dsh.client` 声明，client-modules 把这次查询的否定结果按 (loaderName, baseUrl) 缓存了下来。
之后补上 client 再热重载，`processOne` 读的还是那份旧缓存，注册永远不成功，
表现为重载信息里 `client ✗`。解法是先 `clientModules.pkgMeta.delete(sourceKey)`
再 `processOne(完整包名)`，然后 `compose()` 加 `notifyGraphChanged()`。
在运行中的进程里做这件事，可以用 `dev_stage_add` 挂一段临时 JS。
注意 `processOne` 的名字必须是完整包名，短名匹配不上 `entry.options.name`。
