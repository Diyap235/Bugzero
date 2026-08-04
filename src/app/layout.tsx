import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BugZero — AI-Powered Repository Review Platform",
  description:
    "Transform source code into actionable engineering decisions through static analysis, CodeBERT ML classification, and explainable AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-text-primary antialiased selection:bg-primary selection:text-white">
        {children}
      </body>
    </html>
  );
}
