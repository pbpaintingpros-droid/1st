import { getActor } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/services/common";
import { canSubSeePhoto } from "@/lib/services/crew";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * /api/files/photo/:jobPhotoId  — staff: any job photo; subs: only crew-shared photos on their offers
 * /api/files/doc/:subDocumentId — staff with subs.documents only
 */
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  const actor = await getActor();
  if (!actor) return new Response("Sign in required", { status: 401 });
  if (!isUuid(id)) return notFound();
  const db = await getDb();

  let fileId: string | null = null;
  if (kind === "photo") {
    if (actor.role === "sub") {
      if (!(await canSubSeePhoto(db, actor.subcontractorId!, id))) return notFound();
    } else if (!can(actor.role, "jobs.view")) return notFound();
    fileId = (await db.query<{ file_id: string | null }>("select file_id from job_photos where id = $1", [id])).rows[0]?.file_id ?? null;
  } else if (kind === "doc") {
    if (!can(actor.role, "subs.documents")) return notFound();
    fileId = (await db.query<{ file_id: string | null }>("select file_id from sub_documents where id = $1", [id])).rows[0]?.file_id ?? null;
  }
  if (!fileId) return notFound();

  const { rows } = await db.query<{ file_name: string; content_type: string; data: Uint8Array }>(
    "select file_name, content_type, data from files where id = $1",
    [fileId],
  );
  const f = rows[0];
  if (!f) return notFound();
  const inline = f.content_type.startsWith("image/") || f.content_type === "application/pdf";
  return new Response(Buffer.from(f.data), {
    headers: {
      "Content-Type": f.content_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.file_name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
