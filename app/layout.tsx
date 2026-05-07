import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elden Feedback Game",
  description: "A feedback-driven browser boss duel prototype."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
