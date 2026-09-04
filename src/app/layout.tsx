import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Prospecção Autônoma no Instagram",
  description: "Painel de controle da prospecção comercial autônoma",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-x-auto p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
