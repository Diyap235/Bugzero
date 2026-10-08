import type { Metadata } from "next";
import { DemoAuthProvider } from "@/lib/auth/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "BugZero — Repository Intelligence",
  description: "Understand your repository, investigate findings, and track code health.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-text-primary antialiased selection:bg-primary selection:text-white">
        <DemoAuthProvider>{children}</DemoAuthProvider>
      </body>
    </html>
  );
}
