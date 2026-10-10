import { llmsTxt, originOf } from "@/lib/onramp";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(llmsTxt(originOf(req)), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
