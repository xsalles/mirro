import { AppShell } from "@/components/app-shell";
import { MirroProvider } from "@/components/mirro-provider";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <MirroProvider><AppShell>{children}</AppShell></MirroProvider>;
}
