import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  approvalProblem,
  approvedMarkdown,
  buildPrompt,
  checkDraft,
  cleanTitle,
  parseReply,
  reviewMarkdown,
} from "./draft_croak.ts";

const pick = {
  builder: "ben",
  storyType: "feed" as const,
  lead: { name: "@ben/store", description: "A store toolkit", repository: null },
  post: {
    title: "Testing Scenes",
    url: "https://example.com/post",
    summary: "Measured checks",
    body: "Twelve families of checks from a 640-frame film.",
  },
};

Deno.test("the prompt carries the naming and no-endorsement rules", () => {
  const prompt = buildPrompt(pick);
  assertStringIncludes(prompt, 'Never write "SWAMP"');
  assertStringIncludes(prompt, "Do not say or suggest that Swamp endorses");
  assertStringIncludes(prompt, "https://example.com/post");
});

Deno.test("parseReply reads JSON wrapped in other text", () => {
  const reply = parseReply('Here you go: {"draft": "Hello", "imageCaption": "Cap", "notes": ["check"]}');
  assertEquals(reply.draft, "Hello");
  assertEquals(reply.notes, ["check"]);
});

Deno.test("parseReply reports invalid JSON instead of failing", () => {
  const reply = parseReply("no json here");
  assertEquals(reply.draft, null);
  assertStringIncludes(reply.notes[0], "not valid JSON");
});

Deno.test("the post prompt uses full text and leaves out the unrelated extension", () => {
  const prompt = buildPrompt(pick);
  assertStringIncludes(prompt, "Twelve families of checks");
  assertEquals(prompt.includes("@ben/store"), false);
});

Deno.test("checkDraft accepts a clean draft", () => {
  const problems = checkDraft(
    "Ada wrote about twelve checks. Read it at https://example.com/post",
    "Twelve checks in the post",
    "https://example.com/post",
  );
  assertEquals(problems, []);
});

Deno.test("a URL with lowercase swamp is not a lowercase swamp problem", () => {
  const problems = checkDraft(
    "Ada built it. Read https://github.com/ada/swamp-tool",
    "Ada built it",
    "https://github.com/ada/swamp-tool",
  );
  assertEquals(problems, []);
});

Deno.test("checkDraft flags an invented number, link and lowercase swamp", () => {
  const problems = checkDraft(
    "Ada tested 30 scenes on swamp. See https://other.example.com",
    "Twelve checks in the post",
    "https://example.com/post",
  );
  assertEquals(problems.length, 3);
});

const item = (over: Record<string, unknown> = {}) => ({
  builder: "ada",
  title: "Ada on checks",
  storyType: "feed",
  status: "waiting for approval",
  sourceUrl: "https://example.com/post",
  draft: "Ada wrote about twelve checks.\n\nhttps://example.com/post",
  imageCaption: "Twelve checks",
  notes: ["Check the title"],
  sourceText: "Ada wrote about twelve checks",
  approvedAt: null,
  inputTokens: 0,
  outputTokens: 0,
  ...over,
});

Deno.test("a waiting draft that passes its checks can be approved", () => {
  assertEquals(approvalProblem(item(), undefined), null);
});

Deno.test("an unknown builder, a finished draft and a failing edit are refused", () => {
  assertStringIncludes(approvalProblem(undefined, undefined)!, "no draft");
  assertStringIncludes(approvalProblem(item({ status: "approved" }), undefined)!, "already approved");
  assertStringIncludes(
    approvalProblem(item(), "Ada tested 30 scenes. https://example.com/post")!,
    "not in the source",
  );
});

Deno.test("the review file puts each draft beside its source and the commands", () => {
  const review = reviewMarkdown([item() as never], "2026-11-05");
  assertStringIncludes(review, "# Drafts for review, 2026-11-05");
  assertStringIncludes(review, "> Ada wrote about twelve checks");
  assertStringIncludes(review, "swamp behavior run drafter approve --input builder=ada --input builderAgreed=true");
});

Deno.test("the approved file records that the builder agreed", () => {
  const file = approvedMarkdown(item({ approvedAt: "2026-11-05T10:00:00.000Z" }) as never);
  assertStringIncludes(file, "The builder agreed to be featured.");
  assertStringIncludes(file, "https://example.com/post");
});

Deno.test("digits inside the source link are not checked as numbers", () => {
  const problems = checkDraft(
    "Ada built it.\n\nhttps://swamp-club.com/feed/p/8bf3b9da-054e",
    "Ada built it",
    "https://swamp-club.com/feed/p/8bf3b9da-054e",
  );
  assertEquals(problems, []);
});

Deno.test("cleanTitle removes the label, site name and emoji", () => {
  assertEquals(
    cleanTitle("Replacing the newsroom with one workflow | 💻Gerard Klijs🦀"),
    "Replacing the newsroom with one workflow",
  );
  assertEquals(cleanTitle("Showcase: My first build"), "My first build");
  assertEquals(cleanTitle("Setting up Swamp · reset.dev"), "Setting up Swamp");
});
