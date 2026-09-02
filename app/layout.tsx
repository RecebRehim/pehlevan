import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Impossible — A Physical Challenge Lab",
  description: "Break, bend, lift, and punch through a cinematic series of tactile 3D challenges.",
  openGraph: {
    title: "Impossible — A Physical Challenge Lab",
    description: "Break, bend, lift, and punch through a cinematic series of tactile 3D challenges.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Impossible physical challenge lab" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Impossible — A Physical Challenge Lab",
    description: "Break, bend, lift, and punch through a cinematic series of tactile 3D challenges.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ecece5",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
