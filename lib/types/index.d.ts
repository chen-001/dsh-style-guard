/**
 * @dsh-external/dsh-style-guard
 *
 * 拦在模型的输出流中间。整段话先落进这里，检查并改写之后才交给上层，
 * 所以页面上显示的和写进对话记录的都是改写后的版本，不会先出现一版难读的。
 *
 * 三件必须做的事（这个插件站在每次回复的必经之路上）：
 * 1. 只拦够长的回复，要调用工具的那几轮原样放过去；
 * 2. 改写的前后核对数字，改错、多出，或者用户问数量时删了，就整段作废用原文；
 * 3. 自己任何一步失败或超时都放行原文，不能让用户的对话卡住。
 */
import type { Context } from 'cordis';
import z from 'schemastery';
export declare const name = "@dsh-external/dsh-style-guard";
export declare const inject: string[];
/** 侧边栏面板读取记录的地址前缀。 */
export declare const API_PATH = "/dsh-style-guard/api";
export interface Config {
    /** 总开关。 */
    enabled: boolean;
    /** true 时只检查、记录，不真的替换页面上的文字。 */
    dryRun: boolean;
    /** 正文短于这个字数就不检查。 */
    minChars: number;
    /** 检查加改写做几轮，上限 2。 */
    rounds: number;
    /** 检查和改写总共允许多花多少毫秒，超了用手上已有的版本。 */
    maxExtraMs: number;
    /** 只处理这些会话，留空表示全部。 */
    sessions: string[];
    /** 只处理主 agent，跳过子 agent。 */
    onlyRootAgents: boolean;
    /**
     * 只处理模型名字里都带这些字的请求。空格分开，写几个就要几个都在。
     * 例如 deepseek flash 表示名字里既要有 deepseek 又要有 flash。留空表示不按模型筛。
     */
    modelFilter: string;
    /** 检查与改写用哪个服务商，留空表示跟主模型一致。 */
    provider: string;
    /** 检查与改写用哪个模型，留空表示跟主模型一致。 */
    model: string;
    /**
     * 改写那一步的思考档位，留空表示不思考。
     * 不思考时改写器只肯换词；开了思考它才会重新组织句子，代价是每条回复多等十几到几十秒。
     * 档位名字要是这个模型在配置里认的那几个，例如 low、medium。
     */
    rewriteEffort: string;
    /** 是否把跳过的原因也记进日志。 */
    verbose: boolean;
    /** 是否把每一次模型调用都记进日志，用来排查插件有没有收到事件。 */
    trace: boolean;
    /** 审查记录写到哪。 */
    auditPath: string;
    /** 规范从哪读。 */
    rubricPath: string;
}
export declare const Config: z<Schemastery.ObjectS<{
    enabled: z<boolean, boolean>;
    dryRun: z<boolean, boolean>;
    minChars: z<number, number>;
    rounds: z<number, number>;
    maxExtraMs: z<number, number>;
    sessions: z<string[], string[]>;
    onlyRootAgents: z<boolean, boolean>;
    modelFilter: z<string, string>;
    provider: z<string, string>;
    model: z<string, string>;
    rewriteEffort: z<string, string>;
    verbose: z<boolean, boolean>;
    trace: z<boolean, boolean>;
    auditPath: z<string, string>;
    rubricPath: z<string, string>;
}>, Schemastery.ObjectT<{
    enabled: z<boolean, boolean>;
    dryRun: z<boolean, boolean>;
    minChars: z<number, number>;
    rounds: z<number, number>;
    maxExtraMs: z<number, number>;
    sessions: z<string[], string[]>;
    onlyRootAgents: z<boolean, boolean>;
    modelFilter: z<string, string>;
    provider: z<string, string>;
    model: z<string, string>;
    rewriteEffort: z<string, string>;
    verbose: z<boolean, boolean>;
    trace: z<boolean, boolean>;
    auditPath: z<string, string>;
    rubricPath: z<string, string>;
}>>;
/** 插件配置文件。改这里的值之后重载插件即可生效，不用重新构建。 */
export declare const CONFIG_PATH: string;
export declare function apply(ctx: Context, schemaConfig: Config): void;
