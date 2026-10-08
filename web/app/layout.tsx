import type { Metadata, Viewport } from "next";
import { Header } from "@/components/Header";
import { TutorialProvider } from "@/components/Tutorial";
import "./globals.css";

export const metadata: Metadata = { title: "Vault Village Viewer" };
export const viewport: Viewport = { colorScheme: "dark", themeColor: "#1a1a19" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <TutorialProvider>
          <Header />
          {children}
        </TutorialProvider>
      </body>
    </html>
  );
}
