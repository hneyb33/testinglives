import { authenticateRequest } from "@/lib/server/payments";

export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/withdrawals/[id]/reject">,
) {
  const session = await authenticateRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.app_metadata?.role !== "admin") {
    return Response.json({ error: "Administrator access is required." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Invalid withdrawal ID." }, { status: 400 });
  }

  const { error } = await session.client.rpc("reject_pesajet_withdrawal", {
    p_transaction_id: id,
  });
  if (error) return Response.json({ error: error.message }, { status: 409 });
  return Response.json({ transactionId: id, status: "rejected" });
}
