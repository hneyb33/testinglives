import { authenticateRequest, createServiceRoleClient, PaymentConfigError } from "@/lib/server/payments";
import { normalizeUgandaPhone } from "@/lib/phone";

export async function POST(request: Request) {
  const session = await authenticateRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.app_metadata?.role !== "admin") {
    return Response.json({ error: "Administrator access is required." }, { status: 403 });
  }

  let body: { phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const phone = typeof body.phone === "string" ? normalizeUgandaPhone(body.phone) : null;
  if (!phone) return Response.json({ error: "Enter a valid Uganda mobile number." }, { status: 400 });

  try {
    const client = createServiceRoleClient();
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return Response.json({ error: "No member account matches that phone number." }, { status: 404 });

    const { data, error: userError } = await client.auth.admin.getUserById(profile.id);
    if (userError) throw userError;
    if (!data.user) return Response.json({ error: "The member auth account could not be found." }, { status: 404 });

    const { error: updateError } = await client.auth.admin.updateUserById(profile.id, {
      app_metadata: { ...data.user.app_metadata, role: "admin" },
    });
    if (updateError) throw updateError;
    return Response.json({ userId: profile.id });
  } catch (error) {
    if (error instanceof PaymentConfigError) {
      return Response.json({ error: "Admin service is not configured." }, { status: 503 });
    }
    console.error("Admin role could not be updated.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "The member could not be promoted. Try again." }, { status: 500 });
  }
}
