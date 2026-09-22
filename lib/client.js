window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-style-guard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region client/index.ts
		/**
		* @dsh-external/dsh-style-guard 客户端半边。
		*
		* 在右侧栏注册一个标签页，展示每一次检查的记录。数据从宿主那边的只读接口取，
		* 客户端读不到文件，也不该读。
		*
		* 注册走延迟注入，老版本没有 sidebarRightTabs 服务时整段跳过，不影响本体。
		*/
		const inject = ["slots"];
		const TAB_ID = "dsh-style-guard";
		const TAB_KIND = "dsh-style-guard";
		const API = "/dsh-style-guard/api/records?limit=50";
		const CARD = {
			border: "1px solid #e3e5e8",
			borderRadius: "8px",
			background: "#fff",
			padding: "10px 12px",
			marginBottom: "10px"
		};
		const MUTED = {
			color: "#7a7f87",
			fontSize: "12px"
		};
		function badge(text, color, background) {
			return (0, react.createElement)("span", { style: {
				display: "inline-block",
				padding: "1px 8px",
				borderRadius: "10px",
				fontSize: "12px",
				color,
				background,
				marginRight: "8px"
			} }, text);
		}
		function statusOf(entry) {
			if (entry.applied) return badge("已采纳", "#1a7f37", "#e6f4ea");
			if (entry.dryRun) return badge("只检查", "#8a6d00", "#fff8e1");
			if (entry.missing.length > 0) return badge("被驳回", "#b42318", "#fdecea");
			return badge("未改动", "#5b6169", "#f0f1f3");
		}
		function textBlock(title, body, tint) {
			return (0, react.createElement)("div", { style: {
				flex: "1 1 0",
				minWidth: "0"
			} }, [(0, react.createElement)("div", {
				key: "t",
				style: {
					...MUTED,
					marginBottom: "4px"
				}
			}, title), (0, react.createElement)("pre", {
				key: "b",
				style: {
					margin: "0",
					padding: "8px",
					background: tint,
					borderRadius: "6px",
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					maxHeight: "260px",
					overflow: "auto",
					fontSize: "12px",
					lineHeight: "1.6"
				}
			}, body || "（空）")]);
		}
		function detail(entry) {
			const rows = [];
			if (entry.problems.length > 0) rows.push((0, react.createElement)("div", {
				key: "p",
				style: { marginBottom: "8px" }
			}, [(0, react.createElement)("div", {
				key: "h",
				style: {
					...MUTED,
					marginBottom: "4px"
				}
			}, "检查发现的问题"), (0, react.createElement)("ol", {
				key: "l",
				style: {
					margin: "0",
					paddingLeft: "20px",
					fontSize: "13px",
					lineHeight: "1.7"
				}
			}, entry.problems.map((item, index) => (0, react.createElement)("li", { key: index }, item)))]));
			if (entry.notes.length > 0) rows.push((0, react.createElement)("div", {
				key: "n",
				style: {
					...MUTED,
					marginBottom: "8px"
				}
			}, "处理结果 " + entry.notes.join("；")));
			if (entry.missing.length > 0) rows.push((0, react.createElement)("div", {
				key: "m",
				style: {
					marginBottom: "8px",
					color: "#b42318",
					fontSize: "13px"
				}
			}, "驳回原因，改写后少了 " + entry.missing.join("、") + "，整段作废用原文"));
			rows.push((0, react.createElement)("div", {
				key: "x",
				style: {
					display: "flex",
					gap: "10px"
				}
			}, [textBlock("原版", entry.original, "#fafafa"), textBlock(entry.rewritten ? "改写后" : "改写后（无，未产生可用的改写）", entry.rewritten, "#f4f8ff")]));
			return (0, react.createElement)("div", {
				key: "d",
				style: { marginTop: "10px" }
			}, rows);
		}
		function recordCard(entry, index) {
			const time = entry.ts ? new Date(entry.ts).toLocaleString("zh-CN") : "";
			const head = (0, react.createElement)("div", {
				key: "h",
				style: {
					display: "flex",
					alignItems: "center",
					flexWrap: "wrap",
					gap: "6px"
				}
			}, [
				statusOf(entry),
				(0, react.createElement)("span", {
					key: "t",
					style: MUTED
				}, time),
				(0, react.createElement)("span", {
					key: "c",
					style: MUTED
				}, entry.chars + " 字"),
				(0, react.createElement)("span", {
					key: "m",
					style: MUTED
				}, (entry.ms / 1e3).toFixed(1) + " 秒"),
				(0, react.createElement)("span", {
					key: "r",
					style: MUTED
				}, entry.roundsRun + " 轮改写")
			]);
			return (0, react.createElement)("details", {
				key: entry.ts + "-" + index,
				style: CARD
			}, [(0, react.createElement)("summary", {
				key: "s",
				style: { cursor: "pointer" }
			}, head), detail(entry)]);
		}
		function Panel() {
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)("");
			const [records, setRecords] = (0, react.useState)([]);
			const [tick, setTick] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				let alive = true;
				setLoading(true);
				fetch(API).then((response) => response.json()).then((data) => {
					if (!alive) return;
					setRecords(Array.isArray(data.records) ? data.records : []);
					setError("");
					setLoading(false);
				}).catch((cause) => {
					if (!alive) return;
					setError(String(cause));
					setLoading(false);
				});
				return () => {
					alive = false;
				};
			}, [tick]);
			const adopted = records.filter((entry) => entry.applied).length;
			const rejected = records.filter((entry) => !entry.applied && entry.missing.length > 0).length;
			return (0, react.createElement)("div", { style: {
				padding: "12px",
				fontFamily: "system-ui, sans-serif",
				fontSize: "13px"
			} }, [
				(0, react.createElement)("div", {
					key: "head",
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: "10px"
					}
				}, [(0, react.createElement)("div", {
					key: "title",
					style: { fontWeight: 600 }
				}, "回复风格检查"), (0, react.createElement)("button", {
					key: "refresh",
					onClick: () => setTick((value) => value + 1),
					style: {
						cursor: "pointer",
						padding: "3px 10px",
						borderRadius: "6px",
						border: "1px solid #d0d5dd",
						background: "#fff"
					}
				}, "刷新")]),
				(0, react.createElement)("div", {
					key: "stat",
					style: {
						...MUTED,
						marginBottom: "10px"
					}
				}, "最近 " + records.length + " 次，采纳 " + adopted + "，驳回 " + rejected),
				error ? (0, react.createElement)("div", {
					key: "err",
					style: { color: "#b42318" }
				}, "读取失败 " + error) : null,
				loading ? (0, react.createElement)("div", {
					key: "load",
					style: MUTED
				}, "读取中…") : null,
				records.length === 0 && !loading ? (0, react.createElement)("div", {
					key: "empty",
					style: MUTED
				}, "还没有记录。") : null,
				(0, react.createElement)("div", { key: "list" }, records.map(recordCard))
			]);
		}
		function apply(ctx) {
			try {
				ctx.inject(["sidebarRightTabs"], (raw) => {
					const tabs = raw.sidebarRightTabs;
					if (!tabs || typeof tabs.register !== "function") return;
					const disposers = [];
					const own = (result) => {
						if (typeof result === "function") disposers.push(result);
					};
					try {
						own(tabs.register({
							id: TAB_ID,
							kind: TAB_KIND,
							title: () => "风格检查",
							guide: [{
								order: 30,
								title: () => "风格检查",
								description: () => "看每次回复被检查、改写与采纳的记录"
							}]
						}));
						own(ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
							name: "sidebar.right.pane.tab",
							key: TAB_ID
						}, () => (0, react.createElement)(Panel))));
					} catch {
						for (const dispose of disposers) dispose();
						return;
					}
					return () => {
						for (const dispose of disposers) dispose();
					};
				});
			} catch {}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map