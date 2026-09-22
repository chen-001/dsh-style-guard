export interface Critique {
    problems: string[];
    verdict: string;
}
export interface ImproveDeps {
    critique: (text: string) => Promise<Critique | undefined>;
    rewrite: (text: string, critique: Critique) => Promise<string | undefined>;
    now: () => number;
}
export interface ImproveResult {
    text: string;
    roundsRun: number;
    problems: string[];
    rejected?: {
        missing: string[];
    };
    notes: string[];
}
/** 反复审改到没问题、到轮次上限、或到时间上限为止。 */
export declare function improve(original: string, rounds: number, deadline: number, deps: ImproveDeps): Promise<ImproveResult>;
