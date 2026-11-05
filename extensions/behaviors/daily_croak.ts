/**
 * Finds builders who recently wrote in the Swamp Club Feed and picks the
 * newest post from each. New registry extensions fill any spare places.
 * Both steps use public data only.
 *
 * @module
 */
import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({
  skip: z.array(z.string()).default(["swamp"]).describe(
    "Usernames and collectives to leave out, such as the Swamp team",
  ),
});

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const PostSchema = z.object({
  title: z.string(),
  url: z.string(),
  author: z.string(),
  publishedAt: z.string(),
  summary: z.string(),
  body: z.string().default(""),
});

type Post = z.infer<typeof PostSchema>;

const ExtensionSchema = z.object({
  name: z.string(),
  collective: z.string(),
  description: z.string(),
  repository: z.string().nullable(),
  createdAt: z.string(),
});

type Extension = z.infer<typeof ExtensionSchema>;

const CandidatesSchema = z.object({
  foundAt: z.string(),
  feedWithinDays: z.number(),
  registryWithinDays: z.number(),
  warnings: z.array(z.string()),
  posts: z.array(PostSchema),
  extensions: z.array(ExtensionSchema),
});

const PickSchema = z.object({
  builder: z.string(),
  storyType: z.enum(["feed", "registry"]),
  post: PostSchema.optional(),
  lead: ExtensionSchema.optional(),
});

type Pick = z.infer<typeof PickSchema>;

const PicksSchema = z.object({
  pickedAt: z.string(),
  picks: z.array(PickSchema),
});

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&rarr;": "→",
  "&middot;": "·",
  "&mdash;": "—",
  "&ndash;": "–",
  "&nbsp;": " ",
  "&hellip;": "…",
};

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(amp|lt|gt|quot|apos|#39|rarr|middot|mdash|ndash|nbsp|hellip);/g, (entity) => ENTITIES[entity])
    .trim();
}

function tag(item: string, name: string): string {
  const match = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decode(match[1]) : "";
}

/** Turns HTML into plain text, with the tags removed. */
export function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Uses the item's id as its link when it is a web address, else its own link. */
export function webAddress(id: string, link: string): string {
  return id.startsWith("http") ? id : link;
}

/** Reads the Swamp Club Feed's RSS items into posts. */
export function parseFeed(xml: string): Post[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((item) => ({
    title: tag(item, "title"),
    url: webAddress(tag(item, "guid"), tag(item, "link")),
    author: tag(item, "dc:creator"),
    publishedAt: new Date(tag(item, "pubDate")).toISOString(),
    summary: tag(item, "description"),
    body: plainText(tag(item, "content:encoded")).slice(0, 8000),
  }));
}

/** Drops anything whose name is on the skip list. */
export function withoutSkipped<T>(
  items: T[],
  skip: string[],
  nameOf: (item: T) => string,
): T[] {
  return items.filter((item) => !skip.includes(nameOf(item)));
}

/** Takes the newest post from each builder, then fills with new extensions. */
export function pickBuilders(
  posts: Post[],
  extensions: Extension[],
  limit: number,
): Pick[] {
  const picks: Pick[] = [];
  const seen = new Set<string>();
  const newest = <T extends { publishedAt?: string; createdAt?: string }>(
    a: T,
    b: T,
  ) =>
    (b.publishedAt ?? b.createdAt ?? "").localeCompare(
      a.publishedAt ?? a.createdAt ?? "",
    );
  for (const post of [...posts].sort(newest)) {
    if (seen.has(post.author)) continue;
    seen.add(post.author);
    picks.push({ builder: post.author, storyType: "feed", post });
  }
  for (const lead of [...extensions].sort(newest)) {
    if (seen.has(lead.collective)) continue;
    seen.add(lead.collective);
    picks.push({ builder: lead.collective, storyType: "registry", lead });
  }
  return picks.slice(0, limit);
}

async function newestExtensions(): Promise<Array<Record<string, unknown>>> {
  const output = await new Deno.Command("swamp", {
    args: ["extension", "search", "--sort", "new", "--per-page", "100", "--json"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!output.success) throw new Error("the registry search failed");
  return JSON.parse(new TextDecoder().decode(output.stdout)).extensions;
}

/** Behavior that scouts the Feed and registry for builders worth featuring. */
export const behavior = {
  type: "@thedarkpriestess/daily-croak",
  version: "2026.11.05.3",
  globalArguments: GlobalArgsSchema,
  resources: {
    "candidates": {
      description: "Recent Feed posts and new registry extensions",
      schema: CandidatesSchema,
      lifetime: "infinite",
      garbageCollection: 30,
    },
    "picks": {
      description: "The newest post or extension from each builder",
      schema: PicksSchema,
      lifetime: "infinite",
      garbageCollection: 30,
    },
  },
  methods: {
    find: {
      description: "Read recent Feed posts and new registry extensions",
      arguments: z.object({
        feedWithinDays: z.number().int().positive().default(14),
        registryWithinDays: z.number().int().positive().default(7),
      }),
      execute: async (
        args: { feedWithinDays: number; registryWithinDays: number },
        context: {
          globalArgs: GlobalArgs;
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
        },
      ) => {
        const { skip } = context.globalArgs;
        const now = new Date();
        const since = (days: number) =>
          now.getTime() - days * 24 * 60 * 60 * 1000;
        const warnings: string[] = [];

        let posts: Post[] = [];
        try {
          const response = await fetch("https://swamp-club.com/feed.xml");
          if (!response.ok) throw new Error(`status ${response.status}`);
          posts = withoutSkipped(
            parseFeed(await response.text()),
            skip,
            (post) => post.author,
          ).filter((post) =>
            new Date(post.publishedAt).getTime() >= since(args.feedWithinDays)
          );
        } catch (error) {
          warnings.push(`The Feed was skipped: ${(error as Error).message}`);
        }

        let extensions: Extension[] = [];
        try {
          extensions = withoutSkipped(
            (await newestExtensions()).map((item) => ({
              name: String(item.name),
              collective: String(item.name).slice(1).split("/")[0],
              description: String(item.description ?? ""),
              repository: (item.repository as string | null) ?? null,
              createdAt: String(item.createdAt),
            })),
            skip,
            (extension) => extension.collective,
          ).filter((extension) =>
            new Date(extension.createdAt).getTime() >=
              since(args.registryWithinDays)
          );
        } catch (error) {
          warnings.push(`The registry was skipped: ${(error as Error).message}`);
        }

        const handle = await context.writeResource("candidates", "candidates", {
          foundAt: now.toISOString(),
          feedWithinDays: args.feedWithinDays,
          registryWithinDays: args.registryWithinDays,
          warnings,
          posts,
          extensions,
        });
        return { dataHandles: [handle] };
      },
    },
    pick: {
      description: "Take the newest post from each builder, three in all",
      arguments: z.object({
        limit: z.number().int().positive().default(3),
      }),
      execute: async (
        args: { limit: number },
        context: {
          readResource?: (name: string) => Promise<unknown>;
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
        },
      ) => {
        const saved = await context.readResource!("candidates") as
          | { posts: Post[]; extensions: Extension[] }
          | null;
        if (!saved) throw new Error("Run the find method first");
        const handle = await context.writeResource("picks", "picks", {
          pickedAt: new Date().toISOString(),
          picks: pickBuilders(saved.posts, saved.extensions, args.limit),
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
