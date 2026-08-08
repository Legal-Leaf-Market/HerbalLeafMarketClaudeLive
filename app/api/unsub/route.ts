import { unsubscribe } from "@/lib/hlm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const email = url.searchParams.get("unsub") || ""
  const html = await unsubscribe(email)
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
