import type { Metadata } from "next";
import "./globals.css";
import "./room.css";

export const metadata: Metadata = {
  title: "Farol | Salas ao vivo",
  description: "Compartilhe sua tela e áudio em uma sala privada."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
