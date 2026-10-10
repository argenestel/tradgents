import { installScript, originOf } from "@/lib/onramp";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(installScript(originOf(req)), { headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "public, max-age=300" } });
}
