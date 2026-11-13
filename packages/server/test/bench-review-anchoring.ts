// Run on each revision: bun packages/server/test/bench-review-anchoring.ts [repetitions]
import type { ReviewAnchor } from "@thinkrail/contracts";
import { buildTextQuote, hashContent, lineRangeOf, reanchor } from "../src/reviews/anchoring";

const repetitions = Number(process.argv[2] ?? 100_000);
if (!Number.isSafeInteger(repetitions) || repetitions < 2)
	throw new Error("repetitions must be an integer >= 2");
const block = "function repeat() {\n  return 1;\n}\n";
const repeated = block.repeat(repetitions);
const anchor: ReviewAnchor = {
	path: "generated.ts",
	side: "worktree",
	contentHash: hashContent(block),
	selectors: [{ kind: "lineRange", startLine: 2, endLine: 2 }, buildTextQuote(block, 2, 2)],
};
const workloads = [
	{ name: "ambiguous-context", content: repeated, anchor, state: "outdated", line: null },
	{
		name: "ambiguous-no-context",
		content: repeated,
		anchor: {
			...anchor,
			selectors: [
				{ kind: "lineRange" as const, startLine: 2, endLine: 2 },
				{ kind: "textQuote" as const, exact: "  return 1;", prefix: "", suffix: "" },
			],
		},
		state: "outdated",
		line: null,
	},
	{
		name: "unique-context-at-tail",
		content: `${repeated}unique before\n  return 1;\nunique after\n`,
		anchor: {
			...anchor,
			selectors: [
				{ kind: "lineRange" as const, startLine: 2, endLine: 2 },
				{
					kind: "textQuote" as const,
					exact: "  return 1;",
					prefix: "unique before\n",
					suffix: "\nunique after",
				},
			],
		},
		state: "moved",
		line: repetitions * 3 + 2,
	},
];
const results = workloads.map((workload) => {
	const expected = reanchor(workload.anchor, workload.content);
	if (
		expected.state !== workload.state ||
		(workload.line !== null && lineRangeOf(expected.anchor)?.startLine !== workload.line)
	) {
		throw new Error(`Unexpected result for ${workload.name}`);
	}
	for (let i = 0; i < 3; i++) reanchor(workload.anchor, workload.content);
	const samplesMs: number[] = [];
	for (let sample = 0; sample < 5; sample++) {
		const start = performance.now();
		for (let i = 0; i < 10; i++) reanchor(workload.anchor, workload.content);
		samplesMs.push(performance.now() - start);
	}
	const final = reanchor(workload.anchor, workload.content);
	if (JSON.stringify(final) !== JSON.stringify(expected))
		throw new Error("Result changed during measurement");
	return {
		name: workload.name,
		chars: workload.content.length,
		callsPerSample: 10,
		samplesMs,
		inputHash: hashContent(workload.content),
		resultHash: hashContent(JSON.stringify(final)),
	};
});
console.log(
	JSON.stringify({ repetitions, results, maxRssKiB: process.resourceUsage().maxRSS }, null, 2),
);
