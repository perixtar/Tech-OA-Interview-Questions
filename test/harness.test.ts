import { describe, expect, test } from "bun:test";
import {
  buildTestProgram,
  caseArgs,
  casesFromProblem,
  harnessSupport,
  parseHarnessOutput,
  parseSignature,
  parseType,
  parseValue,
  starterCode,
  valuesEqual,
} from "../public/js/harness.js";

const coinChange = {
  signature: "coinChange(coins: int[], amount: int) → int",
  examples: [
    { inputRaw: "coins = [2,5,10]\namount = 27", expectedRaw: "4" },
    { inputRaw: "coins = [1,3,4]\namount = 6", expectedRaw: "2" },
  ],
};

describe("signatures and types", () => {
  test("parses params and return types, including generics", () => {
    const sig = parseSignature({ signature: "group(records: String[][], k: long) → List<List<String>>" })!;
    expect(sig.name).toBe("group");
    expect(sig.params.map(p => p.name)).toEqual(["records", "k"]);
    expect(sig.params[0].ast).toEqual({ kind: "list", array: true, of: { kind: "list", array: true, of: { kind: "string" } } });
    expect(sig.retAst).toEqual({ kind: "list", array: false, of: { kind: "list", array: false, of: { kind: "string" } } });
  });

  test("treats the extractor placeholder as no signature", () => {
    expect(parseSignature({ signature: "solve() -> any" })).toBeNull();
    expect(parseSignature({ hasSignature: false, signature: "f(a: int) → int" })).toBeNull();
  });

  test("typed languages need known types", () => {
    const sig = parseSignature({ signature: "f(node: TreeNode) → int" })!;
    expect(parseType("TreeNode").kind).toBe("unknown");
    expect(harnessSupport("python", sig)).toBe(true);
    expect(harnessSupport("cpp", sig)).toBe(false);
    expect(harnessSupport("java", sig)).toBe(false);
  });
});

describe("values", () => {
  test("parses JSON and Python-style literals", () => {
    expect(parseValue("[[1,2],[3]]")).toEqual([[1, 2], [3]]);
    expect(parseValue("['a', \"b\"]")).toEqual(["a", "b"]);
    expect(parseValue("(True, None, -1.5e2)")).toEqual([true, null, -150]);
    expect(parseValue("{a: 1, 'b': [2]}")).toEqual({ a: 1, b: [2] });
    expect(parseValue("9223372036854775807")).toBe(9223372036854775807n);
    expect(() => parseValue("[1, 2")).toThrow();
  });

  test("compares with float tolerance and BigInt awareness", () => {
    expect(valuesEqual([6.0, 0.5], [6, 0.5000000001])).toBe(true);
    expect(valuesEqual(9223372036854775807n, 9223372036854775807n)).toBe(true);
    expect(valuesEqual(3n, 3)).toBe(true);
    expect(valuesEqual(["a"], ["b"])).toBe(false);
    expect(valuesEqual("4", 4)).toBe(false);
  });
});

describe("cases", () => {
  test("maps example assignments onto parameters", () => {
    const sig = parseSignature(coinChange)!;
    const cases = casesFromProblem(coinChange, sig);
    expect(cases).toEqual([
      { values: { coins: "[2,5,10]", amount: "27" }, expected: "4" },
      { values: { coins: "[1,3,4]", amount: "6" }, expected: "2" },
    ]);
    expect(caseArgs(cases[0], sig)).toEqual([[2, 5, 10], 27]);
  });
});

describe("starter code", () => {
  const sig = parseSignature(coinChange)!;
  test("generates idiomatic stubs for each language", () => {
    expect(starterCode("python", sig)).toContain("def coinChange(self, coins: List[int], amount: int) -> int:");
    expect(starterCode("javascript", sig)).toContain("function coinChange(coins, amount)");
    expect(starterCode("java", sig)).toContain("public int coinChange(int[] coins, int amount)");
    expect(starterCode("cpp", sig)).toContain("int coinChange(vector<int>& coins, int amount)");
  });
});

describe("generated programs", () => {
  const sig = parseSignature(coinChange)!;
  const args = [[[2, 5, 10], 27]];

  test("C++ declares typed literals and calls Solution", () => {
    const src = buildTestProgram("cpp", "class Solution { public: int coinChange(vector<int>& c, int a) { return 0; } };", sig, args);
    expect(src).toContain("vector<int> oa_a0 = vector<int>{2, 5, 10};");
    expect(src).toContain("int oa_a1 = 27;");
    expect(src).toContain("auto oa_r = oa_s.coinChange(oa_a0, oa_a1);");
  });

  test("Java hoists imports, strips public and builds arrays", () => {
    const code = "import java.util.HashMap;\npublic class Solution { public int coinChange(int[] c, int a) { return 0; } }";
    const src = buildTestProgram("java", code, sig, args);
    expect(src.indexOf("import java.util.HashMap;")).toBeLessThan(src.indexOf("class OAHarness"));
    expect(src).not.toContain("public class Solution");
    expect(src).toContain("int[] oa_a0 = new int[]{2, 5, 10};");
  });

  test("Java uses oaList for List types and L suffix for longs", () => {
    const s = parseSignature({ signature: "f(xs: List<Long>, names: List<List<String>>) → long" })!;
    const src = buildTestProgram("java", "class Solution {}", s, [[[1, 2], [["a"], []]]]);
    expect(src).toContain("List<Long> oa_a0 = oaList(1L, 2L);");
    expect(src).toContain('List<List<String>> oa_a1 = oaList(oaList("a"), oaList());');
  });

  test("rejects inputs that don't match the declared type", () => {
    expect(() => buildTestProgram("cpp", "", sig, [[["x"], 1]])).toThrow(/coins: expected an integer/);
  });

  test("JavaScript harness runs end to end", () => {
    const code = "function coinChange(coins, amount) { console.log('dbg'); return coins.length + amount; }";
    const src = buildTestProgram("javascript", code, sig, [[[2, 5, 10], 27], [[1], 1]]);
    let out = "";
    const print = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
    new Function("console", src)({ log: print });
    const res = parseHarnessOutput(out, 2);
    expect(res.cases.map(c => c.status)).toEqual(["ok", "ok"]);
    expect(res.cases.map(c => c.value)).toEqual([30, 2]);
    expect(res.cases[0].stdout).toBe("dbg");
  });

  test("JavaScript harness reports per-case errors and class-style solutions", () => {
    const code = "class Solution { coinChange(c, a) { if (a < 0) throw new Error('neg'); return a; } }";
    const src = buildTestProgram("javascript", code, sig, [[[1], 5], [[1], -1]]);
    let out = "";
    new Function("console", src)({ log: (s: string) => { out += s + "\n"; } });
    const res = parseHarnessOutput(out, 2);
    expect(res.cases[0]).toMatchObject({ status: "ok", value: 5 });
    expect(res.cases[1]).toMatchObject({ status: "error", error: "Error: neg" });
  });

  test("output parser marks cases that never finished as crashed", () => {
    const res = parseHarnessOutput("\n@@OA@@ BEGIN 0\npartial", 2);
    expect(res.cases[0]).toMatchObject({ status: "crashed", stdout: "partial" });
    expect(res.cases[1].status).toBe("skipped");
  });
});
