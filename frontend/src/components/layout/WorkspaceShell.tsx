"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "./AppShell";
import { WORKSPACE_ROUTE_SEGMENTS } from "./navigation";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const firstSegment = `/${pathname.split("/").filter(Boolean)[0] ?? ""}`;
  return WORKSPACE_ROUTE_SEGMENTS.has(firstSegment)
    ? <AppShell>{children}</AppShell>
    : children;
}
