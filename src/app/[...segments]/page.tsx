import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";

export default function DynamicAppRoute() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <AppShell />
    </Suspense>
  );
}

function RouteLoading() {
  return (
    <div className="phone-shell flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
    </div>
  );
}
