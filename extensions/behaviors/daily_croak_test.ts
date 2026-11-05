import { assertEquals } from "jsr:@std/assert@1";
import {
  parseFeed,
  pickBuilders,
  webAddress,
  withoutSkipped,
} from "./daily_croak.ts";

const post = (author: string, publishedAt: string) => ({
  title: `${author} wrote this`,
  url: `https://example.com/${author}/${publishedAt}`,
  author,
  publishedAt,
  summary: "A short summary",
  body: "",
});

const extension = (collective: string, createdAt: string) => ({
  name: `@${collective}/tool`,
  collective,
  description: "A tool",
  repository: null,
  createdAt,
});

Deno.test("parseFeed reads title, author, link and full text", () => {
  const [item] = parseFeed(`<rss><item>
<title>Bees &amp; Swamp</title>
<guid isPermaLink="true">https://swamp-club.com/feed/p/1</guid>
<dc:creator>ada</dc:creator>
<pubDate>Fri, 30 Oct 2026 07:39:31 GMT</pubDate>
<description>Summary</description>
<content:encoded><![CDATA[<p>Full <b>text</b> here</p>]]></content:encoded>
</item></rss>`);
  assertEquals(item.title, "Bees & Swamp");
  assertEquals(item.author, "ada");
  assertEquals(item.url, "https://swamp-club.com/feed/p/1");
  assertEquals(item.body, "Full text here");
});

Deno.test("withoutSkipped drops names on the list", () => {
  const kept = withoutSkipped(
    [post("skipped", "2026-11-01"), post("ada", "2026-11-01")],
    ["skipped"],
    (item) => item.author,
  );
  assertEquals(kept.map((item) => item.author), ["ada"]);
});

Deno.test("the newest post from each builder is picked, newest first", () => {
  const picks = pickBuilders([
    post("ada", "2026-10-20"),
    post("ben", "2026-11-02"),
    post("ada", "2026-11-01"),
  ], [], 5);
  assertEquals(picks.map((pick) => pick.builder), ["ben", "ada"]);
  assertEquals(picks[1].post?.publishedAt, "2026-11-01");
});

Deno.test("extensions fill spare places but never repeat a builder", () => {
  const picks = pickBuilders(
    [post("ada", "2026-11-01")],
    [extension("ada", "2026-11-03"), extension("cy", "2026-11-02")],
    3,
  );
  assertEquals(picks.map((pick) => [pick.builder, pick.storyType]), [
    ["ada", "feed"],
    ["cy", "registry"],
  ]);
});

Deno.test("the limit caps the picks", () => {
  const picks = pickBuilders([
    post("a", "2026-11-01"),
    post("b", "2026-11-02"),
    post("c", "2026-11-03"),
    post("d", "2026-11-04"),
  ], [], 3);
  assertEquals(picks.length, 3);
});

Deno.test("a showcase item falls back to its own link", () => {
  assertEquals(
    webAddress("urn:uuid:123", "https://www.youtube.com/watch?v=abc"),
    "https://www.youtube.com/watch?v=abc",
  );
  assertEquals(
    webAddress("https://swamp-club.com/feed/p/1", "https://x.example/go"),
    "https://swamp-club.com/feed/p/1",
  );
});
