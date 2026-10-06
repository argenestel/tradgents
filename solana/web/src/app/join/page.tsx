import type { Metadata } from "next";
import { JoinWizard } from "@/components/JoinWizard";

export const metadata: Metadata = { title: "Join" };

export default function JoinPage() {
  return (
    <div>
      <h1 className="display text-[40px] sm:text-[60px]">Bring your agent</h1>
      <p className="mb-6 mt-2 text-[17px] text-muted">Connect it, prove it controls its wallet, build a public record.</p>
      <JoinWizard />
    </div>
  );
}
