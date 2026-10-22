import { authenticateRequest, createServiceRoleClient, PaymentConfigError } from "@/lib/server/payments";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await authenticateRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.app_metadata?.role !== "admin") {
    return Response.json({ error: "Administrator access is required." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Invalid member ID." }, { status: 400 });
  }

  let body: { banned?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.banned !== "boolean") {
    return Response.json({ error: "Choose whether to ban or restore the member." }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > 500) {
    return Response.json({ error: "The ban reason must be 500 characters or fewer." }, { status: 400 });
  }

  if (body.banned && id.toLowerCase() === session.user.id.toLowerCase()) {
    return Response.json({ error: "You cannot ban your own administrator account." }, { status: 400 });
  }

  try {
    const client = createServiceRoleClient();
    const { data: profile, error: lookupError } = await client
      .from("profiles")
      .select("is_banned, ban_reason")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!profile) return Response.json({ error: "Member profile not found." }, { status: 404 });

    let profileUpdateError: string | null = null;
    try {
      const { error } = await session.client.rpc("admin_set_member_banned", {
        p_member_id: id,
        p_is_banned: body.banned,
        p_reason: reason,
      });
      profileUpdateError = error?.message ?? null;
    } catch (error) {
      profileUpdateError = error instanceof Error ? error.message : "Unknown profile update failure.";
    }
    if (profileUpdateError) return Response.json({ error: profileUpdateError }, { status: 409 });

    let authUpdateError: string | null = null;
    try {
      const { error } = await client.auth.admin.updateUserById(id, {
        ban_duration: body.banned ? "876000h" : "none",
      });
      authUpdateError = error?.message ?? null;
    } catch (error) {
      authUpdateError = error instanceof Error ? error.message : "Unknown authentication update failure.";
    }
    if (authUpdateError) {
      let rollbackError: string | null = null;
      try {
        const { error } = await session.client.rpc("admin_set_member_banned", {
          p_member_id: id,
          p_is_banned: profile.is_banned,
          p_reason: profile.ban_reason ?? "",
        });
        rollbackError = error?.message ?? null;
      } catch (error) {
        rollbackError = error instanceof Error ? error.message : "Unknown rollback failure.";
      }
      if (rollbackError) {
        console.error("Member profile restriction rollback failed.", rollbackError);
        return Response.json({ error: "The member restriction could not be synchronized after a failed update. Contact support." }, { status: 500 });
      }
      return Response.json({ error: authUpdateError }, { status: 502 });
    }
    return Response.json({ userId: id, banned: body.banned });
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      return Response.json({ error: "Admin service is not configured." }, { status: 503 });
    }
    console.error("Member authentication status could not be updated.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The member restriction could not be applied. Try again." }, { status: 500 });
  }
}
