import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Octave — Trust your music instincts",
  description:
    "Predict the next move on the Billboard Hot 100. A gamified music prediction market powered by virtual Music Notes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
