import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CV Backoffice",
  description: "Local editor for the CV site content.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
