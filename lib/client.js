window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-style-guard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/textdiff.ts
		/**
		* 逐句比对用的纯函数。宿主构建会把它编译进 lib，客户端打包时也会打进面板那一份，
		* 两边用的是同一份代码，测试也只测这一份。
		*/
		/** 按句号一类断句，断开的位置保留在句子里。 */
		function splitSentences(text) {
			return text.split(/(?<=[。！？；!?;\n])/).filter((part) => part.trim().length > 0);
		}
		/** 一个句子里的相邻两字组合，用来比相似度。 */
		function bigrams(text) {
			const cleaned = text.replace(/\s+/g, "");
			const out = /* @__PURE__ */ new Set();
			for (let index = 0; index + 2 <= cleaned.length; index++) out.add(cleaned.slice(index, index + 2));
			return out;
		}
		/** 两个句子的相似度，取共同的相邻两字组合占多数的比例。 */
		function overlap(left, right) {
			const a = bigrams(left);
			const b = bigrams(right);
			if (a.size === 0 || b.size === 0) return 0;
			let hit = 0;
			for (const gram of a) if (b.has(gram)) hit++;
			return hit / Math.max(a.size, b.size);
		}
		/**
		* 改写版里哪些句子在原文里找不到对应。
		* 找得到对应的意思是在原文里有一句和它足够像；像不到就说明这句是新写的或者改动很大。
		*/
		function riskySentences(original, rewritten, threshold = .34) {
			const source = splitSentences(original);
			const risky = [];
			splitSentences(rewritten).forEach((sentence, index) => {
				let best = 0;
				for (const other of source) best = Math.max(best, overlap(sentence, other));
				if (best < threshold) risky.push(index);
			});
			return risky;
		}
		//#endregion
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
		/** 把正文里指定的词标出来，用在原文那一栏，指出改写版把哪些词丢了。 */
		function withHighlights(text, tokens) {
			const usable = tokens.filter((token) => token.length > 0);
			if (usable.length === 0) return [(0, react.createElement)("span", { key: "plain" }, text)];
			const escaped = usable.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
			let parts;
			try {
				parts = text.split(new RegExp("(" + escaped.join("|") + ")", "g"));
			} catch {
				return [(0, react.createElement)("span", { key: "plain" }, text)];
			}
			return parts.map((part, index) => usable.includes(part) ? (0, react.createElement)("mark", {
				key: index,
				style: {
					background: "#ffe0e0",
					color: "#b42318",
					padding: "0 2px",
					borderRadius: "3px"
				}
			}, part) : (0, react.createElement)("span", { key: index }, part));
		}
		/** 改写后的正文，把和原文对不上的句子底色标出来。 */
		function withRiskyMarks(text, risky) {
			return splitSentences(text).map((sentence, index) => risky.includes(index) ? (0, react.createElement)("span", {
				key: index,
				title: "这句在原文里找不到对应，可能是新写的或改动很大，请对照原文",
				style: {
					background: "#fff1c2",
					borderRadius: "3px",
					padding: "0 1px"
				}
			}, sentence) : (0, react.createElement)("span", { key: index }, sentence));
		}
		function textBlock(title, children, tint) {
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
			}, children)]);
		}
		function plain(text) {
			return [(0, react.createElement)("span", { key: "plain" }, text || "（空）")];
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
			const rejectedOnly = entry.rewritten.length === 0 && entry.rejectedText.length > 0;
			const shown = entry.rewritten.length > 0 ? entry.rewritten : entry.rejectedText;
			if (entry.critiqueRaw) rows.push((0, react.createElement)("div", {
				key: "raw",
				style: {
					marginBottom: "8px",
					padding: "8px 10px",
					borderRadius: "6px",
					background: "#f5f6f8",
					fontSize: "12px",
					lineHeight: "1.6"
				}
			}, [(0, react.createElement)("div", {
				key: "t",
				style: {
					...MUTED,
					marginBottom: "4px"
				}
			}, "检查那一步返回的内容读不出来，它的开头是"), (0, react.createElement)("pre", {
				key: "b",
				style: {
					margin: "0",
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					maxHeight: "160px",
					overflow: "auto"
				}
			}, entry.critiqueRaw)]));
			if (!shown && entry.problems.length > 0) rows.push((0, react.createElement)("div", {
				key: "why",
				style: {
					marginBottom: "8px",
					padding: "8px 10px",
					borderRadius: "6px",
					background: "#f5f6f8",
					fontSize: "13px",
					lineHeight: "1.7"
				}
			}, "检查列出了上面的问题，但没有可用的改写版本，页面上用的还是原文。原因见下面的处理结果。"));
			if (entry.missing.length > 0) rows.push((0, react.createElement)("div", {
				key: "m",
				style: {
					marginBottom: "8px",
					color: "#b42318",
					fontSize: "13px",
					lineHeight: "1.7"
				}
			}, "这一版把原文里的数字改掉或者弄丢了，因此没有采用：" + entry.missing.join("、") + "。数字一般是你手上的结果和门槛，对不上就不能照它用。"));
			if (entry.softMissing.length > 0) rows.push((0, react.createElement)("div", {
				key: "sm",
				style: {
					marginBottom: "8px",
					color: "#8a6d00",
					fontSize: "13px",
					lineHeight: "1.7"
				}
			}, "这一版已经采用，只是原文里的这些名字没保留：" + entry.softMissing.join("、") + "。路径、文件名和代码里的代号都算这一类，不影响你读，需要照着改文件时看原文那一栏。"));
			if (rejectedOnly) rows.push((0, react.createElement)("div", {
				key: "w",
				style: {
					marginBottom: "8px",
					padding: "8px 10px",
					borderRadius: "6px",
					background: "#fff8e1",
					border: "1px solid #ffe0a3",
					fontSize: "13px",
					lineHeight: "1.7"
				}
			}, "这一版改写没有采用，页面上用的还是原文。下面把它整段列出来，原文里对应的词标了红色，改写版里底色发黄的句子在原文里找不到对应，看的时候要对着原文核一遍。"));
			rows.push((0, react.createElement)("div", {
				key: "x",
				style: {
					display: "flex",
					gap: "10px"
				}
			}, [textBlock(entry.missing.length > 0 ? "原版（红色是改写版丢掉的词）" : "原版", entry.missing.length > 0 ? withHighlights(entry.original, entry.missing) : plain(entry.original), "#fafafa"), textBlock(rejectedOnly ? "改写后（没有采用，黄底句子请对照原文）" : shown ? "改写后" : "改写后（无，没有产生可用的改写）", rejectedOnly ? withRiskyMarks(shown, riskySentences(entry.original, shown)) : plain(shown), rejectedOnly ? "#fffdf5" : "#f4f8ff")]));
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
		function Panel(props) {
			const sessionId = props.sessionId;
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)("");
			const [records, setRecords] = (0, react.useState)([]);
			const [tick, setTick] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				let alive = true;
				const url = sessionId ? "/dsh-style-guard/api/records?limit=50&session=" + encodeURIComponent(sessionId) : API;
				const load = (showSpinner) => {
					if (showSpinner) setLoading(true);
					fetch(url).then((response) => response.json()).then((data) => {
						if (!alive) return;
						setRecords(Array.isArray(data.records) ? data.records : []);
						setError("");
						setLoading(false);
					}).catch((cause) => {
						if (!alive) return;
						setError(String(cause));
						setLoading(false);
					});
				};
				load(true);
				const timer = setInterval(() => {
					if (document.visibilityState === "visible") load(false);
				}, 5e3);
				const onWake = () => {
					if (document.visibilityState === "visible") load(false);
				};
				window.addEventListener("focus", onWake);
				document.addEventListener("visibilitychange", onWake);
				return () => {
					alive = false;
					clearInterval(timer);
					window.removeEventListener("focus", onWake);
					document.removeEventListener("visibilitychange", onWake);
				};
			}, [tick, sessionId]);
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
				}, (sessionId ? "本会话 " : "未取到会话编号，显示全部会话的 ") + records.length + " 次，采纳 " + adopted + "，驳回 " + rejected + "，每 5 秒自动刷新"),
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
						}, (props) => (0, react.createElement)(Panel, { sessionId: typeof props.sessionId === "string" ? props.sessionId : void 0 }))));
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