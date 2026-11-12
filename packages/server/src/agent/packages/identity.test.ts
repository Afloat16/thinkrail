import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invalidatePiPackageCatalog, listPiPackageCatalog } from "./catalog";
import { packageSourceIdentity, repositoryRoot } from "./identity";
import { writeFixturePiPackage } from "./testFixtures";

let root: string;
let agentDir: string;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: join(root, "no-global-config"),
			GIT_CONFIG_SYSTEM: join(root, "no-system-config"),
		},
	});
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}

function repository(name: string): string {
	const path = join(root, name);
	git(root, "init", "-b", "main", path);
	git(
		path,
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--allow-empty",
		"-m",
		"initial",
	);
	return path;
}

function declarePackage(worktree: string): void {
	mkdirSync(join(worktree, ".pi"), { recursive: true });
	writeFixturePiPackage(join(worktree, "tools"));
	writeFileSync(join(worktree, ".pi", "settings.json"), JSON.stringify({ packages: ["../tools"] }));
}

async function enabled(worktree: string, disabledKey: string): Promise<boolean | undefined> {
	const catalog = await listPiPackageCatalog({
		cwd: worktree,
		agentDir,
		projectTrusted: true,
		builtinExtensions: [],
		disabledPackages: new Set([disabledKey]),
	});
	expect(catalog.packages).toHaveLength(1);
	return catalog.packages[0]?.enabled;
}

beforeEach(() => {
	root = realpathSync.native(mkdtempSync(join(tmpdir(), "package-gitfiles-")));
	agentDir = join(root, "agent");
	mkdirSync(agentDir);
	invalidatePiPackageCatalog();
});

afterEach(() => {
	invalidatePiPackageCatalog();
	rmSync(root, { recursive: true, force: true });
});

test("switching off a submodule package does not switch off a sibling submodule", async () => {
	const source = repository("source");
	const parent = repository("parent");
	const modules = ["one", "two"].map((name) => {
		git(parent, "-c", "protocol.file.allow=always", "submodule", "add", source, name);
		const path = join(parent, name);
		declarePackage(path);
		return path;
	});
	const first = modules[0] ?? "";
	const second = modules[1] ?? "";
	const key = packageSourceIdentity("../tools", "project", first, agentDir);
	expect(await enabled(first, key)).toBe(false);
	expect(await enabled(second, key)).toBe(true);
	expect(repositoryRoot(join(first, "tools"))).toBe(first);
	expect(repositoryRoot(join(second, "tools"))).toBe(second);
});

test("separate git directories sharing a parent keep independent package switches", async () => {
	const metadata = join(root, "external metadata");
	mkdirSync(metadata);
	const worktrees = ["one", "two"].map((name) => {
		const path = join(root, name);
		git(root, "init", "--separate-git-dir", join(metadata, name), path);
		declarePackage(path);
		return path;
	});
	const first = worktrees[0] ?? "";
	const second = worktrees[1] ?? "";
	const key = packageSourceIdentity("../tools", "project", first, agentDir);
	expect(await enabled(first, key)).toBe(false);
	expect(await enabled(second, key)).toBe(true);
	expect(repositoryRoot(first)).toBe(first);
	expect(repositoryRoot(second)).toBe(second);
});

test("ordinary linked worktrees still share their main checkout's package switch", async () => {
	const main = repository("main");
	const linked = join(root, "linked");
	git(main, "worktree", "add", "-b", "linked", linked);
	declarePackage(main);
	declarePackage(linked);
	const key = packageSourceIdentity("../tools", "project", main, agentDir);
	expect(await enabled(main, key)).toBe(false);
	expect(await enabled(linked, key)).toBe(false);
	expect(repositoryRoot(linked)).toBe(main);
});
