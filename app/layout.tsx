import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ops Email Extractor",
  description: "Extract shipment instructions from airfreight email threads locally."
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
