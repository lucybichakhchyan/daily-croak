/**
 * Writes one short draft per picked builder with Claude Haiku, or builds the
 * prompts only in dry-run mode. Drafts are saved for a person to approve.
 * Nothing is posted.
 *
 * @module
 */
import { z } from "npm:zod@4";

const MODEL = "claude-haiku-5-5";

const GlobalArgsSchema = z.object({
  model: z.string().default(MODEL),
});

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const DraftSchema = z.object({
  builder: z.string(),
  title: z.string().default(""),
  storyType: z.string(),
  status: z.string(),
  sourceUrl: z.string(),
  draft: z.string().nullable(),
  imageCaption: z.string().nullable(),
  notes: z.array(z.string()),
  sourceText: z.string().default(""),
  approvedAt: z.string().nullable().default(null),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

type DraftItem = z.infer<typeof DraftSchema>;

const DraftsSchema = z.object({
  draftedAt: z.string(),
  model: z.string(),
  dryRun: z.boolean(),
  items: z.array(DraftSchema),
});

type DraftsData = z.infer<typeof DraftsSchema>;

type Pick = {
  builder: string;
  storyType: "feed" | "registry";
  lead?: { name: string; description: string; repository: string | null };
  post?: { title: string; url: string; summary: string; body?: string };
};

const RULES = [
  'Write "Swamp" and "Swamp Club". Never write "SWAMP" or "swamp club".',
  'Write lowercase "swamp" nowhere in the draft, because it is reserved for the command-line tool.',
  "Use only facts that appear in the source text. Do not add numbers, dates, names, customers or claims.",
  "Do not say or suggest that Swamp endorses or is involved in this work.",
  'Do not write any link and do not mention a "source link". The link is added after your text.',
  "Name the builder and describe their work as the hero of the story.",
  "Keep the draft under 60 words, in plain sentences, with no emoji and no hype.",
  "If the source is too thin for a real story, say so in notes and keep the draft short.",
];

/** Builds the instructions and the source text for one pick. */
export function buildPrompt(pick: Pick): string {
  const text = pick.post?.body || pick.post?.summary || "";
  const source = pick.post
    ? `Post by ${pick.builder}: "${pick.post.title}"\nSource link: ${pick.post.url}\nFull text: ${text}`
    : "";
  const extension = pick.lead && pick.storyType === "registry"
    ? `Extension ${pick.lead.name}: ${pick.lead.description}${
      pick.lead.repository ? `\nSource link: ${pick.lead.repository}` : ""
    }`
    : "";
  return [
    "You write short posts for the Swamp community marketing desk.",
    "Rules:",
    ...RULES.map((rule) => `- ${rule}`),
    "",
    "Source material:",
    [source, extension].filter(Boolean).join("\n\n"),
    "",
    'Reply with JSON only: {"draft": "...", "imageCaption": "a 10 to 15 word caption", "notes": ["anything a reviewer should check"]}',
  ].join("\n");
}

/** Checks a draft against its source and returns each problem found. */
export function checkDraft(
  draft: string,
  source: string,
  allowedUrl: string,
): string[] {
  const problems: string[] = [];
  const sourceText = source.toLowerCase();
  const prose = draft.replace(/https?:\/\/[^\s)]+/g, " ");
  for (const number of prose.match(/\d+(?:[.,]\d+)?/g) ?? []) {
    if (!sourceText.includes(number)) {
      problems.push(`The number ${number} is not in the source.`);
    }
  }
  for (const url of draft.match(/https?:\/\/[^\s)]+/g) ?? []) {
    if (url.replace(/[.,;]$/, "") !== allowedUrl) {
      problems.push(`The link ${url} is not the source link.`);
    }
  }
  if (/\bswamp\b/.test(prose)) {
    problems.push('The draft uses lowercase "swamp" in prose.');
  }
  if (/\bSWAMP\b|swamp club/.test(prose)) {
    problems.push('The draft uses a banned spelling of Swamp.');
  }
  return problems;
}

/** Removes site names, emoji and the Showcase label from a post title. */
export function cleanTitle(title: string): string {
  return title
    .replace(/^Showcase:\s*/i, "")
    .split(/\s[|·]\s/)[0]
    .replace(/\p{Extended_Pictographic}/gu, "")
    .trim();
}

async function saveImageData(path: string, item: DraftItem) {
  const { sourceText: _sourceText, ...data } = item;
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
}

const WAITING = ["waiting for approval", "failed checks"];

/** Says why a draft cannot be approved, or null when it can. */
export function approvalProblem(
  item: DraftItem | undefined,
  text: string | undefined,
): string | null {
  if (!item) return "There is no draft for that builder.";
  if (!WAITING.includes(item.status)) {
    return `This draft is already ${item.status}.`;
  }
  const final = text ?? item.draft;
  if (!final) return "This draft has no text to approve.";
  const problems = checkDraft(final, item.sourceText, item.sourceUrl);
  return problems.length
    ? `The draft fails its checks: ${problems.join(" ")} Edit it with text=... and try again.`
    : null;
}

/** Builds the readable file where each draft sits beside its source. */
export function reviewMarkdown(items: DraftItem[], date: string): string {
  const sections = items.map((item, index) => [
    `## ${index + 1}. ${item.builder} (${item.storyType}): ${item.status}`,
    "",
    `Source: ${item.sourceUrl}`,
    "",
    "### Draft",
    "",
    item.draft ?? "No draft was written.",
    "",
    "### Image caption",
    "",
    item.imageCaption ?? "None",
    "",
    "### What to check",
    "",
    ...(item.notes.length ? item.notes.map((note) => `- ${note}`) : ["- Nothing was flagged."]),
    "",
    "### Source text",
    "",
    ...item.sourceText.slice(0, 2500).split("\n").map((line) => `> ${line}`),
    "",
    "To approve, after the builder agrees:",
    "",
    "```",
    `swamp behavior run drafter approve --input builder=${item.builder} --input builderAgreed=true`,
    "```",
    "",
    "To reject:",
    "",
    "```",
    `swamp behavior run drafter reject --input builder=${item.builder} --input reason="why"`,
    "```",
    "",
  ].join("\n"));
  return [
    `# Drafts for review, ${date}`,
    "",
    "Nothing is posted. Read each draft against its source text, ask the builder, then approve or reject it. Run the commands from the daily-croak folder.",
    "",
    ...sections,
  ].join("\n");
}

/** Builds the file saved for an approved draft. */
export function approvedMarkdown(item: DraftItem): string {
  return [
    `# ${item.builder}`,
    "",
    `Approved: ${item.approvedAt}`,
    "The builder agreed to be featured.",
    "",
    "## Post",
    "",
    item.draft ?? "",
    "",
    "## Image caption",
    "",
    item.imageCaption ?? "",
    "",
  ].join("\n");
}

/** Reads Claude's JSON reply, or returns nulls if it is not valid. */
export function parseReply(
  text: string,
): { draft: string | null; imageCaption: string | null; notes: string[] } {
  try {
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return {
      draft: typeof json.draft === "string" ? json.draft : null,
      imageCaption: typeof json.imageCaption === "string" ? json.imageCaption : null,
      notes: Array.isArray(json.notes) ? json.notes.map(String) : [],
    };
  } catch {
    return {
      draft: null,
      imageCaption: null,
      notes: [`Claude's reply was not valid JSON: ${text.slice(0, 200)}`],
    };
  }
}

async function callClaude(
  model: string,
  prompt: string,
  apiKey: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const key = apiKey;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
  const body = await response.json();
  const blocks = body.content as Array<{ type: string; text?: string }>;
  return {
    text: blocks.filter((part) => part.type === "text").map((part) => part.text ?? "").join(""),
    inputTokens: body.usage.input_tokens,
    outputTokens: body.usage.output_tokens,
  };
}

/** Behavior that writes drafts for the picks from the scout behavior. */
export const behavior = {
  type: "@thedarkpriestess/croak-drafter",
  version: "2026.11.05.5",
  globalArguments: GlobalArgsSchema,
  resources: {
    "drafts": {
      description: "Drafts waiting for a person to approve",
      schema: DraftsSchema,
      lifetime: "infinite",
      garbageCollection: 30,
    },
  },
  methods: {
    draft: {
      description: "Write one draft per pick, or build prompts in dry-run mode",
      arguments: z.object({
        count: z.number().int().positive().default(3),
        dryRun: z.boolean().default(true),
        apiKey: z.string().optional(),
      }),
      execute: async (
        args: { count: number; dryRun: boolean; apiKey?: string },
        context: {
          globalArgs: GlobalArgs;
          readModelData?: (model: string, data: string) => Promise<unknown>;
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
        },
      ) => {
        const records = await context.readModelData!("scout", "picks") as
          Array<{ attributes: { picks?: Pick[] } }>;
        const picks = (records[0]?.attributes.picks ?? []).slice(0, args.count);
        const items = [];
        for (const pick of picks) {
          const prompt = buildPrompt(pick);
          const sourceUrl = pick.post?.url ?? pick.lead?.repository ?? "";
          if (args.dryRun) {
            items.push({
              builder: pick.builder,
              title: cleanTitle(pick.post?.title ?? pick.lead?.name ?? ""),
              storyType: pick.storyType,
              status: "dry run, no draft written",
              sourceUrl,
              draft: null,
              imageCaption: null,
              notes: [`Prompt is ${prompt.length} characters`],
              sourceText: "",
              approvedAt: null,
              inputTokens: 0,
              outputTokens: 0,
            });
            continue;
          }
          const key = args.apiKey ?? Deno.env.get("ANTHROPIC_API_KEY") ?? "";
          const reply = await callClaude(context.globalArgs.model, prompt, key);
          const parsed = parseReply(reply.text);
          const source = [
            pick.post?.title,
            pick.post?.body || pick.post?.summary,
            pick.lead?.description,
          ].filter(Boolean).join("\n");
          const problems = parsed.draft
            ? checkDraft(parsed.draft, source, sourceUrl)
            : [];
          if (parsed.imageCaption) {
            problems.push(
              ...checkDraft(parsed.imageCaption, source, sourceUrl)
                .map((problem) => `Image caption: ${problem}`),
            );
          }
          items.push({
            builder: pick.builder,
            title: cleanTitle(pick.post?.title ?? pick.lead?.name ?? ""),
            storyType: pick.storyType,
            status: problems.length ? "failed checks" : "waiting for approval",
            sourceUrl,
            ...parsed,
            draft: parsed.draft && sourceUrl
              ? `${parsed.draft}\n\n${sourceUrl}`
              : parsed.draft,
            notes: [...parsed.notes, ...problems],
            sourceText: source,
            approvedAt: null,
            inputTokens: reply.inputTokens,
            outputTokens: reply.outputTokens,
          });
        }
        const handle = await context.writeResource("drafts", "drafts", {
          draftedAt: new Date().toISOString(),
          model: context.globalArgs.model,
          dryRun: args.dryRun,
          items,
        });
        if (!args.dryRun) {
          const date = new Date().toISOString().slice(0, 10);
          await Deno.mkdir("review", { recursive: true });
          await Deno.writeTextFile(
            `review/${date}.md`,
            reviewMarkdown(items as DraftItem[], date),
          );
        }
        return { dataHandles: [handle] };
      },
    },
    approve: {
      description: "Approve one draft, after the builder agreed to be featured",
      arguments: z.object({
        builder: z.string(),
        builderAgreed: z.union([z.boolean(), z.string()]),
        text: z.string().optional(),
      }),
      execute: async (
        args: { builder: string; builderAgreed: boolean | string; text?: string },
        context: {
          readResource?: (name: string) => Promise<unknown>;
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
        },
      ) => {
        if (String(args.builderAgreed) !== "true") {
          throw new Error(
            "Approving needs builderAgreed=true, after the builder has said yes.",
          );
        }
        const saved = await context.readResource!("drafts") as DraftsData | null;
        if (!saved) throw new Error("There are no drafts yet.");
        const item = saved.items.find((entry) => entry.builder === args.builder);
        const problem = approvalProblem(item, args.text);
        if (problem) throw new Error(problem);
        const approvedAt = new Date().toISOString();
        const approved: DraftItem = {
          ...item!,
          draft: args.text ?? item!.draft,
          status: "approved",
          approvedAt,
        };
        const safeName = approved.builder.replace(/[^\w.-]/g, "-");
        await Deno.mkdir("approved", { recursive: true });
        await Deno.writeTextFile(
          `approved/${approvedAt.slice(0, 10)}-${safeName}.md`,
          approvedMarkdown(approved),
        );
        await saveImageData(
          `approved/${approvedAt.slice(0, 10)}-${safeName}.json`,
          approved,
        );
        const handle = await context.writeResource("drafts", "drafts", {
          ...saved,
          items: saved.items.map((entry) =>
            entry.builder === args.builder ? approved : entry
          ),
        });
        return { dataHandles: [handle] };
      },
    },
    reject: {
      description: "Reject one draft and record why",
      arguments: z.object({
        builder: z.string(),
        reason: z.string().min(1),
      }),
      execute: async (
        args: { builder: string; reason: string },
        context: {
          readResource?: (name: string) => Promise<unknown>;
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
        },
      ) => {
        const saved = await context.readResource!("drafts") as DraftsData | null;
        if (!saved) throw new Error("There are no drafts yet.");
        const item = saved.items.find((entry) => entry.builder === args.builder);
        if (!item) throw new Error("There is no draft for that builder.");
        if (!WAITING.includes(item.status)) {
          throw new Error(`This draft is already ${item.status}.`);
        }
        const handle = await context.writeResource("drafts", "drafts", {
          ...saved,
          items: saved.items.map((entry) =>
            entry.builder === args.builder
              ? {
                ...entry,
                status: "rejected",
                notes: [...entry.notes, `Rejected: ${args.reason}`],
              }
              : entry
          ),
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
