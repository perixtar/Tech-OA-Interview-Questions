import { describe, expect, test } from "bun:test";
import { buildBank, parseQuestionTable } from "../public/js/question-parser.js";
import { readLocalPages } from "../src/questions";
import { parseProblemHtml } from "../src/extractor";

const TABLE = `
# Title

| Company | OA / Interview Question | Format | Practice | Updated |
| :-- | :-- | :-- | :-: | :-- |
|**Microsoft**|[Coin Change](https://www.fastprep.io/problems/microsoft-coin-change)|Coding|[![Practice][p]](https://www.fastprep.io/problems/microsoft-coin-change)|🔥 Oct 30, 2026|
|**OnePay / Razorpay**|[Durable Chat](https://www.fastprep.io/system-design/durable-chat)|System design|[![Practice][p]](https://www.fastprep.io/system-design/durable-chat)|🆕 Sep 2, 2026|
|**Acme**|[A \\| B Split](https://www.fastprep.io/problems/acme-split)|Coding|[![Practice][p]](https://www.fastprep.io/problems/acme-split)|Jan 5, 2025|

<a id="bottom"></a>
`;

describe("question bank parser", () => {
  test("parses rows, companies, dates and freshness flags", () => {
    const rows = parseQuestionTable(TABLE);
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({
      id: "microsoft-coin-change",
      title: "Coin Change",
      companies: ["Microsoft"],
      format: "Coding",
      isoDate: "2026-10-30",
      isHot: true,
      isNew: false,
    });
    expect(rows[1].companies).toEqual(["OnePay", "Razorpay"]);
    expect(rows[1].isNew).toBe(true);
    expect(rows[2].title).toBe("A | B Split");
  });

  test("buildBank dedupes URLs across pages and counts formats", () => {
    const bank = buildBank([TABLE, TABLE]);
    expect(bank.metadata.total).toBe(3);
    expect(bank.metadata.formatCounts).toEqual({ Coding: 2, "System design": 1 });
    expect(bank.metadata.companies[0]).toEqual({ name: "Acme", count: 1 });
  });

  test("reads every page of the checked-out question bank", async () => {
    const bank = buildBank(await readLocalPages(process.cwd()));
    expect(bank.metadata.total).toBeGreaterThan(3000);
    expect(new Set(bank.questions.map(q => q.id)).size).toBe(bank.questions.length);
  });
});

describe("problem extractor", () => {
  test("parses title, signature with generics, examples and constraints", () => {
    const html = `
      <h1>Find Lowest Price</h1>
      <section class="fp-statement-section"><p>Use &lt;b&gt; tags &amp; more.</p></section>
      <code class="fp-function-signature">group(records: String[][], m: Map&lt;String, Integer&gt;) → List&lt;List&lt;String&gt;&gt;</code>
      <pre class="fp-example-code"><code>records = [["a"]]\nm = {}\nreturn = [["a"]]</code></pre>
      <section id="problem-constraints"><li>1 &lt;= n &lt;= 100</li></section>
    `;
    const parsed = parseProblemHtml("test-id", html);
    expect(parsed.title).toBe("Find Lowest Price");
    expect(parsed.hasSignature).toBe(true);
    expect(parsed.functionName).toBe("group");
    expect(parsed.parameters).toEqual([
      { name: "records", type: "String[][]" },
      { name: "m", type: "Map<String, Integer>" },
    ]);
    expect(parsed.returnType).toBe("List<List<String>>");
    expect(parsed.statementHtml).toContain("&lt;b&gt;");
    expect(parsed.examples[0].expectedRaw).toBe('[["a"]]');
    expect(parsed.constraints).toEqual(["1 <= n <= 100"]);
  });

  test("falls back to og:title and description for client-rendered pages", () => {
    const html = `
      <meta name="description" content="Design a workflow that turns device data into actions."/>
      <meta property="og:title" content="Device Automation Workflow — System Design Practice"/>
      <h1>Preparing your design workspace</h1>`;
    const parsed = parseProblemHtml("sd", html);
    expect(parsed.title).toBe("Device Automation Workflow");
    expect(parsed.hasSignature).toBe(false);
    expect(parsed.statementHtml).toBe("<p>Design a workflow that turns device data into actions.</p>");
  });
});
