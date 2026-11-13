// Run on each revision: bun packages/resource-renderers/src/renderers/json/bench-json-scanner.ts [count]
import { createHash } from "node:crypto";
import { scanJson } from "./jsonScanner";

const count = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(count) || count < 1) throw new Error("count must be a positive integer");
const siblings = Array.from(
	{ length: count },
	(_, index) => `${JSON.stringify(`key${index}`)}:{"child":[1,2,3]}`,
);
const replacements = Array.from({ length: count }, (_, index) => `"replace":{"value":${index}}`);
const input = `{\n${[...siblings, ...replacements].join(",\n")}\n}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const expected = JSON.stringify(JSON.parse(input));
const read = () => {
	const document = scanJson(input);
	if (!document) throw new Error("Expected valid JSON fixture");
	return document;
};
read();
const samplesMs: number[] = [];
for (let sample = 0; sample < 3; sample += 1) {
	const started = performance.now();
	read();
	samplesMs.push(performance.now() - started);
}
const document = read();
if (JSON.stringify(document.value) !== expected) throw new Error("Value differs from JSON.parse");
const result = {
	value: document.value,
	nodes: [...document.nodes].map(([pointer, node]) => [
		pointer,
		node.type,
		node.startLine,
		node.endLine,
	]),
	order: document.root.children.map((node) => node.key),
};
console.log(
	JSON.stringify(
		{
			count,
			chars: input.length,
			nodes: document.nodes.size,
			samplesMs,
			inputHash: hash(input),
			resultHash: hash(JSON.stringify(result)),
			maxRssKiB: process.resourceUsage().maxRSS,
		},
		null,
		2,
	),
);
