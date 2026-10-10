import { skillMarkdown, originOf } from "@/lib/onramp";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(skillMarkdown(originOf(req)), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
}
